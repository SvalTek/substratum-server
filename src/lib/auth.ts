import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';
import { getConfig } from './config';
import { getDatabase } from './database';
import { authenticateClient, clientId } from './clients';

export type AuthResult =
    | { readonly method: 'session'; readonly principal: { readonly type: 'dashboard' }; readonly sessionHash: string; readonly expiresAt: number }
    | { readonly method: 'management'; readonly principal: { readonly type: 'management' } }
    | { readonly method: 'client'; readonly principal: { readonly type: 'client'; readonly clientId: string }; readonly revision: string };

export const SESSION_COOKIE = 'substratum_session';
const LOGIN_WINDOW_MS = 15 * 60 * 1000;
const LOGIN_MAX_ATTEMPTS = 10;
let passwordHash: Promise<string> | undefined;
const loginAttempts = new Map<string, number[]>();
const sessionStreams = new Map<string, Set<() => void>>();
let lastLoginPruneAt = 0;

function hash(value: string): string {
    return createHash('sha256').update(value).digest('hex');
}

function cookieValue(request: Request, name: string): string | undefined {
    const header = request.headers.get('cookie');
    if (!header) return undefined;
    for (const part of header.split(';')) {
        const separator = part.indexOf('=');
        if (separator < 0 || part.slice(0, separator).trim() !== name) continue;
        try { return decodeURIComponent(part.slice(separator + 1).trim()); }
        catch { return undefined; }
    }
    return undefined;
}

function tokenMatches(candidate: string): boolean {
    const expected = Buffer.from(getConfig().managementToken);
    const actual = Buffer.from(candidate);
    return actual.length === expected.length && timingSafeEqual(actual, expected);
}

export function authenticate(request: Request): AuthResult | undefined {
    const authorization = request.headers.get('authorization');
    if (authorization !== null) {
        const secret = /^Bearer ([^\s]+)$/i.exec(authorization)?.[1];
        if (!secret) return;
        const suppliedId = request.headers.get('x-substratum-client');
        if (suppliedId !== null) {
            let id: string;
            try { id = clientId(decodeURIComponent(suppliedId)); }
            catch { return; }
            const revision = authenticateClient(id, secret);
            return revision ? { method: 'client', principal: Object.freeze({ type: 'client', clientId: id }), revision } : undefined;
        }
        return tokenMatches(secret) ? { method: 'management', principal: Object.freeze({ type: 'management' }) } : undefined;
    }
    const session = cookieValue(request, SESSION_COOKIE);
    if (!session || !/^[A-Za-z0-9_-]{40,64}$/.test(session)) return undefined;
    const sessionHash = hash(session);
    const row = getDatabase().query('SELECT expires_at FROM sessions WHERE token_hash = ?').get(sessionHash) as { expires_at: number } | null;
    if (!row || row.expires_at <= Date.now()) {
        if (row) getDatabase().query('DELETE FROM sessions WHERE token_hash = ?').run(sessionHash);
        return undefined;
    }
    return { method: 'session', principal: Object.freeze({ type: 'dashboard' }), sessionHash, expiresAt: row.expires_at };
}

export function registerSessionStream(session: Extract<AuthResult, { method: 'session' }>, revoke: () => void): (() => void) | undefined {
    const { sessionHash, expiresAt } = session;
    if (expiresAt <= Date.now() || !getDatabase().query('SELECT 1 FROM sessions WHERE token_hash = ?').get(sessionHash)) return;
    const active = sessionStreams.get(sessionHash) ?? new Set();
    active.add(revoke);
    sessionStreams.set(sessionHash, active);
    const timeout = setTimeout(revoke, expiresAt - Date.now());
    return () => {
        clearTimeout(timeout);
        active.delete(revoke);
        if (!active.size && sessionStreams.get(sessionHash) === active) sessionStreams.delete(sessionHash);
    };
}

function revokeSessionStreams(sessionHash: string) {
    const active = sessionStreams.get(sessionHash);
    sessionStreams.delete(sessionHash);
    for (const revoke of active ?? []) revoke();
}

export function revokeAllSessions(): number {
    const { changes } = getDatabase().query('DELETE FROM sessions').run();
    for (const sessionHash of sessionStreams.keys()) revokeSessionStreams(sessionHash);
    return changes;
}

export async function verifyDashboardPassword(password: string, clientAddress: string): Promise<boolean> {
    const now = Date.now();
    if (now - lastLoginPruneAt >= 60_000) {
        for (const [address, attempts] of loginAttempts) {
            const recent = attempts.filter(time => time > now - LOGIN_WINDOW_MS);
            if (recent.length) loginAttempts.set(address, recent);
            else loginAttempts.delete(address);
        }
        lastLoginPruneAt = now;
    }
    const attempts = loginAttempts.get(clientAddress) ?? [];
    if (attempts.length >= LOGIN_MAX_ATTEMPTS) return false;
    attempts.push(now);
    loginAttempts.delete(clientAddress);
    loginAttempts.set(clientAddress, attempts);
    if (loginAttempts.size > 10_000) {
        const oldestAddress = loginAttempts.keys().next().value;
        if (oldestAddress) loginAttempts.delete(oldestAddress);
    }
    passwordHash ??= Bun.password.hash(getConfig().dashboardPassword, { algorithm: 'argon2id' });
    const valid = await Bun.password.verify(password, await passwordHash);
    if (valid) loginAttempts.delete(clientAddress);
    return valid;
}

export function createSession(): { token: string; cookie: string } {
    const config = getConfig();
    const token = randomBytes(32).toString('base64url');
    const expiresAt = Date.now() + config.sessionTtlSeconds * 1000;
    const db = getDatabase();
    db.query('DELETE FROM sessions WHERE expires_at <= ?').run(Date.now());
    db.query('INSERT INTO sessions(token_hash, expires_at) VALUES (?, ?)').run(hash(token), expiresAt);
    const attributes = [
        `${SESSION_COOKIE}=${encodeURIComponent(token)}`,
        'Path=/',
        'HttpOnly',
        'SameSite=Lax',
        `Max-Age=${config.sessionTtlSeconds}`,
    ];
    if (config.cookieSecure) attributes.push('Secure');
    return { token, cookie: attributes.join('; ') };
}

export function destroySession(request: Request): string {
    const token = cookieValue(request, SESSION_COOKIE);
    if (token && /^[A-Za-z0-9_-]{40,64}$/.test(token)) {
        const sessionHash = hash(token);
        getDatabase().query('DELETE FROM sessions WHERE token_hash = ?').run(sessionHash);
        revokeSessionStreams(sessionHash);
    }
    const attributes = [`${SESSION_COOKIE}=`, 'Path=/', 'HttpOnly', 'SameSite=Lax', 'Max-Age=0'];
    if (getConfig().cookieSecure) attributes.push('Secure');
    return attributes.join('; ');
}

export function isSameOrigin(request: Request): boolean {
    const origin = request.headers.get('origin');
    if (!origin) return false;
    const expected = getConfig().publicOrigin ?? new URL(request.url).origin;
    return origin === expected;
}
