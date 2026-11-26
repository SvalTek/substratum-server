# Administration & Auth

All `/api/v1/clients`, `/api/v1/operator/*`, `/api/auth/session`, and `/api/auth/logout` endpoints require **management access** (dashboard session or `MANAGEMENT_TOKEN`). Client Bearer tokens receive `403`.

## Client Credentials

### `GET /api/v1/clients`

Lists registered clients with `createdAt`, `rotatedAt`, `lastAuthenticatedAt`, and active SSE `connections`.

### `POST /api/v1/clients`

Body: `{ operation: "issue" | "reroll" | "burn", clientId }`.

- `issue`: Returns `201` `{ clientId, secret }` (secret shown once) or `409` if already exists.
- `reroll`: Returns `200` `{ clientId, secret }` and closes active SSE streams for that client (`404` if missing).
- `burn`: Returns `204` and closes active SSE streams (`404` if missing).

## Plugins, Lua & Scheduler

- `GET /api/v1/plugins`: Lists active runtime plugin names (standard auth).
- `GET /api/v1/operator/plugins`: Returns `{ plugins, scheduler }`, or diagnostic logs with `?logs=<source>`.
- `POST /api/v1/operator/plugins`: Toggle a TypeScript plugin with `{ filename, enabled }`.
- `GET /api/v1/operator/lua`: Lists Lua plugins, shared modules, and binding docs (`?plugin=<id>` or `?docs=1`).
- `POST /api/v1/operator/lua`: Executes `create-plugin`, `save-plugin`, `reload-plugin`, `delete-plugin`, `save-module`, or `delete-module`.
- `POST /api/v1/operator/scheduler`: Sets `intervalMs` (`0` to stop, or `50`–`60000` ms).

## Diagnostics, Settings & Storage

- `GET /api/v1/operator/diagnostics`: Process memory/CPU, uptime, world stats, query/mutation performance, client streams, and recent diagnostic errors.
- `GET /api/v1/operator/settings`: Effective startup settings, active session count, and activity retention limit.
- `POST /api/v1/operator/settings`: Supports `revoke-sessions` (`confirm: "revoke-sessions"`) and `set-retention` (`limit`: `100`–`20000`).
- `GET /api/v1/operator/storage`: SQLite vs runtime counts, `matching` flag, allocation stats, and recent backups.
- `POST /api/v1/operator/storage`: Supports `validate`, `backup` (`label`), `delete-backup` (`id`), `restore` (`id`, `confirm: "restore"`), and `collect-orphans` (`confirm: "collect-orphans"`).
- `GET /api/v1/operator/backup?id=<id>`: Downloads the `substratum-atlas/1` snapshot for a backup.

## Dashboard Auth

- `GET /api/auth/session`: Returns `{ authenticated: true, method }`.
- `POST /api/auth/login`: Public same-origin login with `{ password }`; issues `HttpOnly` session cookie (`204`).
- `POST /api/auth/logout`: Invalidates the current session and closes its active SSE streams.
