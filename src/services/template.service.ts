/**
 * A worked example of a service object — copy this file to start a new one.
 *
 * It is deliberately complete rather than minimal, because the questions that
 * come up when writing the *second* service object are all answered here: how
 * a create call registers its own cleanup, how a list endpoint is paginated,
 * how a domain method differs from a raw one, and where response schemas go.
 *
 * The rule this file exists to demonstrate: a service method returns a domain
 * value on the happy path and never asserts. Assertions belong in tests, so a
 * negative-path test can reuse the same service without fighting it.
 */
import { z } from 'zod';
import { BaseService } from '../core/base.service';
import type { ApiResponse } from '../core/api.response';
import { registerSchemas } from '../contracts/schema.registry';
import { isoDateTime, identifier, offsetPage } from '../contracts/schemas';
import { followOffset } from '../utils/pagination.utils';
import { buildUser } from '../utils/data.utils';
import type { UnknownRecord } from '../types';

/* ------------------------------------------------------------------ */
/* Contract                                                            */
/* ------------------------------------------------------------------ */

/**
 * The resource's schema, and the type derived from it.
 *
 * Declaring the schema first and inferring the type — rather than writing an
 * interface and hoping the schema matches — means the runtime check and the
 * compile-time type can never disagree.
 */
export const UserSchema = z.object({
  id: identifier,
  email: z.string().email(),
  firstName: z.string(),
  lastName: z.string(),
  role: z.enum(['admin', 'standard', 'readonly']),
  active: z.boolean(),
  createdAt: isoDateTime,
  updatedAt: isoDateTime.optional(),
});

export type User = z.infer<typeof UserSchema>;

export const UserPageSchema = offsetPage(UserSchema);

/* Registered so `STRICT_CONTRACTS=true` can validate these responses without
 * the test asking, and so contract coverage can count them. */
registerSchemas([
  { name: 'user', method: 'GET', pathPattern: '/users/{id}', status: '2xx', schema: UserSchema },
  { name: 'user-created', method: 'POST', pathPattern: '/users', status: 201, schema: UserSchema },
  {
    name: 'user-page',
    method: 'GET',
    pathPattern: '/users',
    status: '2xx',
    schema: UserPageSchema,
  },
]);

/* ------------------------------------------------------------------ */
/* Service                                                             */
/* ------------------------------------------------------------------ */

/** Input accepted by `create`. Everything not supplied is generated. */
export type NewUser = Partial<Pick<User, 'email' | 'firstName' | 'lastName' | 'role'>>;

export class UserService extends BaseService {
  protected readonly basePath = '/users';

  /**
   * Creates a user and registers its deletion.
   *
   * The cleanup is registered inside the method rather than left to the test,
   * so a resource cannot be created without also being cleaned up.
   */
  async create(overrides: NewUser = {}): Promise<User> {
    return this.step('create a user', async () => {
      const payload = buildUser(overrides);
      const response = await this.post()
        .json(payload)
        .idempotencyKey()
        .expectStatus(201)
        .as('create user')
        .send();

      const user = response.parse(UserSchema, 'user');
      return this.track(user, `user ${String(user.id)}`, () => this.remove(user.id));
    });
  }

  /** Reads one user. Returns `undefined` for 404 rather than throwing. */
  async find(id: User['id']): Promise<User | undefined> {
    const response = await this.get('/{id}').param('id', id).as('get user').send();
    if (response.status === 404) return undefined;
    return response.expectOk().parse(UserSchema, 'user');
  }

  /** Reads one user, failing when it is absent. */
  async require(id: User['id']): Promise<User> {
    const user = await this.find(id);
    if (!user) throw new Error(`User ${String(id)} does not exist.`);
    return user;
  }

  /** Every user matching a filter, following pagination to the end. */
  async list(filter: { role?: User['role']; active?: boolean } = {}): Promise<User[]> {
    return this.step('list users', () =>
      followOffset(async (offset, limit) => {
        const response = await this.get()
          .query({ ...filter, offset, limit })
          .as('list users')
          .send();
        return response.expectOk().parse(UserPageSchema, 'user-page').items;
      }),
    );
  }

  /** Applies a partial update. */
  async update(id: User['id'], changes: Partial<NewUser>): Promise<User> {
    const response = await this.patch('/{id}')
      .param('id', id)
      .json(changes)
      .expectStatus(200)
      .as('update user')
      .send();
    return response.parse(UserSchema, 'user');
  }

  /**
   * Deletes a user, tolerating a 404.
   *
   * Cleanup runs after tests that may already have deleted the resource
   * themselves, so "already gone" has to count as success.
   */
  async remove(id: User['id']): Promise<void> {
    await this.del('/{id}').param('id', id).expectStatus(204, 200, 404).as('delete user').send();
    this.cleanup.forget(`user ${String(id)}`);
  }

  /**
   * The raw response, for tests that assert on status, headers or timing.
   *
   * Every service should expose one of these. Without it, a test that needs
   * to check a `Location` header ends up bypassing the service entirely and
   * hard-coding the path it was supposed to encapsulate.
   */
  async rawCreate(payload: UnknownRecord): Promise<ApiResponse> {
    return this.post().json(payload).as('create user (raw)').send();
  }
}
