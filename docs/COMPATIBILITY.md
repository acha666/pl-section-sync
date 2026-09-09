# PrairieLearn adapter contract

The adapter uses internal PrairieLearn endpoints, which are not a versioned public API. Unexpected response shapes stop the operation. IDs remain strings.

## Reads

Supported source paths end in `/course_instance/{id}/instructor/instance_admin/students` or `/students/labels`. Origin and instructor base are derived from the selected tab.

- `GET {base}/instance_admin/students`: parse `script[type="application/json"][data-component="InstructorStudents"][data-component-props]`. Its JSON envelope supplies the course context, edit permissions, and `trpcCsrfToken`.
- `GET {base}/instance_admin/students/data.json`: read enrollment, user, and status data.
- `GET {base}/trpc/studentLabels.list`: read `result.data.json.labels` and `origHash`; memberships use enrollment IDs from `user_data`.

The dedicated tRPC CSRF token is read fresh inside the isolated world and never returned to the panel. Requests use same-origin cookies, reject redirects, and time out after 90 seconds. Subsequent injections are pinned to the first read's Chrome `documentId`; each request also checks the source origin and path.

## Writes

Requests use `X-TRPC: true`, `X-CSRF-Token`, and a `{ "json": input }` envelope.

| Method        | Input                                            | Verified reply                           |
| ------------- | ------------------------------------------------ | ---------------------------------------- |
| `upsert`      | `name`, `color: "blue1"`, `uids: []`, `origHash` | `origHash`, no enrollment warning        |
| `batchAdd`    | `labelId`, `enrollmentIds`                       | `added`, `alreadyHaveLabel`, `notFound`  |
| `batchRemove` | `labelId`, `enrollmentIds`                       | `removed`, `didNotHaveLabel`, `notFound` |
| `destroy`     | `labelId`, `origHash`                            | `origHash`                               |

Creates omit `labelId`. Every write is preceded by a fresh snapshot and followed by exact expected-state verification. Batch replies must account for all requested students with zero `notFound`. A lost write response triggers a read, not an automatic resend.

Limits: 20 MB CSV, 255-character label names, 100 labels before cleanup, and 500 enrollment IDs per membership request. Operations create labels, add memberships, remove memberships, then delete empty labels.

There is no global transaction, rollback, or atomic membership lock. Concurrent edits between the last read and a write can remain undetectable. The session journal is a recovery reminder, not a resumable job queue.

`pageRequest` must remain self-contained because Chrome copies its function body. Runtime imports or compiler helpers outside that body cannot be used by the injected function.
