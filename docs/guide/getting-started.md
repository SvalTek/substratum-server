# Getting Started

## What is Substratum Server?

**Substratum Server** is an optional Bun application that hosts a long-lived `@svaltek/substratum` runtime, persists its state in SQLite, and serves a protected Astro operator dashboard and HTTP/SSE API.

Core spatial mechanics remain in `@svaltek/substratum`; Substratum Server adds:

1. **Durable SQLite persistence** with WAL mode, foreign keys, and transactional parity between the in-memory world and SQLite.
2. **An authenticated HTTP & SSE API** (`/api/v1/*`) with an OpenAPI 3.1.0 contract at `/api/v1/openapi.json`.
3. **An Astro operator dashboard** featuring the Atlas spatial view, Content & Cells browsers, Query Workbench, Lua & TypeScript plugin management, Storage backups, Diagnostics, and an interactive API Explorer.

## Prerequisites

- **Bun** `>= 1.4.4`

## Run Locally

Copy `.env.example` to `.env`, set a private dashboard password and management token, install dependencies, and start the dev server:

```sh
cp .env.example .env
bun install
bun run dev --background
```

> **Note:** The placeholder values in `.env.example` (`replace-with-...`) are deliberately rejected at startup. Generate private values with a password manager or a cryptographically secure random generator.

The default listener is `http://127.0.0.1:4321`. On first startup, Substratum Server automatically creates the SQLite database directory and `PLUGINS_DIR`. `SUBSTRATUM_BITS` applies when the database is first created; subsequent starts use the bit depth stored in the database.

## Production Build

```sh
bun run build
bun run start
```

## Demo World

To run an isolated demo database without touching your primary state:

```sh
PORT=4383 DATABASE_PATH=./data/dashboard-demo.sqlite bun run dev
```

With the server running and an empty world, populate sample data using `MANAGEMENT_TOKEN` from your environment or `.env`:

```sh
bun run seed:demo
```

## Next Steps

- [Configuration & Deployment](/guide/configuration) — environment variables, TLS, and reverse proxy setup.
- [Authentication & Clients](/guide/authentication) — dashboard sessions, management tokens, and scoped client credentials.
- [API Reference](/api/) — explore all endpoints and the machine-readable OpenAPI 3.1 specification.
