# TypeScript Plugins

Substratum Server scans the top level of `PLUGINS_DIR` (`./plugins` by default) in filename order at startup and imports `.ts`, `.mts`, `.js`, and `.mjs` files directly through Bun. No prebuild step is required.

> **Security:** TypeScript plugins run as trusted server code with the server process's filesystem and network permissions.

## Writing a Plugin

Export either a default installer or a named `install` function. The installer receives `(world, context)` and may return a cleanup function; registration goes through `world.use()` so Substratum owns teardown.

```ts
// plugins/audit.ts
import type { ServerPluginContext, ServerWorld } from '../src/lib/runtime';

export default function install(world: ServerWorld, context: ServerPluginContext) {
  const stop = world.on('spatial:change', (event) => {
    if (!event.regions.length || !event.changes.some((change) => 'kind' in change && change.kind !== 'audit')) {
      return;
    }

    context.transact((w) =>
      w.put(event.regions[0]!, { kind: 'audit' }, {
        plugin: context.name,
        clientId: context.principal.type === 'client' ? context.principal.clientId : null,
        regionCount: event.regions.length,
      }),
    );
  });

  return stop;
}
```

## Plugin Context Guidelines

- **`context.transact(fn)`**: Always wrap plugin writes in `context.transact()` so SQLite and the in-memory runtime commit atomically.
- **`context.principal`**: Inspect the authenticated origin (`dashboard`, `management`, or `client`) of the active operation.
- **`context.emit(...)`**: Emit events to the SQLite activity feed.
- **`context.log(...)`**: Write diagnostic log entries viewable from the **Plugins** dashboard page or `GET /api/v1/operator/plugins?logs=<source>`.
- Keep synchronous handlers short so event dispatch stays responsive.

## Managing Plugins & Scheduler

- Restart the server after adding or editing a TypeScript plugin file on disk.
- Use the **Plugins** dashboard page (or `POST /api/v1/operator/plugins`) to enable or disable discovered plugins at runtime.
- Configure the `world.update()` tick interval (`0` to stop, or `50`–`60000` ms) from **Plugins** or `POST /api/v1/operator/scheduler`.
- Active plugin names are exposed at `GET /api/v1/plugins` and `GET /api/v1/stats`.
