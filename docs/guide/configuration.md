# Configuration & Deployment

Substratum Server is configured through environment variables (or a local `.env` file during development). Keep `.env` private and out of version control.

## Environment Variables

| Variable | Default | Constraints / Purpose |
| --- | --- | --- |
| `HOST` | `127.0.0.1` | Listener address. Keep local when placing a reverse proxy or tunnel in front. |
| `PORT` | `4321` | HTTP port (`1`–`65535`). |
| `DATABASE_PATH` | `./data/substratum.sqlite` | SQLite database path (relative to the package folder unless absolute). |
| `PLUGINS_DIR` | `./plugins` | Directory scanned on startup for TypeScript/JavaScript plugin modules. |
| `SUBSTRATUM_BITS` | `16` | Signed coordinate bit depth (`1`–`32`) used when creating a new database. |
| `DASHBOARD_PASSWORD` | *required* | Password for the `/login` page. Must be at least 12 characters and not start with `replace-with-`. |
| `MANAGEMENT_TOKEN` | *required* | Operator Bearer token with full administrative API access. Must be at least 32 characters and not start with `replace-with-`. |
| `SESSION_TTL_SECONDS` | `43200` | Dashboard session cookie lifetime (`300` seconds to `604800` seconds / 7 days). |
| `COOKIE_SECURE` | `false` | Set `true` when browsers reach the server over HTTPS (automatically enabled when `PUBLIC_ORIGIN` uses `https:`). |
| `PUBLIC_ORIGIN` | *unset* | Public origin (e.g. `https://atlas.example.com`) when a reverse proxy presents a different origin internally. |

## Security Headers

All responses pass through the Astro middleware, which sets:

- `X-Content-Type-Options: nosniff`
- `X-Frame-Options: DENY`
- `Referrer-Policy: no-referrer`
- `Permissions-Policy: camera=(), microphone=(), geolocation=()`
- `Strict-Transport-Security: max-age=31536000` (when served over HTTPS or `COOKIE_SECURE=true`)

## Reverse Proxies & Tunnels

The default listener binds to `127.0.0.1:4321`. When exposing the server through **Cloudflare Tunnel**, **Nginx**, or **Caddy**:

1. Point the tunnel or proxy upstream to `http://127.0.0.1:4321`.
2. Set `COOKIE_SECURE=true` so the `substratum_session` cookie is marked `Secure`.
3. Set `PUBLIC_ORIGIN=https://your-domain.example` if the proxy forwards a different `Host` or scheme than the browser sees, so login redirects and same-origin checks match the public origin.
4. Rotate `MANAGEMENT_TOKEN` by updating `.env` and restarting the server.
