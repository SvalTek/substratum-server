# Storage & Snapshots

## SQLite as Source of Truth

SQLite is the durable source of truth for Substratum Server. It stores:

- Content payloads by identity (`contents`)
- Cell addresses and cell metadata (`cells`)
- Attachment metadata per `(address, content_id)` (`attachments`)
- Dashboard sessions, client credentials, saved queries, activity journal, backups, and Lua plugins/modules

WAL mode, foreign keys, and full synchronous commits are enabled. On startup, the in-memory `@svaltek/substratum` indexes are rebuilt from SQLite.

## Transactional Parity

Every API mutation runs through a Substratum batch inside a SQLite transaction. If an observer or SQLite write fails after Substratum commits its in-memory change, the server reloads the runtime from SQLite before returning the error.

Payloads must be JSON-serializable so they can always be persisted and recovered across restarts.

## World Snapshots (`substratum-atlas/1`)

- **Export**: `GET /api/v1/snapshot` returns `{ format: "substratum-atlas/1", bits, contents, cells }`, preserving both placed and unattached (orphan) content.
- **Import**: `POST /api/v1/snapshot` requires management access and the confirmation header `X-Confirm-Snapshot: replace`. The server automatically creates a backup labeled `"Before snapshot import"` before replacing the world. The imported snapshot's `bits` must match the server's stored bit depth.

## Backups, Validation & Orphan Collection

All storage maintenance operations are available in the **Storage** dashboard page or via `/api/v1/operator/storage`:

- **Validate** (`operation: "validate"`): Runs SQLite `PRAGMA quick_check`, `PRAGMA foreign_key_check`, `world.validate()`, and verifies that every content record, cell, and attachment in SQLite matches the live in-memory runtime.
- **Create Backup** (`operation: "backup"`, `label`): Stores a named `substratum-atlas/1` snapshot in SQLite (`backups`).
- **Restore Backup** (`operation: "restore"`, `id`, `confirm: "restore"`): Automatically snapshots the current world (`"Before restore"`) and restores the selected backup.
- **Download Backup**: `GET /api/v1/operator/backup?id=<id>` returns the stored snapshot JSON.
- **Collect Orphans** (`operation: "collect-orphans"`, `confirm: "collect-orphans"`): Removes unattached content records from both the runtime and SQLite.
