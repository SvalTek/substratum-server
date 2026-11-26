import type { Address } from '@svaltek/substratum';

export interface Page<T> { page: number; limit: number; total: number; items: T[] }
export interface ContentRow { id: string; kind: string; placements: number }
export interface ContentRecord { id: string; kind: string; payload: unknown; placements: Address[] }
export interface CellRow { address: Address; attachments: number }
export interface CellRecord {
    address: Address;
    metadata: Record<string, unknown>;
    attachments: { id: string; kind: string; metadata: Record<string, unknown> }[];
}

export function atlasLink(address?: Address, id?: string): string {
    const params = new URLSearchParams();
    if (address) params.set('address', JSON.stringify(address));
    if (id) params.set('content', id);
    return params.size ? `/atlas?${params}` : '/atlas';
}

export function cellLink(address: Address): string {
    return `/cells?address=${encodeURIComponent(JSON.stringify(address))}`;
}

export function formatAddress(address: Address) {
    return address.map(prefix => prefix || '*').join(' / ');
}
