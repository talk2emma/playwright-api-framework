# Static test data

Files here are checked into the repository, so everything in this folder must be
safe to make public.

| File           | Format | Read by           | Purpose                                                                                                 |
| -------------- | ------ | ----------------- | ------------------------------------------------------------------------------------------------------- |
| `openapi.json` | JSON   | `OpenApiContract` | _Optional._ Drop the published specification here and the `contract` fixture picks it up automatically. |

## Why there is so little here

An earlier version of this folder carried a JSON role table, a CSV status-code
matrix and a sample upload file, together with `readJson`, `readCsv`, `dataFile`
and `tempFile` helpers in `src/utils/file.utils.ts`. No test ever read any of
them, so the helpers and the files were removed together.

The lesson is worth keeping: add a data file when a test reads it, in the same
change as the test. Fixtures added in advance of a need are indistinguishable
from fixtures nobody needs.
