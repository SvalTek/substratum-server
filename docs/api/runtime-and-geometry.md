# Runtime & Geometry

## `GET /api/v1/health`

Public readiness probe (no authentication required). Returns `200` `text/plain` with body `ok`.

## `GET /api/v1/openapi.json`

Returns the complete OpenAPI 3.1.0 JSON specification for Substratum Server.

## `GET /api/v1/stats`

Returns `{ bits, cells, attachments, contents, orphans, plugins }`.

- Optional query `?view=overview` or `?view=metrics` (requires **management** access; client tokens receive `403`).

## `POST /api/v1/geometry`

Inspects a `Region` against the server's coordinate bit depth.

**Request body:**

```json
{
  "region": { "at": [0, 0, 0], "extent": [8, 4, 8] }
}
```

**Response (`200`):** `{ bounds, cover, exact, bits }` (`exact` is `null` if exact decomposition exceeds 256 boxes).

## `GET /api/v1/snapshot`

Exports the full world as `substratum-atlas/1`: `{ format, bits, contents, cells }`.

## `POST /api/v1/snapshot`

Replaces the entire world from a `substratum-atlas/1` snapshot.

- Requires **management** access (`403` for client tokens).
- Requires header `X-Confirm-Snapshot: replace` (`400` if missing).
- Automatically creates a SQLite backup (`"Before snapshot import"`) before importing.
- Returns `200` `{ imported: true, stats }`.

## `POST /api/v1/atlas/delta`

Fetches specific cells and content records in one batch (up to `256` combined `addresses` and `contentIds`; missing keys are omitted).

```json
{
  "addresses": [["1", "1", "1"]],
  "contentIds": ["example-content-id"]
}
```

**Response (`200`):** `{ cells, contents }`.
