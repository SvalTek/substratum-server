import { createHash, randomBytes, randomUUID, timingSafeEqual } from 'node:crypto';
import { getDatabase } from './database';

export interface ClientCredentials {
    clientId: string;
    secret: string;
}

interface ClientRow {
    clientId: string;
    createdAt: number;
    rotatedAt: number | null;
    lastAuthenticatedAt: number | null;
}

export interface ClientInfo extends ClientRow {
    connections: number;
}

interface StoredCredential { hash: string; revision: string }
const connections = new Map<string, Set<() => void>>();
const generateSecret = () => randomBytes(32).toString('base64url');
const hashSecret = (secret: string) => createHash('sha256').update(secret).digest('hex');
const validSecret = /^[A-Za-z0-9_-]{43}$/;

export function clientId(value: unknown): string {
    if (typeof value !== 'string' || !value.trim() || value !== value.trim() ||
        Array.from(value).length > 128 || /[\p{Cc}\p{Cs}]/u.test(value)) {
        throw new TypeError('Client ID must be 1–128 characters without control characters or surrounding whitespace.');
    }
    return value;
}

function storedCredential(id: string): StoredCredential | null {
    return getDatabase().query<StoredCredential, [string]>(
        'SELECT secret_hash AS hash, revision FROM clients WHERE client_id = ?',
    ).get(id);
}

export function authenticateClient(id: string, secret: string): string | undefined {
    if (!validSecret.test(secret)) return;
    const stored = storedCredential(id);
    if (!stored || !timingSafeEqual(Buffer.from(stored.hash, 'hex'), Buffer.from(hashSecret(secret), 'hex'))) return;
    getDatabase().query('UPDATE clients SET last_authenticated_at = ? WHERE client_id = ?')
        .run(Date.now(), id);
    return stored.revision;
}

export function clientCredentialIsCurrent(id: string, revision: string): boolean {
    return storedCredential(id)?.revision === revision;
}

export function registerClientStream(id: string, revision: string, revoke: () => void): (() => void) | undefined {
    if (!clientCredentialIsCurrent(id, revision)) return;
    const active = connections.get(id) ?? new Set();
    connections.set(id, active);
    active.add(revoke);
    return () => {
        active.delete(revoke);
        if (!active.size && connections.get(id) === active) connections.delete(id);
    };
}

function revokeStreams(id: string): void {
    const active = connections.get(id);
    connections.delete(id);
    for (const revoke of active ?? []) revoke();
}

export function listClients(): ClientInfo[] {
    return getDatabase().query<ClientRow, []>(`
        SELECT client_id AS clientId, created_at AS createdAt, rotated_at AS rotatedAt,
            last_authenticated_at AS lastAuthenticatedAt FROM clients ORDER BY client_id
    `).all().map(row => ({ ...row, connections: connections.get(row.clientId)?.size ?? 0 }));
}

export function issueClient(id: string): ClientCredentials | undefined {
    const secret = generateSecret();
    const { changes } = getDatabase().query(`
        INSERT INTO clients (client_id, secret_hash, revision, created_at) VALUES (?, ?, ?, ?)
        ON CONFLICT(client_id) DO NOTHING
    `).run(id, hashSecret(secret), randomUUID(), Date.now());
    return changes ? { clientId: id, secret } : undefined;
}

export function rerollClient(id: string): ClientCredentials | undefined {
    const secret = generateSecret();
    const { changes } = getDatabase().query(`
        UPDATE clients SET secret_hash = ?, revision = ?, rotated_at = ? WHERE client_id = ?
    `).run(hashSecret(secret), randomUUID(), Date.now(), id);
    if (!changes) return;
    revokeStreams(id);
    return { clientId: id, secret };
}

export function burnClient(id: string): boolean {
    const { changes } = getDatabase().query('DELETE FROM clients WHERE client_id = ?').run(id);
    if (changes) revokeStreams(id);
    return Boolean(changes);
}
