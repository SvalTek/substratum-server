import { resolve } from 'node:path';

export interface ServerConfig {
    readonly host: string;
    readonly port: number;
    readonly databasePath: string;
    readonly pluginsDirectory: string;
    readonly bits: number;
    readonly dashboardPassword: string;
    readonly managementToken: string;
    readonly sessionTtlSeconds: number;
    readonly cookieSecure: boolean;
    readonly publicOrigin?: string;
}

let cached: ServerConfig | undefined;

function required(name: string): string {
    const value = process.env[name]?.trim();
    if (!value) throw new Error(`Missing required environment variable ${name}. Copy .env.example to .env and configure it.`);
    return value;
}

function integer(name: string, value: string, min: number, max: number): number {
    const parsed = Number(value);
    if (!Number.isSafeInteger(parsed) || parsed < min || parsed > max) {
        throw new Error(`${name} must be an integer between ${min} and ${max}.`);
    }
    return parsed;
}

export function getConfig(): ServerConfig {
    if (cached) return cached;
    const port = integer('PORT', process.env.PORT ?? '4321', 1, 65535);
    const bits = integer('SUBSTRATUM_BITS', process.env.SUBSTRATUM_BITS ?? '16', 1, 32);
    const sessionTtlSeconds = integer('SESSION_TTL_SECONDS', process.env.SESSION_TTL_SECONDS ?? '43200', 300, 604800);
    const publicOriginValue = process.env.PUBLIC_ORIGIN?.trim();
    const dashboardPassword = required('DASHBOARD_PASSWORD');
    const managementToken = required('MANAGEMENT_TOKEN');
    const publicOriginIsHttps = publicOriginValue ? new URL(publicOriginValue).protocol === 'https:' : false;
    if (dashboardPassword.length < 12 || dashboardPassword.startsWith('replace-with-')) {
        throw new Error('DASHBOARD_PASSWORD must be a private value of at least 12 characters.');
    }
    if (managementToken.length < 32 || managementToken.startsWith('replace-with-')) {
        throw new Error('MANAGEMENT_TOKEN must be a private value of at least 32 characters.');
    }
    let publicOrigin: string | undefined;
    if (publicOriginValue) {
        const parsed = new URL(publicOriginValue);
        if (parsed.origin !== publicOriginValue || !['http:', 'https:'].includes(parsed.protocol)) {
            throw new Error('PUBLIC_ORIGIN must be an origin such as https://atlas.example.com.');
        }
        publicOrigin = parsed.origin;
    }
    cached = Object.freeze({
        host: process.env.HOST?.trim() || '127.0.0.1',
        port,
        databasePath: resolve(process.env.DATABASE_PATH?.trim() || './data/substratum.sqlite'),
        pluginsDirectory: resolve(process.env.PLUGINS_DIR?.trim() || './plugins'),
        bits,
        dashboardPassword,
        managementToken,
        sessionTtlSeconds,
        cookieSecure: /^(1|true|yes)$/i.test(process.env.COOKIE_SECURE ?? 'false') || publicOriginIsHttps,
        ...(publicOrigin ? { publicOrigin } : {}),
    });
    return cached;
}
