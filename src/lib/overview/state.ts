import { atom } from 'nanostores';
import { subscribeToChanges } from '../atlas/api';
import type { OverviewStats } from './types';

export const overviewStats = atom<OverviewStats | null>(null);
export const overviewConnection = atom<'Connecting' | 'Syncing' | 'Live' | 'Reconnecting'>('Connecting');
export const overviewError = atom('');

export function connectOverview(): () => void {
    const lifetime = new AbortController();
    let streamReady = false;
    let refreshNeeded = false;
    let loading = false;
    let loadingMetrics = false;
    let timer: ReturnType<typeof setTimeout> | undefined;

    function scheduleRefresh(delay = 350) {
        refreshNeeded = true;
        if (loading || timer || lifetime.signal.aborted) return;
        timer = setTimeout(() => {
            timer = undefined;
            void refresh();
        }, delay);
    }

    async function refresh() {
        refreshNeeded = false;
        loading = true;
        let failed = false;
        try {
            const response = await fetch('/api/v1/stats?view=overview', {
                cache: 'no-store', signal: lifetime.signal,
            });
            if (response.status === 401) {
                window.location.assign('/login');
                return;
            }
            if (!response.ok) throw new Error(`Statistics request failed (${response.status}).`);
            const stats = await response.json() as OverviewStats;
            if (lifetime.signal.aborted) return;
            overviewStats.set(stats);
            overviewError.set('');
            if (streamReady && !refreshNeeded) overviewConnection.set('Live');
        } catch (error) {
            if (lifetime.signal.aborted) return;
            failed = true;
            overviewError.set(error instanceof Error ? error.message : 'Statistics unavailable.');
            if (streamReady) overviewConnection.set('Syncing');
        } finally {
            loading = false;
            if (failed || refreshNeeded) scheduleRefresh(failed ? 3000 : 350);
        }
    }

    const disconnect = subscribeToChanges(() => scheduleRefresh(), () => {
        streamReady = false;
        overviewConnection.set('Reconnecting');
        scheduleRefresh();
    }, () => {
        streamReady = true;
        overviewConnection.set('Syncing');
        scheduleRefresh(0);
    });

    void refresh();

    const updateMetrics = setInterval(async () => {
        if (loadingMetrics || document.hidden || overviewConnection.get() !== 'Live') return;
        loadingMetrics = true;
        try {
            const response = await fetch('/api/v1/stats?view=metrics', { cache: 'no-store', signal: lifetime.signal });
            if (!response.ok || lifetime.signal.aborted) return;
            const metrics = await response.json() as Pick<OverviewStats, 'clientCount' | 'pluginSummary' | 'performance' | 'recent'>;
            const stats = overviewStats.get();
            if (stats && !lifetime.signal.aborted) overviewStats.set({ ...stats, ...metrics });
        } catch { /* Handled by stream/full refresh */ }
        finally { loadingMetrics = false; }
    }, 5000);

    return () => {
        lifetime.abort();
        disconnect();
        clearTimeout(timer);
        clearInterval(updateMetrics);
    };
}
