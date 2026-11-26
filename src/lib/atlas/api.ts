import type { Snapshot } from './types';

export async function fetchSnapshot(): Promise<Snapshot> {
    const response = await fetch('/api/v1/snapshot', {
        headers: { Accept: 'application/json' },
        cache: 'no-store',
    });
    if (response.status === 401) {
        window.location.assign('/login');
        throw new Error('Authentication required.');
    }
    if (!response.ok) throw new Error(`Snapshot request failed (${response.status}).`);
    return await response.json() as Snapshot;
}

export function subscribeToChanges(
    onChange: (event: MessageEvent<string>) => void,
    onDisconnect: () => void,
    onReady: () => void,
): () => void {
    const source = new EventSource('/api/v1/events');
    source.addEventListener('change', onChange);
    source.addEventListener('ready', onReady);
    source.onerror = onDisconnect;
    return () => source.close();
}

