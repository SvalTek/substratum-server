---
layout: home

hero:
  name: Substratum Server
  text: Persistent spatial runtime, dashboard, and HTTP/SSE API.
  tagline: Host a long-lived @svaltek/substratum world backed by SQLite WAL persistence, an Astro operator dashboard, TypeScript and Lua plugins, and an OpenAPI-documented REST & SSE interface.
  actions:
    - theme: brand
      text: Get Started
      link: /guide/getting-started
    - theme: alt
      text: Dashboard & Atlas
      link: /dashboard/
    - theme: alt
      text: API Reference
      link: /api/

features:
  - title: Durable SQLite Persistence
    details: Every API mutation runs inside a Substratum batch and SQLite WAL transaction. If a database or observer write fails, the runtime reloads cleanly from SQLite.
  - title: Astro Operator Dashboard
    details: Inspect the spatial world in Atlas, browse content and cells, run spatial queries, manage plugins and backups, and test endpoints in the schema-driven API Explorer.
  - title: OpenAPI 3.1 HTTP & SSE API
    details: Create, move, and query spatial content over JSON endpoints, stream scoped changes over Server-Sent Events, and fetch the machine-readable contract at /api/v1/openapi.json.
  - title: Scoped Client Credentials
    details: Issue, reroll, and burn per-client Bearer secrets alongside a dedicated management token and Argon2id-protected dashboard sessions.
  - title: TypeScript & Lua Plugins
    details: Load trusted Bun TypeScript plugins from PLUGINS_DIR or author, reload, and manage sandboxed Lua plugins and shared modules directly from SQLite.
  - title: Snapshots & Backups
    details: Export and import substratum-atlas/1 world snapshots, create labeled SQLite backups, validate runtime-to-database parity, and collect orphan content records.
---
