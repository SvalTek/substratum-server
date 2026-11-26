const queries: number[] = [];
const mutations: number[] = [];
const eventCounts = new Map<number, number>();
const maxSamples = 512;

function append(samples: number[], value: number) {
    if (samples.length === maxSamples) samples.shift();
    samples.push(value);
}

export function recordEvent() {
    const second = Math.floor(Date.now() / 1000);
    eventCounts.set(second, (eventCounts.get(second) ?? 0) + 1);
    for (const time of eventCounts.keys()) {
        if (time > second - 60) break;
        eventCounts.delete(time);
    }
}

export function recordMutation(ms: number) { append(mutations, ms); }
export function recordQuery(ms: number) { append(queries, ms); }

function summary(values: number[]) {
    if (!values.length) return { samples: 0, p50: null, p95: null, avg: null };
    const sorted = [...values].sort((a, b) => a - b);
    const total = sorted.reduce((sum, v) => sum + v, 0);
    return {
        samples: sorted.length,
        p50: sorted[Math.floor((sorted.length - 1) * 0.5)]!,
        p95: sorted[Math.ceil(sorted.length * 0.95) - 1]!,
        avg: total / sorted.length,
    };
}

export function metrics() {
    const nowSec = Math.floor(Date.now() / 1000);
    const cutoff = nowSec - 60;
    const recentEvents = [...eventCounts].reduce((sum, [time, count]) => time > cutoff ? sum + count : sum, 0);
    // 12 x 5-second buckets over the last 60 seconds for live throughput sparklines
    const buckets = Array.from({ length: 12 }, () => 0);
    for (const [time, count] of eventCounts) {
        if (time <= cutoff) continue;
        const idx = Math.min(11, Math.max(0, Math.floor((time - (nowSec - 59)) / 5)));
        buckets[idx]! += count;
    }
    return {
        queries: summary(queries),
        mutations: summary(mutations),
        recentEvents,
        throughputSeries: buckets,
    };
}
