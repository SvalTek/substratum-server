# Dashboard & Atlas

Substratum Server serves an Astro SSR operator dashboard protected by Argon2id password authentication and an `HttpOnly`, `SameSite=Lax` session cookie.

## Workspace Pages

| Route | Purpose |
| --- | --- |
| `/` | **Overview** — runtime counts, coordinate bit depth, content kind distribution, throughput sparklines, and recent activity. |
| `/atlas` | **Atlas** — interactive live spatial map with pan/zoom, region selection, cell & attachment inspector, and live SSE updates. |
| `/content` | **Content Explorer** — browse, filter, search, inspect, edit, and delete content identities and orphan records. |
| `/cells` | **Cells Workspace** — inspect cell addresses, edit cell metadata, and manage attachments. |
| `/query` | **Query Workbench** — run `search`, `cells/search`, `nearest`, and `radius` queries and save named query presets in SQLite. |
| `/events` | **Activity Feed** — live and historical activity journal with category, kind, content, and source filtering. |
| `/clients` | **Clients & Credentials** — issue, reroll, and burn scoped client Bearer credentials and monitor active SSE streams. |
| `/plugins` | **Plugins & Lua** — toggle discovered TypeScript plugins, configure the update scheduler, and author Lua plugins & shared modules. |
| `/diagnostics` | **Diagnostics** — process CPU/memory, uptime, query/mutation p95 metrics, and recent diagnostic errors. |
| `/storage` | **Storage** — SQLite vs runtime parity validation, named backups, snapshot restore, and orphan collection. |
| `/settings` | **Settings** — effective startup configuration, activity retention limits, and session revocation. |
| `/api-explorer` | **API Explorer** — interactive request builder and schema-driven OpenAPI 3.1.0 endpoint documentation. |

## API Explorer

The **API Explorer** (`/api-explorer`) combines:

1. **Request Builder**: Select HTTP method, edit the `/api/*` path, switch between **Dashboard session cookie** and **Bearer token** (with optional `X-Substratum-Client`), edit JSON payloads with live validation, and execute requests (including SSE stream previews).
2. **Schema-Driven Endpoint Reference**: Filterable, collapsible endpoint cards rendered directly from [openapi.ts](https://github.com/SvalTek/substratum-server/blob/main/src/lib/openapi.ts) showing parameters, request schemas, example payloads, response schemas, error codes, and one-click **Load** into the request builder.
