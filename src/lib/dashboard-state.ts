import { atom } from 'nanostores';
import type { Snapshot } from './atlas/types';
import type { Address, Bounds } from '@svaltek/substratum';

export const atlasSnapshot = atom<Snapshot | null>(null);
export const atlasConnection = atom<'loading' | 'live' | 'offline'>('loading');
export const selectedAddress = atom<string | null>(null);
export const selectedContentId = atom<string | null>(null);
export const selectedKind = atom('');
export const selectedTag = atom('');
export const atlasHighlighted = atom<ReadonlySet<string>>(new Set());
export const atlasMarkedRegions = atom<readonly Address[]>([]);
export const atlasMetadata = atom<Record<string, unknown>>({});
export const atlasScope = atom<{ bounds: Bounds; overlap: boolean } | null>(null);

export const atlasShowPoints = atom(true);
export const atlasShowRegions = atom(true);
export const atlasShowMetaOnly = atom(true);
export const atlasShowLinks = atom(true);
export const atlasClusterSize = atom(16);
export const atlasVisibleRadius = atom(0);

export function addressKey(address: readonly string[]): string { return address.join('/'); }
