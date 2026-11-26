# Streaming & Events

Substratum Server provides a Server-Sent Events (SSE) stream at `GET /api/v1/events` for live spatial updates, plus `POST /api/v1/events` for emitting custom spatial events.

## Subscribing to Changes (`GET /api/v1/events`)

Connect with a dashboard session, management token, or client credentials:

```sh
curl -N \
  -H "Authorization: Bearer <client-secret>" \
  -H "X-Substratum-Client: survey-worker" \
  http://127.0.0.1:4321/api/v1/events
```

### Query Parameters

- `region` *(optional)*: JSON-encoded `Region` (e.g. `?region=["1","","1"]` or `?region={"at":[0,0,0],"extent":16}`) to scope `change` delivery to mutations intersecting that region.
- `activity=1` *(optional, management only)*: Also stream `activity` journal events. Client Bearer tokens receive `403`.

### Event Types

- `ready`: Sent immediately after subscription (`data: {}`).
- `change`: Sent when a spatial mutation commits. Carries `{ regions, contentIds }`. If `regions.length + contentIds.length > 256`, the server sends `{ regions: [], contentIds: [], reset: true }`.
- `activity`: Sent when `activity=1` is active (management only).
- Heartbeat comments (`: keep-alive`) are sent every 15 seconds.

## Incremental Resynchronization (`POST /api/v1/atlas/delta`)

When your client receives a `change` event with `regions` and `contentIds`, fetch only the updated records in one batch (up to 256 combined keys):

```json
{
  "addresses": [["1", "1", "1"]],
  "contentIds": ["example-content-id"]
}
```

On SSE reconnect or when a `change` event arrives with `reset: true`, reload the full snapshot (`GET /api/v1/snapshot`) or re-run your scoped spatial query (`POST /api/v1/search`).

## Emitting Custom Events (`POST /api/v1/events`)

Emit a custom event globally or scoped to a `region`:

```json
{
  "name": "survey:completed",
  "data": { "complete": true },
  "region": ["1", "", "1"]
}
```

Event names must match `^[A-Za-z][A-Za-z0-9:._-]*$` (max 100 characters) and cannot use reserved runtime prefixes (`mutation:`, `spatial:`, `update`).
