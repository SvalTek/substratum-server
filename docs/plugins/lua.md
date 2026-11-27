# Lua Plugins & Modules

In addition to filesystem TypeScript plugins, Substratum Server includes a SQLite-backed Lua plugin host (`webluabridge`) with an in-browser **Lua Editor** in the dashboard.

## Lua Plugins & Shared Modules

- **Lua Plugins** have an `id` (`^[a-z0-9][a-z0-9_-]{0,63}$`), `name`, `description`, `version`, `entrypoint` (default `main.lua`), `config` object, `enabled` flag, and one or more source `files`.
- **Shared Modules** have a `name` (`^[A-Za-z_][A-Za-z0-9_.-]{0,63}$`), `description`, and Lua `content`, allowing multiple Lua plugins to share reusable helpers.

## Lua Runtime API

Lua plugins receive three read-only binding namespaces (`world`, `geometry`, `plugin`) plus `json` bindings from `webluabridge`. All writes through `plugin.*` automatically execute inside a SQLite-backed transaction, and `plugin.transact(fn)` batches multiple reads and writes atomically.

### `world` Namespace

| Method | Arguments | Returns | Description |
| --- | --- | --- | --- |
| `world.stats()` | — | `table` | Runtime statistics (`cells`, `attachments`, `contents`, `orphans`, `bits`). |
| `world.getCell(address)` | `string[3]` | `table \| nil` | Inspect a cell at an exact binary-prefix address. |
| `world.getContent(id)` | `string` | `any` | Read a content payload by content ID. |
| `world.hasContent(id)` | `string` | `boolean` | Check whether a content ID exists. |
| `world.placements(id)` | `string` | `Address[]` | List all cell addresses where a content ID is attached. |
| `world.orphans()` | — | `string[]` | List all unattached content IDs. |
| `world.search(region?, options?)` | `Region?, table?` | `table[]` | Search attachments in a region (`options.limit` defaults to `250`). |
| `world.searchContent(region?, options?)` | `Region?, table?` | `table[]` | Search unique content records in a region (`options.limit` defaults to `250`). |
| `world.nearest(at, options?)` | `number[3], table?` | `table[]` | Find nearest unique content records from `[x, y, z]`. |
| `world.nearestAttachments(at, options?)` | `number[3], table?` | `table[]` | Find nearest attachment records from `[x, y, z]`. |
| `world.radius(at, radius, options?)` | `number[3], number, table?` | `table[]` | Find unique content records within `radius` of `[x, y, z]`. |
| `world.radiusAttachments(at, radius, options?)` | `number[3], number, table?` | `table[]` | Find attachment records within `radius` of `[x, y, z]`. |

### `geometry` Namespace

| Method | Arguments | Returns | Description |
| --- | --- | --- | --- |
| `geometry.encode(value)` | `number` | `string` | Encode a signed integer coordinate into a binary string. |
| `geometry.decode(prefix)` | `string` | `number[2]` | Decode a binary prefix string into an inclusive `[min, max]` interval. |
| `geometry.address(address)` | `string[3]` | `Address` | Validate and normalize a 3-axis binary-prefix address tuple. |
| `geometry.point(xyz)` | `number[3]` | `Address` | Encode an `[x, y, z]` integer coordinate into an exact cell address. |
| `geometry.cover(region)` | `Region` | `Address` | Compute the minimal enclosing cell address for a region. |
| `geometry.bounds(region)` | `Region` | `Bounds` | Return inclusive `[[x0, x1], [y0, y1], [z0, z1]]` bounds for a region. |
| `geometry.extentBounds(xyz, extent?)` | `number[3], number \| number[3]?` | `Bounds` | Compute inclusive bounds for `[x, y, z]` with optional extent. |
| `geometry.decompose(region, maxBoxes?)` | `Region, number?` | `Address[]` | Decompose a region into exact binary-prefix addresses (default `maxBoxes = 256`). |
| `geometry.decomposeExtent(xyz, extent?, maxBoxes?)` | `number[3], number \| number[3]?, number?` | `Address[]` | Decompose an `[x, y, z]` + extent box into exact binary-prefix addresses. |
| `geometry.decomposeBounds(bounds, maxBoxes?)` | `Bounds, number?` | `Address[]` | Decompose inclusive `Bounds` into exact binary-prefix addresses. |

### `plugin` Namespace

| Method | Arguments | Returns | Description |
| --- | --- | --- | --- |
| `plugin.put(address, metadata, payload)` | `Address, table, any` | `string` | Create and attach content at an address inside a transaction. |
| `plugin.putPoint(xyz, metadata, payload, options?)` | `number[3], table, any, table?` | `string` | Create and attach content across an `[x, y, z]` + extent box. |
| `plugin.createContent(kind, payload)` | `string, any` | `string` | Create an unattached content record inside a transaction. |
| `plugin.setContent(id, payload)` | `string, any` | `string` | Replace the JSON payload of an existing content ID. |
| `plugin.touchContent(id)` | `string` | `string` | Re-emit a content update without changing its payload. |
| `plugin.removeContent(id)` | `string` | `boolean` | Remove an unattached content record. |
| `plugin.attach(address, id, metadata?)` | `Address, string, table?` | `string` | Attach an existing content ID to an address. |
| `plugin.attachPoint(xyz, id, metadata?, options?)` | `number[3], string, table?, table?` | `string` | Attach an existing content ID across an `[x, y, z]` + extent box. |
| `plugin.updateAttachment(address, id, metadata)` | `Address, string, table` | `string` | Update metadata for an existing attachment at an address. |
| `plugin.moveContent(id, xyz, options?)` | `string, number[3], table?` | `Address[]` | Replace all placements of `id` with a new `[x, y, z]` + extent box. |
| `plugin.detach(address, id)` | `Address, string` | `boolean` | Detach a content ID from an address. |
| `plugin.detachAll(id)` | `string` | `number` | Detach all placements of a content ID. |
| `plugin.setCellMetadata(address, metadata)` | `Address, table` | `Address` | Replace metadata on a cell. |
| `plugin.clearCell(address)` | `Address` | `boolean` | Clear a cell and all of its attachments. |
| `plugin.clearPoint(xyz)` | `number[3]` | `boolean` | Clear the cell at an `[x, y, z]` coordinate. |
| `plugin.collectOrphans()` | — | `string[]` | Remove all unattached content records and return their IDs. |
| `plugin.transact(fn)` | `function` | `any` | Execute a Lua callback atomically inside one Substratum + SQLite transaction. |
| `plugin.on(event, handler, region?)` | `string, function, Region?` | `function` | Subscribe to any world event (custom, `spatial:change`, `mutation:*`, `update*`) optionally scoped to a `Region`. |
| `plugin.middleware(handler)` | `function` | `function` | Register synchronous mutation middleware. Return `false` to veto, or return a patch table (`{ metadata }` or `{ payload }`). |
| `plugin.emit(name, data?, region?)` | `string, any?, Region?` | `nil` | Emit a custom Substratum event globally or scoped to a region. |
| `plugin.log(level, message)` | `"info"\|"warn"\|"error", string` | `nil` | Write a structured diagnostic log entry for this plugin. |
| `plugin.principal()` | — | `table` | Return the authenticated principal for the current operation. |
| `plugin.getConfig(key, defaultVal?)` | `string, any?` | `any` | Read a configuration value for the current plugin. |
| `plugin.setConfig(key, value)` | `string, any` | `nil` | Persist a configuration key-value pair for the current plugin. |

## Dashboard & API Management

Lua plugins and modules can be authored, reloaded, and deleted without restarting the server via the **Lua Editor** or `GET` / `POST /api/v1/operator/lua` (management access required).

### Inspecting Lua Workspace (`GET /api/v1/operator/lua`)

- `GET /api/v1/operator/lua` — returns `{ plugins, sharedModules, docs }`.
- `GET /api/v1/operator/lua?plugin=<id>` — returns `{ plugin }` for a single plugin (`404` if missing).
- `GET /api/v1/operator/lua?docs=1` — returns `{ docs }` containing live Lua binding documentation.

### Mutating Lua Plugins & Modules (`POST /api/v1/operator/lua`)

| `operation` | Required Fields | Result |
| --- | --- | --- |
| `create-plugin` | `id`, `name`, optional `description`, `version`, `entrypoint`, `config`, `files`, `enabled` | Creates and registers a new Lua plugin (`{ plugin, plugins }`). |
| `save-plugin` | `id`, `name`, optional `description`, `version`, `entrypoint`, `config`, `files`, `enabled` | Updates an existing Lua plugin (`{ plugin, plugins }`). |
| `reload-plugin` | `id` | Reloads the plugin runtime (`{ plugin, plugins }`). |
| `delete-plugin` | `id` | Deletes the plugin (`{ deleted: true, plugins }`). |
| `save-module` | `name`, optional `description`, `content` | Creates or updates a shared Lua module (`{ module }`). |
| `delete-module` | `name` | Deletes a shared Lua module (`{ deleted: true }`). |
