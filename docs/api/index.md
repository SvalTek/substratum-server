# API Reference

Substratum Server exposes a JSON + Server-Sent Events (SSE) HTTP API under `/api/v1/*` and session management under `/api/auth/*`.

## Machine-Readable OpenAPI 3.1 Specification

Fetch the live OpenAPI 3.1.0 JSON contract directly from a running server:

```sh
curl -H "Authorization: Bearer <token>" \
  http://127.0.0.1:4321/api/v1/openapi.json
```

You can also browse and test every endpoint interactively on the `/api-explorer` dashboard page.

## Common Conventions

- **Authentication**: Send a dashboard session cookie, `Authorization: Bearer <MANAGEMENT_TOKEN>`, or `Authorization: Bearer <client-secret>` paired with `X-Substratum-Client: <percent-encoded-client-id>`. Only `GET /api/v1/health` and `POST /api/auth/login` are unauthenticated.
- **Errors**: Validation, auth, and runtime errors return JSON `{ "error": "..." }` with `400`, `401`, `403`, `404`, `409`, or `500`.
- **Query Timing**: Spatial query endpoints (`POST /api/v1/search`, `/api/v1/cells/search`, `/api/v1/nearest`, `/api/v1/radius`) return `X-Query-Time-Ms` and `Server-Timing` headers. Results are capped at `1000` items.
- **Regions**: A `Region` is either an `Address` (`[string, string, string]` of binary prefixes), `Bounds` (`[[xMin, xMax], [yMin, yMax], [zMin, zMax]]` integers), or a `BoxRegion` (`{ "at": [x, y, z], "extent"?: number | [dx, dy, dz] }`).

## Endpoint Groups

- **[Runtime & Geometry](/api/runtime-and-geometry)** — health, OpenAPI spec, stats, geometry decomposition, snapshots, and atlas delta.
- **[Content, Cells & Placements](/api/content-and-cells)** — content CRUD, cell inspection/metadata, and attachment placements.
- **[Queries, Events & Activity](/api/queries-and-events)** — spatial search, nearest/radius, SSE streaming, activity journal, and saved queries.
- **[Administration & Auth](/api/administration)** — clients, plugins, Lua workspace, scheduler, diagnostics, settings, storage, and auth.
