/**
 * Service-object registry.
 *
 * Every service is exported here and constructed by the `api` fixture, so a
 * test reaches them all through one object and a new service becomes available
 * to every test by adding two lines.
 *
 * The three services here demonstrate three different situations:
 *
 *   `ObjectService`   a real, persistent CRUD API — the lifecycle suite
 *   `PostService`     a different host, reached with a derived client
 *   `UserService`     a template to copy, against a hypothetical API
 */
export { ObjectService } from './object.service';
export {
  ApiObjectSchema,
  CreatedObjectSchema,
  UpdatedObjectSchema,
  ObjectListSchema,
  ObjectDataSchema,
  DeleteAcknowledgementSchema,
  ObjectErrorSchema,
} from './object.service';
export type { ApiObject, CreatedObject, UpdatedObject, NewObject } from './object.service';

export { PostService, PostSchema, PostListSchema } from './post.service';
export type { Post } from './post.service';

export { UserService, UserSchema, UserPageSchema } from './template.service';
export type { User, NewUser } from './template.service';
