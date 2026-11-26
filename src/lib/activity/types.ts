import type { Address } from '@svaltek/substratum';
import type { Principal } from '../principal';

export type ActivityCategory = 'mutation' | 'transition' | 'spatial' | 'veto' | 'custom' | 'diagnostic';

export interface ActivityEvent {
    id: string;
    time: number;
    name: string;
    category: ActivityCategory;
    regions: readonly Address[];
    contentId?: string;
    kind?: string;
    source?: string;
    level?: 'info' | 'warn' | 'error';
    principal: Principal;
    data: unknown;
}
