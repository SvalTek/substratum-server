import { AsyncLocalStorage } from 'node:async_hooks';

export type Principal =
    | { readonly type: 'management' }
    | { readonly type: 'dashboard' }
    | { readonly type: 'client'; readonly clientId: string }
    | { readonly type: 'system'; readonly source: string };

export const principalContext = new AsyncLocalStorage<Principal>();
const runtimePrincipal = Object.freeze({ type: 'system', source: 'runtime' } as const);

export function currentPrincipal(): Principal {
    return principalContext.getStore() ?? runtimePrincipal;
}
