# Content, Cells & Placements

## Content Identities

### `GET /api/v1/contents`

Returns paginated content summaries `{ page, limit, total, items }` (`30` per page).

- Query params: `page` (default `1`), `q` (substring on `id` or `kind`), `kind` (exact kind), `orphans` (`"true"` for unattached content only).

### `POST /api/v1/contents`

Creates a content identity, with an optional initial spatial placement when `address` is provided.

```json
{
  "kind": "observation",
  "payload": { "temperature": 21.5 },
  "address": ["1", "1", "1"],
  "metadata": { "tags": ["survey"] }
}
```

- Returns `201` `{ id }`.
- If `metadata.kind` is supplied, it must match `kind`.

### `GET /api/v1/contents/{id}`

Returns `{ id, kind, payload, placements }` (`404` if not found).

### `PATCH /api/v1/contents/{id}`

Replaces the JSON payload with `{ payload }` and returns `200` `{ id, payload }`.

### `DELETE /api/v1/contents/{id}`

Deletes an unattached content identity and returns `200` `{ removed }`. Returns `409` if placements are still attached.

### `GET /api/v1/contents/{id}/placements`

Returns `200` `{ id, placements }` (`404` if content not found).

---

## Cells

### `GET /api/v1/cells`

- Without `address`: returns paginated occupied cells `{ page, limit, total, items }`.
- With `?address=["1","1","1"]`: returns the single `CellSnapshot` `{ address, metadata, attachments }` (`404` if not found).

### `PATCH /api/v1/cells/metadata`

Replaces cell metadata with `{ address, metadata }` and returns `200` `{ address, cell }`.

### `DELETE /api/v1/cells`

Clears a cell and all of its attachments using `{ address }`. Returns `200` `{ removed }`.

---

## Placements

### `POST /api/v1/placements`

Attaches an existing content `id` to `address` with optional `metadata`. Returns `201` `{ id, address }` (`404` if content missing).

### `PATCH /api/v1/placements`

Updates attachment `metadata` for `{ id, address, metadata }`. Returns `200` `{ id, address, metadata }`.

### `DELETE /api/v1/placements`

Detaches `{ id, address }` without deleting the content identity. Returns `200` `{ removed }`.

### `POST /api/v1/placements/relocate`

Atomically moves one attachment from `from` to `to` (`{ id, from, to }`), preserving its metadata. Returns `200` `{ id, address }`, `404` if source attachment is missing, or `409` if already attached at `to`.

### `POST /api/v1/placements/move`

Replaces all placements of `id` with a spatial box at `at` (`[x, y, z]`) and optional `extent` and `metadata` (capped at `10,000` cells). Returns `200` `{ id, placements }`.
