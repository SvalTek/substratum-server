# Authentication & Clients

Except for `GET /api/v1/health` and `POST /api/auth/login` (plus static assets and `/login`), every route requires authentication.

## Authentication Methods

Substratum Server supports three authentication methods:

| Method | Header / Cookie | Access Scope |
| --- | --- | --- |
| **Dashboard Session** | `Cookie: substratum_session=<token>` | Full management & `/api/v1/*` access. Non-GET requests require same-origin `Origin` header. |
| **Management Bearer** | `Authorization: Bearer <MANAGEMENT_TOKEN>` | Full management & `/api/v1/*` access. |
| **Client Bearer** | `Authorization: Bearer <secret>` + `X-Substratum-Client: <encoded-id>` | `/api/v1/*` spatial & content APIs only; management endpoints return `403`. |

## Dashboard Sessions

- Passwords are verified using Bun's Argon2id implementation (`Bun.password.verify`) and login attempts are rate-limited per client address (10 attempts per 15-minute window).
- On `POST /api/auth/login`, an `HttpOnly`, `SameSite=Lax` cookie (`substratum_session`) is issued, with only its SHA-256 hash stored in SQLite.
- You can revoke all active dashboard sessions at any time from **Settings** or via `POST /api/v1/operator/settings` with `{ "operation": "revoke-sessions", "confirm": "revoke-sessions" }`.

## Client Credentials

Issue separate credentials for each application worker or service instead of sharing `MANAGEMENT_TOKEN`:

```sh
curl -X POST http://127.0.0.1:4321/api/v1/clients \
  -H "Authorization: Bearer <MANAGEMENT_TOKEN>" \
  -H "Content-Type: application/json" \
  -d '{"operation": "issue", "clientId": "survey-worker"}'
```

The `issue` operation returns `{ "clientId": "survey-worker", "secret": "..." }` (`201`). **The secret is returned only once** — only its SHA-256 hash is stored in SQLite.

When authenticating as a client, send **both** headers:

```sh
curl -H "Authorization: Bearer <client-secret>" \
  -H "X-Substratum-Client: survey-worker" \
  http://127.0.0.1:4321/api/v1/stats
```

> **Note:** `X-Substratum-Client` must be percent-encoded (`encodeURIComponent(clientId)`).

### Reroll and Burn

- **Reroll** (`{ "operation": "reroll", "clientId": "..." }`): Generates a new secret (`200`), invalidates the previous secret, and immediately closes all active SSE streams for that client.
- **Burn** (`{ "operation": "burn", "clientId": "..." }`): Deletes the client (`204`) and immediately closes all active SSE streams. Content records created by the client remain in the shared world.
