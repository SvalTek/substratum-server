# Substratum Server

Substratum Server is an optional Bun application that hosts a long-lived Substratum runtime, persists it in SQLite, and serves a protected Astro dashboard and HTTP API. It consumes `@svaltek/substratum`; server capabilities remain outside the core package.

## Run locally

Requires Bun 1.4.4 or newer. Copy `.env.example` to `.env`, then set a private dashboard password and management token. The example values are deliberately rejected at startup. For an existing install, rename `API_TOKEN` to `MANAGEMENT_TOKEN` and issue a separate credential for each application client.

```sh
cp .env.example .env
bun install
bun run dev --background
```

The default listener is `127.0.0.1:4321`. The SQLite file and plugin directory are created when the server starts. `SUBSTRATUM_BITS` applies when the database is first created; the stored value is used on later starts.

For a production server:

```sh
bun run build
bun run start
```

### Demo world

Start the server with `PORT=4383` and `DATABASE_PATH=./data/dashboard-demo.sqlite` to use a separate SQLite database. Run `bun run seed:demo` from this package to populate it through the API. The seeder requires an empty world and uses `MANAGEMENT_TOKEN` from the environment or local `.env`.

## Configuration

| Variable | Default | Purpose |
| --- | --- | --- |
| `HOST` | `127.0.0.1` | Listener address. Keep it local when a tunnel or reverse proxy connects to the server. |
| `PORT` | `4321` | HTTP port. |
| `DATABASE_PATH` | `./data/substratum.sqlite` | SQLite database path, relative to this package unless absolute. |
| `PLUGINS_DIR` | `./plugins` | Directory scanned for runtime plugin modules. |
| `SUBSTRATUM_BITS` | `16` | Coordinate resolution for a new database. |
| `DASHBOARD_PASSWORD` | required | Password used by the dashboard sign-in page; at least 12 characters. |
| `MANAGEMENT_TOKEN` | required | Operator Bearer token with administrative API access. Use at least 32 characters. |
| `SESSION_TTL_SECONDS` | `43200` | Dashboard session lifetime, from 300 seconds to 7 days. |
| `COOKIE_SECURE` | `false` | Set `true` when the browser uses HTTPS, including through a TLS tunnel or proxy. |
| `PUBLIC_ORIGIN` | unset | Public origin such as `https://atlas.example.com`; set this if the proxy changes the origin seen by Astro. |

The `.env` file is ignored by Git. Keep it readable only by the server account. Generate private values with a password manager or a cryptographically secure random generator.

## Plugins

At startup, the server scans the top level of `PLUGINS_DIR` in filename order. It imports `.ts`, `.mts`, `.js`, and `.mjs` files directly through Bun. No plugin prebuild is required. Each file must export either a default installer or a named `install` function. The installer receives the live Substratum instance and may return a cleanup function; registration goes through `world.use()` so Substratum owns plugin teardown.

```ts
// plugins/audit.ts
import type { ServerPluginContext, ServerWorld } from '../src/lib/runtime';

export default function install(world: ServerWorld, context: ServerPluginContext) {
    const stop = world.on('spatial:change', event => {
        if (!event.regions.length || !event.changes.some(change => 'kind' in change && change.kind !== 'audit')) return;
        context.transact(world => world.put(event.regions[0]!, { kind: 'audit' }, {
            plugin: context.name,
            clientId: context.principal.type === 'client' ? context.principal.clientId : null,
            regionCount: event.regions.length,
        }));
    });
    return stop;
}
```

Plugins are trusted server code with the server process's filesystem and network permissions. The server scans on startup. Restart it after adding or changing a plugin file. Use the Plugins page to enable or disable discovered plugins and configure the update interval. Return a cleanup function for registrations that require explicit teardown.

Use `context.transact()` for plugin writes so SQLite and the runtime commit together. Read `context.principal` inside the handler for the authenticated origin of the current operation. Use `context.emit()` for the activity feed and `context.log()` for plugin diagnostics. Keep synchronous handlers short.

The currently loaded names are available from `GET /api/v1/plugins` and `GET /api/v1/stats`.

## Storage model

SQLite is the durable source of truth. It stores content payloads by identity, cell addresses and metadata, and attachment metadata as separate records. Indexes inside Substratum are rebuilt when the process starts. Orphan content is retained. WAL mode, foreign keys, and full synchronous commits are enabled.

Every API mutation runs through a Substratum batch inside a SQLite transaction. Lifecycle events write the affected rows. If an observer or database write fails after Substratum has committed its in-memory change, the server reloads the runtime from SQLite before returning the error. JSON-incompatible content payloads are rejected because they cannot be recovered after restart.

`GET /api/v1/snapshot` exports the world as `substratum-atlas/1`. `POST /api/v1/snapshot` requires management access and the header `X-Confirm-Snapshot: replace`. The server saves a backup of the current world first and requires the imported snapshot to match the stored bit resolution. Snapshots preserve unattached content and placements. Use Storage to validate SQLite and the runtime, manage backups, or collect orphan records.

## API

Except for `GET /api/v1/health` and dashboard login, requests require authentication. Dashboard requests use a session cookie. Session-authenticated writes also require a same-origin `Origin` header. Operators can send `Authorization: Bearer <management-token>`.

Issue application credentials in Clients & Credentials or through `POST /api/v1/clients` with `{ "operation": "issue", "clientId": "survey-worker" }`. The response returns the secret once. Send the client ID as a percent-encoded header value using `encodeURIComponent(clientId)` and the issued secret as the Bearer token.

```sh
curl -H "Authorization: Bearer <client-secret>" \
     -H "X-Substratum-Client: survey-worker" http://127.0.0.1:4321/api/v1/stats
```

Reroll replaces the secret for the same client ID. Burning removes the credential. Both operations disconnect the affected client's active streams and leave its content records in the shared world. Operator endpoints accept either a dashboard session or the management token.

| Endpoint | Method | Purpose |
| --- | --- | --- |
| `/api/v1/health` | `GET` | Minimal liveness check. |
| `/api/v1/stats` | `GET` | Runtime counts, coordinate bits, and loaded plugins. |
| `/api/v1/plugins` | `GET` | Loaded plugin names. |
| `/api/v1/snapshot` | `GET`, `POST` | Export or replace the full world using Atlas snapshot format. |
| `/api/v1/cells?address=<json>` | `GET` | Inspect an exact cell address, e.g. `?address=["101","","10"]`. |
| `/api/v1/cells/search` | `POST` | Search occupied cells by `{ region, overlap?, limit? }`. |
| `/api/v1/cells` | `DELETE` | Clear an exact cell using `{ address }`. |
| `/api/v1/cells/metadata` | `PATCH` | Replace cell metadata using `{ address, metadata }`. |
| `/api/v1/search` | `POST` | Search attachments by `{ region?, kind?, where?, tags?, overlap?, unique?, limit? }`. |
| `/api/v1/nearest` | `POST` | Find nearest unique content by `{ at, kind?, where?, tags?, limit? }`. |
| `/api/v1/radius` | `POST` | Find nearby unique content by `{ at, radius, kind?, where?, tags?, limit? }`. |
| `/api/v1/contents` | `GET`, `POST` | Browse paginated content or create with `{ kind, payload, address?, metadata? }`. |
| `/api/v1/contents/:id` | `GET`, `PATCH`, `DELETE` | Read, replace payload, or remove unattached content. |
| `/api/v1/contents/:id/placements` | `GET` | List every placement of a content identity. |
| `/api/v1/placements` | `POST`, `PATCH`, `DELETE` | Attach, update, or detach using `{ address, id, metadata? }`. Attachment metadata `kind` is filled from the content record and must match it if supplied. |
| `/api/v1/placements/move` | `POST` | Move content using `{ id, at, extent?, metadata? }`; box moves are capped at 10,000 cells. |
| `/api/v1/placements/relocate` | `POST` | Move one attachment with `{ id, from, to }`, retaining its metadata. |
| `/api/v1/geometry` | `POST` | Inspect bounds, enclosing cover and exact decomposition for `{ region }`. |
| `/api/v1/events` | `GET`, `POST` | Stream world changes or emit a global or spatial custom event with `{ name, data, region? }`. |
| `/api/v1/activity` | `GET` | Read the recent activity journal with management access. |
| `/api/v1/clients` | `GET`, `POST` | List clients, issue, reroll or burn credentials with management access. |
| `/api/v1/operator/:section` | `GET`, `POST` | Operator endpoints for plugins, storage, scheduler, diagnostics and settings. Browse contracts in API Explorer. |
| `/api/auth/login` | `POST` | Dashboard password login; body `{ "password": "…" }`. |
| `/api/auth/logout` | `POST` | Revoke the current dashboard session. |
| `/api/auth/session` | `GET` | Report the current authenticated session. |

`region` accepts an address tuple, inclusive bounds, or `{ "at": [x,y,z], "extent": n }`. Search and distance results are capped at 1,000 entries. Query endpoints report measured server time in `X-Query-Time-Ms`.

The server-sent event stream sends `ready` after subscribing and `change` for world updates. Use the compact change payload to request changed cells and content IDs through `POST /api/v1/atlas/delta`. On reconnect or a `reset` change, reload a snapshot or rerun the view's scoped query. Managers can connect with `?activity=1` to also receive journal entries.

## Dashboard and reverse proxies

The dashboard uses an HttpOnly, SameSite=Lax session cookie whose random token is stored only as a hash in SQLite. Password verification uses Bun's Argon2id support, and sign-in attempts are rate-limited per server-observed client address. The dashboard is served over Astro SSR: `/` is the section overview and `/atlas` is the live spatial view. Atlas is split into independently maintained header, stats, controls, map, and inspector components; its API, shared Nanostores state, and canvas renderer live outside those view components.

The default listener is localhost-only. For Cloudflare Tunnel, point the tunnel at the local port. Set `COOKIE_SECURE=true` and set `PUBLIC_ORIGIN` to the public HTTPS origin if the application sees an internal HTTP origin. Rotate the management token by updating `.env` and restarting the server.

The dashboard response includes security headers and Astro-generated Content Security Policy hashes. HTTPS termination and tunnel access controls remain responsibilities of the reverse proxy.
