export interface OverviewStats {
    bits: number;
    cells: number;
    attachments: number;
    contents: number;
    orphans: number;
    subscriptions: number;
    clientCount: number;
    plugins: string[];
    pluginSummary: { active: number; total: number; errored: number };
    version: string;
    uptimeSeconds: number;
    storage: { journal: string; allocatedBytes: number; backupCount: number };
    kinds: { kind: string; count: number }[];
    performance: OverviewPerformance;
    recent: { id: string; time: number; name: string; category: string; kind?: string }[];
}

export interface OverviewPerformance {
    recentEvents: number;
    queryP95: number | null;
    mutationP95: number | null;
    throughputSeries: number[];
}
