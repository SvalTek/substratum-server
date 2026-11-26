# Queries, Events & Activity

## Spatial Queries

All query endpoints cap results at `1000` and include `X-Query-Time-Ms` and `Server-Timing` response headers.

### `POST /api/v1/search`

Searches attachments (or deduplicated content when `unique: true`) within `region`.

```json
{
  "region": ["1", "", "1"],
  "overlap": true,
  "kind": "observation",
  "tags": ["survey"],
  "where": {},
  "unique": true,
  "limit": 50
}
```

### `POST /api/v1/cells/search`

Searches occupied cells within `region` (`{ region?, overlap?, limit? }`) and returns `CellSnapshot[]`.

### `POST /api/v1/nearest`

Finds the nearest unique content records to `at` (`[x, y, z]`), with optional `limit` (default `20`), `kind`, `tags`, and `where`. Returns `DistanceResult[]`.

### `POST /api/v1/radius`

Finds unique content records within `radius` (>= `0`) of `at` (`[x, y, z]`), with optional `limit` (default `250`), `kind`, `tags`, and `where`. Returns `DistanceResult[]`.

---

## Events & Streaming

### `GET /api/v1/events`

Opens a Server-Sent Events (`text/event-stream`) subscription.

- Optional `?region=<json>` scopes `change` events to a `Region`.
- Optional `?activity=1` includes `activity` journal events (management access required; `403` for client tokens).

### `POST /api/v1/events`

Emits a custom event `{ name, data?, region? }`. Event names cannot begin with `mutation:`, `spatial:`, or `update`. Returns `200` `{ emitted: true }`.

---

## Activity Journal & Saved Queries (Management Only)

### `GET /api/v1/activity`

Queries the SQLite activity journal (`category`, `name`, `kind`, `contentId`, `source`, `limit` 1–1000 default 256, `offset`). Returns `{ events, total }`.

### `GET` / `POST` / `DELETE /api/v1/queries`

- `GET`: Lists saved Query Workbench configurations (`{ queries }`).
- `POST`: Upserts `{ name, config }` (`{ saved: true, name }`).
- `DELETE`: Removes `{ name }` (`{ removed }`).
