# Static test data

Files here are read by `src/utils/file.utils.ts` and are checked into the
repository, so everything in this folder must be safe to make public.

| File                      | Format | Read by           | Purpose                                                                                                 |
| ------------------------- | ------ | ----------------- | ------------------------------------------------------------------------------------------------------- |
| `users.json`              | JSON   | `readJson`        | Role names and the seed accounts an environment is expected to contain.                                 |
| `status-codes.csv`        | CSV    | `readCsv`         | A table-driven matrix of malformed requests and the status each must produce.                           |
| `files/upload-sample.txt` | text   | multipart uploads | A small real file, so upload tests exercise a real file handle rather than a synthetic buffer.          |
| `openapi.json`            | JSON   | `OpenApiContract` | _Optional._ Drop the published specification here and the `contract` fixture picks it up automatically. |

## What belongs here

Data that is **static, non-secret and shared**: reference tables, the expected
shape of an error, a small binary for upload tests.

## What does not

- **Anything generated per run.** Use `src/utils/data.utils.ts`; a checked-in
  email address fails the second time it meets a uniqueness constraint.
- **Anything secret.** Credentials come from the environment through
  `getUser(role)`. This folder is committed.
- **Anything large.** A multi-megabyte fixture slows every clone forever;
  generate it with `tempFileOfSize` instead.

## Adding a file

1. Put it here, in the smallest format that works (CSV beats JSON for a table
   a non-engineer will edit).
2. Add a row to the table above.
3. Read it through `dataFile('name.csv')` rather than a relative path, so the
   suite works regardless of the working directory it was launched from.
