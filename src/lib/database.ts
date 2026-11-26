import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { Database } from 'bun:sqlite';
import { getConfig } from './config';

let database: Database | undefined;

export function getDatabase(): Database {
    if (database) return database;
    const path = getConfig().databasePath;
    mkdirSync(dirname(path), { recursive: true });
    database = new Database(path, { strict: true, create: true });
    database.exec(`
        PRAGMA foreign_keys = ON;
        PRAGMA journal_mode = WAL;
        PRAGMA synchronous = FULL;
        PRAGMA busy_timeout = 5000;

        CREATE TABLE IF NOT EXISTS settings (
            key TEXT PRIMARY KEY,
            value TEXT NOT NULL
        ) STRICT;
        CREATE TABLE IF NOT EXISTS contents (
            id TEXT PRIMARY KEY,
            kind TEXT NOT NULL,
            payload_json TEXT NOT NULL
        ) STRICT;
        CREATE TABLE IF NOT EXISTS cells (
            address_key TEXT PRIMARY KEY,
            address_json TEXT NOT NULL,
            metadata_json TEXT NOT NULL
        ) STRICT;
        CREATE TABLE IF NOT EXISTS attachments (
            address_key TEXT NOT NULL REFERENCES cells(address_key) ON DELETE CASCADE,
            content_id TEXT NOT NULL REFERENCES contents(id) ON DELETE CASCADE,
            metadata_json TEXT NOT NULL,
            PRIMARY KEY(address_key, content_id)
        ) STRICT;
        CREATE INDEX IF NOT EXISTS attachments_by_content ON attachments(content_id);
        CREATE TABLE IF NOT EXISTS sessions (
            token_hash TEXT PRIMARY KEY,
            expires_at INTEGER NOT NULL
        ) STRICT;
        CREATE INDEX IF NOT EXISTS sessions_by_expiry ON sessions(expires_at);
        CREATE TABLE IF NOT EXISTS clients (
            client_id TEXT PRIMARY KEY,
            secret_hash TEXT NOT NULL,
            revision TEXT NOT NULL,
            created_at INTEGER NOT NULL,
            rotated_at INTEGER,
            last_authenticated_at INTEGER
        ) STRICT;
        CREATE TABLE IF NOT EXISTS backups (
            id TEXT PRIMARY KEY,
            label TEXT NOT NULL,
            created_at INTEGER NOT NULL,
            snapshot_json TEXT NOT NULL
        ) STRICT;
        CREATE TABLE IF NOT EXISTS activity_log (
            id TEXT PRIMARY KEY,
            time INTEGER NOT NULL,
            name TEXT NOT NULL,
            category TEXT NOT NULL,
            regions_json TEXT NOT NULL,
            content_id TEXT,
            kind TEXT,
            source TEXT,
            level TEXT,
            principal_json TEXT NOT NULL,
            data_json TEXT NOT NULL
        ) STRICT;
        CREATE INDEX IF NOT EXISTS activity_log_time ON activity_log(time DESC);
        CREATE INDEX IF NOT EXISTS activity_log_category ON activity_log(category, time DESC);
        CREATE INDEX IF NOT EXISTS activity_log_content ON activity_log(content_id, time DESC);
        CREATE TABLE IF NOT EXISTS saved_queries (
            id TEXT PRIMARY KEY,
            name TEXT NOT NULL UNIQUE,
            config_json TEXT NOT NULL,
            created_at INTEGER NOT NULL,
            updated_at INTEGER NOT NULL
        ) STRICT;
        CREATE TABLE IF NOT EXISTS lua_plugins (
            id TEXT PRIMARY KEY,
            name TEXT NOT NULL,
            description TEXT NOT NULL DEFAULT '',
            version TEXT NOT NULL DEFAULT '1.0.0',
            entrypoint TEXT NOT NULL DEFAULT 'main.lua',
            config_json TEXT NOT NULL DEFAULT '{}',
            enabled INTEGER NOT NULL DEFAULT 1,
            created_at INTEGER NOT NULL,
            updated_at INTEGER NOT NULL
        ) STRICT;
        CREATE TABLE IF NOT EXISTS lua_plugin_files (
            plugin_id TEXT NOT NULL REFERENCES lua_plugins(id) ON DELETE CASCADE,
            path TEXT NOT NULL,
            content TEXT NOT NULL,
            updated_at INTEGER NOT NULL,
            PRIMARY KEY(plugin_id, path)
        ) STRICT;
        CREATE TABLE IF NOT EXISTS lua_shared_modules (
            name TEXT PRIMARY KEY,
            description TEXT NOT NULL DEFAULT '',
            content TEXT NOT NULL,
            updated_at INTEGER NOT NULL
        ) STRICT;
    `);
    return database;
}
