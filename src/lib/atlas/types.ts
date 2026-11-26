import type { Address } from '@svaltek/substratum';

export interface Snapshot {
    readonly format: 'substratum-atlas/1';
    readonly bits: number;
    readonly contents: readonly { id: string; kind: string; payload: unknown }[];
    readonly cells: readonly {
        address: Address;
        metadata: Record<string, unknown>;
        attachments: readonly { id: string; metadata: Record<string, unknown> }[];
    }[];
}

export interface AtlasStats {
    readonly cells: number;
    readonly attachments: number;
    readonly contents: number;
    readonly orphans: number;
}

export interface RuntimeChange {
    readonly regions: readonly Address[];
    readonly contentIds: readonly string[];
    readonly reset?: boolean;
}

export type AtlasDelta = Pick<Snapshot, 'cells' | 'contents'>;
