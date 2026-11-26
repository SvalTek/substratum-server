interface Contract {
    method: 'GET' | 'POST' | 'PATCH' | 'DELETE';
    path: string;
    returns: string;
    body?: object;
    confirmation?: string;
}

export const contracts: { title: string; entries: Contract[] }[] = [
    {
        title: 'Runtime and geometry',
        entries: [
            { method: 'GET', path: '/api/v1/health', returns: 'Public health probe. Returns plain text ok.' },
            { method: 'GET', path: '/api/v1/stats?view=overview', returns: 'Counts, index statistics, server version, uptime, storage and content distribution. Omit view=overview for the compact runtime counts.' },
            { method: 'POST', path: '/api/v1/geometry', body: { region: { at: [0, 0, 0], extent: [8, 4, 8] } }, returns: 'Inclusive bounds, Enclosing address, exact address decomposition, coordinate bits.' },
            { method: 'GET', path: '/api/v1/snapshot', returns: 'substratum-atlas/1 JSON with format, bits, contents and cells.' },
            { method: 'POST', path: '/api/v1/snapshot', body: { format: 'substratum-atlas/1', bits: 16, contents: [], cells: [] }, returns: 'Replaces the world after backing up the current state. Management access required.', confirmation: 'replace' },
            { method: 'POST', path: '/api/v1/atlas/delta', body: { addresses: [['1', '1', '1']], contentIds: [] }, returns: 'Existing cells and content records for up to 256 requested keys. Missing records are omitted.' },
        ],
    },
    {
        title: 'Content, attachments and cells',
        entries: [
            { method: 'GET', path: '/api/v1/contents?page=1&q=&kind=&orphans=false', returns: 'Paginated items with id, kind and placement count, plus page, limit and total.' },
            { method: 'POST', path: '/api/v1/contents', body: { kind: 'observation', payload: { note: 'Survey completed' } }, returns: '201 with {id}. Optional address and attachment metadata create the first placement.' },
            { method: 'GET', path: '/api/v1/contents/{id}', returns: 'ID, kind, payload and all placement addresses.' },
            { method: 'PATCH', path: '/api/v1/contents/{id}', body: { payload: { note: 'Updated observation' } }, returns: 'Updated ID and payload.' },
            { method: 'DELETE', path: '/api/v1/contents/{id}', returns: 'Removal result. Attached content returns 409 until its placements are detached.' },
            { method: 'GET', path: '/api/v1/contents/{id}/placements', returns: 'ID and placement addresses.' },
            { method: 'GET', path: '/api/v1/cells?page=1', returns: 'Paginated cell addresses and attachment counts. Supply the address query parameter as a JSON tuple to get one cell with metadata and attachments.' },
            { method: 'PATCH', path: '/api/v1/cells/metadata', body: { address: ['1', '1', '1'], metadata: { surveyed: true } }, returns: 'Address and resulting cell.' },
            { method: 'DELETE', path: '/api/v1/cells', body: { address: ['1', '1', '1'] }, returns: 'Clears the cell and its attachments. Returns removal result.' },
            { method: 'POST', path: '/api/v1/placements', body: { id: '{id}', address: ['1', '1', '1'], metadata: { tags: ['survey'] } }, returns: '201 with ID and attached address.' },
            { method: 'PATCH', path: '/api/v1/placements', body: { id: '{id}', address: ['1', '1', '1'], metadata: { tags: ['reviewed'] } }, returns: 'ID, address and updated attachment metadata.' },
            { method: 'DELETE', path: '/api/v1/placements', body: { id: '{id}', address: ['1', '1', '1'] }, returns: 'Detachment result.' },
            { method: 'POST', path: '/api/v1/placements/relocate', body: { id: '{id}', from: ['1', '1', '1'], to: ['0', '1', '1'] }, returns: 'ID and destination of the relocated attachment.' },
            { method: 'POST', path: '/api/v1/placements/move', body: { id: '{id}', at: [10, 0, 10], extent: [2, 2, 2] }, returns: 'ID and replacement placements for the content identity.' },
        ],
    },
    {
        title: 'Queries and events',
        entries: [
            { method: 'POST', path: '/api/v1/search', body: { region: ['1', '', '1'], overlap: true, kind: 'observation', tags: ['survey'], where: {}, unique: true, limit: 50 }, returns: 'Array of matches. Set unique=false for attachment-level results. Query duration is in X-Query-Time-Ms.' },
            { method: 'POST', path: '/api/v1/cells/search', body: { region: [[-10, 10], [0, 4], [-10, 10]], overlap: true, limit: 50 }, returns: 'Array of cell snapshots and query duration in X-Query-Time-Ms.' },
            { method: 'POST', path: '/api/v1/nearest', body: { at: [0, 0, 0], limit: 20 }, returns: 'Nearest matching unique content records with distance and placement address.' },
            { method: 'POST', path: '/api/v1/radius', body: { at: [0, 0, 0], radius: 30, limit: 50 }, returns: 'Matching content records within radius with distance and placement address.' },
            { method: 'GET', path: '/api/v1/events', returns: 'Server-sent events. ready acknowledges the subscription. change carries regions and contentIds. A reset requests a fresh snapshot. Optional region query parameter scopes delivery. Management can add activity=1.' },
            { method: 'POST', path: '/api/v1/events', body: { name: 'survey:completed', data: { complete: true }, region: ['1', '', '1'] }, returns: 'Emits a custom event. Omit region for global delivery.' },
            { method: 'GET', path: '/api/v1/activity?limit=256', returns: 'Persisted SQLite activity journal with optional category, name, kind, contentId, source, limit and offset filters.' },
            { method: 'GET', path: '/api/v1/queries', returns: 'List server-persisted Query Workbench configurations. Supports POST { name, config } and DELETE { name }.' },
        ],
    },
    {
        title: 'Administration',
        entries: [
            { method: 'GET', path: '/api/v1/clients', returns: 'Client identifiers, timestamps and active stream counts.' },
            { method: 'POST', path: '/api/v1/clients', body: { operation: 'issue', clientId: 'survey-worker' }, returns: 'Issue and reroll return clientId and the new secret once. Burn returns 204. Reroll and burn close streams immediately.' },
            { method: 'GET', path: '/api/v1/plugins', returns: 'Names of active runtime plugins.' },
            { method: 'GET', path: '/api/v1/operator/plugins', returns: 'Filesystem plugin status and scheduler settings.' },
            { method: 'POST', path: '/api/v1/operator/plugins', body: { filename: 'example.ts', enabled: true }, returns: 'Updated plugin status.' },
            { method: 'POST', path: '/api/v1/operator/scheduler', body: { intervalMs: 1000 }, returns: 'Effective scheduler status. Use 0 to stop.' },
            { method: 'GET', path: '/api/v1/operator/diagnostics', returns: 'Process resources, indexes, subscriptions, performance measurements and recent errors.' },
            { method: 'GET', path: '/api/v1/operator/settings', returns: 'Effective startup settings, runtime controls and logging configuration.' },
            { method: 'POST', path: '/api/v1/operator/settings', body: { operation: 'revoke-sessions', confirm: 'revoke-sessions' }, returns: 'Revoked dashboard session count.' },
            { method: 'GET', path: '/api/v1/operator/storage', returns: 'Runtime and database counts, allocation, journal mode and recent backups.' },
            { method: 'POST', path: '/api/v1/operator/storage', body: { operation: 'validate' }, returns: 'Validates SQLite and runtime consistency. Also supports backup with label, restore with id and confirm=restore, and collect-orphans with confirm=collect-orphans.' },
            { method: 'GET', path: '/api/v1/operator/backup?id={id}', returns: 'The stored world snapshot for a backup.' },
            { method: 'GET', path: '/api/auth/session', returns: 'Dashboard session or management authentication method.' },
            { method: 'POST', path: '/api/auth/login', body: { password: '<dashboard-password>' }, returns: '204 and an HttpOnly session cookie. Use the dashboard sign-in form.' },
            { method: 'POST', path: '/api/auth/logout', returns: 'Invalidates the current dashboard session and closes its active streams.' },
        ],
    },
];
