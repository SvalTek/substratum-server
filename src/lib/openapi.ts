import { version } from '../../package.json';

export interface OpenApiParameter {
    name: string;
    in: 'path' | 'query' | 'header';
    required?: boolean;
    description: string;
    schema: OpenApiSchema;
    example?: unknown;
}

export interface OpenApiSchema {
    type?: string | string[];
    description?: string;
    format?: string;
    pattern?: string;
    enum?: readonly (string | number | boolean)[];
    default?: unknown;
    minimum?: number;
    maximum?: number;
    maxLength?: number;
    maxItems?: number;
    minItems?: number;
    items?: OpenApiSchema;
    properties?: Record<string, OpenApiSchema>;
    required?: readonly string[];
    additionalProperties?: boolean | OpenApiSchema;
    oneOf?: readonly OpenApiSchema[];
    nullable?: boolean;
    $ref?: string;
    'x-typeLabel'?: string;
}

export interface OpenApiMediaType {
    schema: OpenApiSchema;
    example?: unknown;
}

export interface OpenApiResponse {
    description: string;
    content?: Record<string, OpenApiMediaType>;
}

export interface OpenApiOperation {
    operationId: string;
    tags: readonly string[];
    summary: string;
    description: string;
    security?: readonly Record<string, readonly string[]>[];
    parameters?: readonly OpenApiParameter[];
    requestBody?: {
        required?: boolean;
        description?: string;
        content: Record<string, OpenApiMediaType>;
    };
    responses: Record<string, OpenApiResponse>;
    'x-loadPath'?: string;
    'x-confirmation'?: string;
}

export interface OpenApiSpec {
    openapi: '3.1.0';
    info: {
        title: string;
        version: string;
        description: string;
    };
    tags: readonly { name: string; description: string }[];
    components: {
        securitySchemes: Record<string, Record<string, unknown>>;
        schemas: Record<string, OpenApiSchema>;
    };
    paths: Record<string, Partial<Record<'get' | 'post' | 'patch' | 'delete', OpenApiOperation>>>;
}

const standardAuth: readonly Record<string, readonly string[]>[] = [
    { dashboardSession: [] },
    { managementBearer: [] },
    { clientBearer: [], clientIdHeader: [] },
];

const managementAuth: readonly Record<string, readonly string[]>[] = [
    { dashboardSession: [] },
    { managementBearer: [] },
];

const errorResponses = {
    '400': {
        description: 'Invalid JSON body, parameter, or validation failure.',
        content: { 'application/json': { schema: { $ref: '#/components/schemas/ErrorResponse' }, example: { error: 'Expected a JSON object.' } } },
    },
    '401': {
        description: 'Authentication required or credentials rejected.',
        content: { 'application/json': { schema: { $ref: '#/components/schemas/ErrorResponse' }, example: { error: 'Authentication required.' } } },
    },
};

const managementErrorResponses = {
    ...errorResponses,
    '403': {
        description: 'Management access required (client Bearer tokens are rejected).',
        content: { 'application/json': { schema: { $ref: '#/components/schemas/ErrorResponse' }, example: { error: 'Management access required.' } } },
    },
};

export const openApiSpec: OpenApiSpec = {
    openapi: '3.1.0',
    info: {
        title: 'Substratum Server API',
        version,
        description: 'Spatial content, attachment, query, streaming, and operator administration API for Substratum Server.',
    },
    tags: [
        { name: 'Runtime and geometry', description: 'Health probes, runtime statistics, geometry decomposition, snapshots, and OpenAPI schema.' },
        { name: 'Content, attachments and cells', description: 'CRUD operations for content identities, cell metadata, and spatial placements.' },
        { name: 'Queries and events', description: 'Spatial search, nearest/radius queries, SSE event streams, activity journal, and saved queries.' },
        { name: 'Administration', description: 'Client credentials, plugins, scheduler, diagnostics, settings, storage backups, and dashboard auth.' },
    ],
    components: {
        securitySchemes: {
            dashboardSession: {
                type: 'apiKey',
                in: 'cookie',
                name: 'substratum_session',
                description: 'HttpOnly dashboard session cookie issued by POST /api/auth/login.',
            },
            managementBearer: {
                type: 'http',
                scheme: 'bearer',
                description: 'Management bearer token configured on the server.',
            },
            clientBearer: {
                type: 'http',
                scheme: 'bearer',
                description: 'Client secret paired with the X-Substratum-Client header.',
            },
            clientIdHeader: {
                type: 'apiKey',
                in: 'header',
                name: 'X-Substratum-Client',
                description: 'Percent-encoded client ID required alongside clientBearer.',
            },
        },
        schemas: {
            ErrorResponse: {
                type: 'object',
                required: ['error'],
                properties: {
                    error: { type: 'string', description: 'Human-readable error message.' },
                },
            },
            Address: {
                type: 'array',
                'x-typeLabel': 'Address',
                description: 'Three binary prefix strings [x, y, z]. Empty string "" means unrestricted on that axis.',
                minItems: 3,
                maxItems: 3,
                items: { type: 'string', pattern: '^[01]*$' },
            },
            Vec3: {
                type: 'array',
                'x-typeLabel': 'Vec3',
                description: 'Three numeric coordinates [x, y, z].',
                minItems: 3,
                maxItems: 3,
                items: { type: 'number' },
            },
            Extent: {
                'x-typeLabel': 'number | Vec3',
                description: 'Uniform scalar extent or per-axis [dx, dy, dz] extent.',
                oneOf: [{ type: 'number' }, { $ref: '#/components/schemas/Vec3' }],
            },
            Bounds: {
                type: 'array',
                'x-typeLabel': 'Bounds',
                description: 'Inclusive integer intervals [[xMin, xMax], [yMin, yMax], [zMin, zMax]].',
                minItems: 3,
                maxItems: 3,
                items: {
                    type: 'array',
                    minItems: 2,
                    maxItems: 2,
                    items: { type: 'integer' },
                },
            },
            BoxRegion: {
                type: 'object',
                'x-typeLabel': 'BoxRegion',
                description: 'Origin coordinate with optional extent.',
                required: ['at'],
                properties: {
                    at: { $ref: '#/components/schemas/Vec3' },
                    extent: { $ref: '#/components/schemas/Extent' },
                },
            },
            Region: {
                'x-typeLabel': 'Region',
                description: 'Spatial region expressed as an Address tuple, inclusive Bounds, or BoxRegion ({ at, extent? }).',
                oneOf: [
                    { $ref: '#/components/schemas/Address' },
                    { $ref: '#/components/schemas/Bounds' },
                    { $ref: '#/components/schemas/BoxRegion' },
                ],
            },
            AttachmentMetadata: {
                type: 'object',
                'x-typeLabel': 'AttachmentMetadata',
                description: 'Optional attachment metadata object. Supports tags (string[]) and custom fields; kind is automatically aligned with content kind.',
                additionalProperties: true,
                properties: {
                    tags: { type: 'array', items: { type: 'string' }, maxItems: 32, description: 'Up to 32 tag strings (max 128 chars each).' },
                    kind: { type: 'string', description: 'Optional; if provided, must match the content kind.' },
                },
            },
            CellMetadata: {
                type: 'object',
                'x-typeLabel': 'CellMetadata',
                description: 'Arbitrary JSON key-value metadata stored on a spatial cell.',
                additionalProperties: true,
            },
            JsonValue: {
                'x-typeLabel': 'JSON value',
                description: 'Any valid JSON value (object, array, string, number, boolean, or null).',
            },
            WorldStats: {
                type: 'object',
                required: ['cells', 'attachments', 'contents', 'orphans'],
                properties: {
                    cells: { type: 'integer' },
                    attachments: { type: 'integer' },
                    contents: { type: 'integer' },
                    orphans: { type: 'integer' },
                },
            },
            CellSnapshot: {
                type: 'object',
                required: ['address', 'metadata', 'attachments'],
                properties: {
                    address: { $ref: '#/components/schemas/Address' },
                    metadata: { $ref: '#/components/schemas/CellMetadata' },
                    attachments: {
                        type: 'array',
                        items: {
                            type: 'object',
                            required: ['id', 'kind', 'metadata'],
                            properties: {
                                id: { type: 'string' },
                                kind: { type: 'string' },
                                metadata: { $ref: '#/components/schemas/AttachmentMetadata' },
                            },
                        },
                    },
                },
            },
            SearchResult: {
                type: 'object',
                required: ['address', 'id', 'kind', 'metadata', 'content'],
                properties: {
                    address: { $ref: '#/components/schemas/Address' },
                    id: { type: 'string' },
                    kind: { type: 'string' },
                    metadata: { $ref: '#/components/schemas/AttachmentMetadata' },
                    content: { $ref: '#/components/schemas/JsonValue' },
                },
            },
            DistanceResult: {
                type: 'object',
                required: ['address', 'id', 'kind', 'metadata', 'content', 'distance'],
                properties: {
                    address: { $ref: '#/components/schemas/Address' },
                    id: { type: 'string' },
                    kind: { type: 'string' },
                    metadata: { $ref: '#/components/schemas/AttachmentMetadata' },
                    content: { $ref: '#/components/schemas/JsonValue' },
                    distance: { type: 'number' },
                },
            },
            Snapshot: {
                type: 'object',
                required: ['format', 'bits', 'contents', 'cells'],
                properties: {
                    format: { type: 'string', enum: ['substratum-atlas/1'] },
                    bits: { type: 'integer' },
                    contents: {
                        type: 'array',
                        items: {
                            type: 'object',
                            required: ['id', 'kind', 'payload'],
                            properties: {
                                id: { type: 'string' },
                                kind: { type: 'string' },
                                payload: { $ref: '#/components/schemas/JsonValue' },
                            },
                        },
                    },
                    cells: { type: 'array', items: { $ref: '#/components/schemas/CellSnapshot' } },
                },
            },
            ClientCredentials: {
                type: 'object',
                required: ['clientId', 'secret'],
                properties: {
                    clientId: { type: 'string' },
                    secret: { type: 'string', description: '43-character base64url secret.' },
                },
            },
            SchedulerStatus: {
                type: 'object',
                required: ['intervalMs', 'running'],
                properties: {
                    intervalMs: { type: 'integer' },
                    running: { type: 'boolean' },
                },
            },
            LuaPluginEntity: {
                type: 'object',
                required: ['id', 'name', 'description', 'version', 'entrypoint', 'config', 'enabled', 'createdAt', 'updatedAt', 'files'],
                properties: {
                    id: { type: 'string' },
                    name: { type: 'string' },
                    description: { type: 'string' },
                    version: { type: 'string' },
                    entrypoint: { type: 'string' },
                    config: { type: 'object', additionalProperties: true },
                    enabled: { type: 'boolean' },
                    createdAt: { type: 'integer' },
                    updatedAt: { type: 'integer' },
                    files: {
                        type: 'array',
                        items: {
                            type: 'object',
                            required: ['path', 'content', 'updatedAt'],
                            properties: {
                                path: { type: 'string' },
                                content: { type: 'string' },
                                updatedAt: { type: 'integer' },
                            },
                        },
                    },
                },
            },
            LuaSharedModule: {
                type: 'object',
                required: ['name', 'description', 'content', 'updatedAt'],
                properties: {
                    name: { type: 'string' },
                    description: { type: 'string' },
                    content: { type: 'string' },
                    updatedAt: { type: 'integer' },
                },
            },
        },
    },
    paths: {
        // ── Runtime and geometry ──────────────────────────────────────────────
        '/api/v1/health': {
            get: {
                operationId: 'getHealth',
                tags: ['Runtime and geometry'],
                summary: 'Public health probe.',
                description: 'Lightweight unauthenticated readiness probe. Returns plain text "ok".',
                security: [],
                responses: {
                    '200': {
                        description: 'Server is healthy.',
                        content: { 'text/plain': { schema: { type: 'string', enum: ['ok'] }, example: 'ok' } },
                    },
                },
            },
        },
        '/api/v1/openapi.json': {
            get: {
                operationId: 'getOpenApiSpec',
                tags: ['Runtime and geometry'],
                summary: 'Machine-readable OpenAPI 3.1 specification.',
                description: 'Returns the full OpenAPI 3.1.0 JSON contract for Substratum Server.',
                security: standardAuth,
                responses: {
                    '200': {
                        description: 'OpenAPI 3.1.0 specification document.',
                        content: {
                            'application/json': {
                                schema: {
                                    type: 'object',
                                    required: ['openapi', 'info', 'tags', 'components', 'paths'],
                                    properties: {
                                        openapi: { type: 'string', enum: ['3.1.0'] },
                                        info: { type: 'object', additionalProperties: true },
                                        tags: { type: 'array', items: { type: 'object', additionalProperties: true } },
                                        components: { type: 'object', additionalProperties: true },
                                        paths: { type: 'object', additionalProperties: true },
                                    },
                                },
                                example: { openapi: '3.1.0', info: { title: 'Substratum Server API', version } },
                            },
                        },
                    },
                    '401': errorResponses['401'],
                },
            },
        },
        '/api/v1/stats': {
            get: {
                operationId: 'getStats',
                tags: ['Runtime and geometry'],
                summary: 'Runtime counts and optional overview or metrics view.',
                description: 'Returns bit depth, world counts, and active plugin names. Supplying ?view=overview or ?view=metrics requires management access.',
                security: standardAuth,
                'x-loadPath': '/api/v1/stats?view=overview',
                parameters: [
                    {
                        name: 'view',
                        in: 'query',
                        required: false,
                        description: 'Optional expanded view ("overview" or "metrics"). Management access required when set.',
                        schema: { type: 'string', enum: ['overview', 'metrics'] },
                    },
                ],
                responses: {
                    '200': {
                        description: 'Runtime statistics (or overview/metrics payload when ?view is set).',
                        content: {
                            'application/json': {
                                schema: {
                                    type: 'object',
                                    properties: {
                                        bits: { type: 'integer' },
                                        cells: { type: 'integer' },
                                        attachments: { type: 'integer' },
                                        contents: { type: 'integer' },
                                        orphans: { type: 'integer' },
                                        plugins: { type: 'array', items: { type: 'string' } },
                                        version: { type: 'string' },
                                        uptimeSeconds: { type: 'integer' },
                                        clientCount: { type: 'integer' },
                                        pluginSummary: {
                                            type: 'object',
                                            properties: {
                                                total: { type: 'integer' },
                                                active: { type: 'integer' },
                                                errored: { type: 'integer' },
                                            },
                                        },
                                        storage: {
                                            type: 'object',
                                            properties: {
                                                journal: { type: 'string' },
                                                allocatedBytes: { type: 'integer' },
                                                backupCount: { type: 'integer' },
                                            },
                                        },
                                        kinds: {
                                            type: 'array',
                                            items: {
                                                type: 'object',
                                                required: ['kind', 'count'],
                                                properties: { kind: { type: 'string' }, count: { type: 'integer' } },
                                            },
                                        },
                                        performance: {
                                            type: 'object',
                                            properties: {
                                                recentEvents: { type: 'integer' },
                                                queryP95: { type: ['number', 'null'] },
                                                mutationP95: { type: ['number', 'null'] },
                                                throughputSeries: { type: 'array', items: { type: 'integer' } },
                                            },
                                        },
                                        recent: { type: 'array', items: { type: 'object', additionalProperties: true } },
                                    },
                                },
                                example: { bits: 16, cells: 42, attachments: 64, contents: 50, orphans: 2, plugins: [] },
                            },
                        },
                    },
                    '401': errorResponses['401'],
                    '403': managementErrorResponses['403'],
                },
            },
        },
        '/api/v1/geometry': {
            post: {
                operationId: 'inspectGeometry',
                tags: ['Runtime and geometry'],
                summary: 'Compute bounds, enclosing address, and exact address decomposition for a region.',
                description: 'Evaluates a Region (Address, Bounds, or BoxRegion) against the server bit depth and returns inclusive bounds, enclosing cover address, and exact decomposition (null if > 256 boxes).',
                security: standardAuth,
                requestBody: {
                    required: true,
                    content: {
                        'application/json': {
                            schema: {
                                type: 'object',
                                properties: {
                                    region: { $ref: '#/components/schemas/Region', description: 'Region to inspect. Omit for the root world region.' },
                                },
                            },
                            example: { region: { at: [0, 0, 0], extent: [8, 4, 8] } },
                        },
                    },
                },
                responses: {
                    '200': {
                        description: 'Geometry decomposition result.',
                        content: {
                            'application/json': {
                                schema: {
                                    type: 'object',
                                    required: ['bounds', 'cover', 'exact', 'bits'],
                                    properties: {
                                        bounds: { $ref: '#/components/schemas/Bounds' },
                                        cover: { $ref: '#/components/schemas/Address' },
                                        exact: { type: ['array', 'null'], items: { $ref: '#/components/schemas/Address' } },
                                        bits: { type: 'integer' },
                                    },
                                },
                                example: {
                                    bounds: [[-4, 3], [-2, 1], [-4, 3]],
                                    cover: ['', '', ''],
                                    exact: [
                                        ['01111111111111', '011111111111111', '01111111111111'],
                                        ['01111111111111', '011111111111111', '10000000000000'],
                                        ['01111111111111', '100000000000000', '01111111111111'],
                                        ['01111111111111', '100000000000000', '10000000000000'],
                                        ['10000000000000', '011111111111111', '01111111111111'],
                                        ['10000000000000', '011111111111111', '10000000000000'],
                                        ['10000000000000', '100000000000000', '01111111111111'],
                                        ['10000000000000', '100000000000000', '10000000000000'],
                                    ],
                                    bits: 16,
                                },
                            },
                        },
                    },
                    ...errorResponses,
                },
            },
        },
        '/api/v1/snapshot': {
            get: {
                operationId: 'exportSnapshot',
                tags: ['Runtime and geometry'],
                summary: 'Export full world snapshot.',
                description: 'Returns a substratum-atlas/1 JSON snapshot containing bit depth, contents, and cells.',
                security: standardAuth,
                responses: {
                    '200': {
                        description: 'World snapshot.',
                        content: {
                            'application/json': {
                                schema: { $ref: '#/components/schemas/Snapshot' },
                                example: { format: 'substratum-atlas/1', bits: 16, contents: [], cells: [] },
                            },
                        },
                    },
                    '401': errorResponses['401'],
                },
            },
            post: {
                operationId: 'importSnapshot',
                tags: ['Runtime and geometry'],
                summary: 'Replace the world from a snapshot.',
                description: 'Backs up the current state, then replaces the world with the supplied substratum-atlas/1 snapshot. Requires management access and X-Confirm-Snapshot: replace.',
                security: managementAuth,
                'x-confirmation': 'replace',
                parameters: [
                    {
                        name: 'X-Confirm-Snapshot',
                        in: 'header',
                        required: true,
                        description: 'Must be set to "replace" to confirm destructive world replacement.',
                        schema: { type: 'string', enum: ['replace'] },
                    },
                ],
                requestBody: {
                    required: true,
                    content: {
                        'application/json': {
                            schema: { $ref: '#/components/schemas/Snapshot' },
                            example: { format: 'substratum-atlas/1', bits: 16, contents: [], cells: [] },
                        },
                    },
                },
                responses: {
                    '200': {
                        description: 'Snapshot imported.',
                        content: {
                            'application/json': {
                                schema: {
                                    type: 'object',
                                    required: ['imported', 'stats'],
                                    properties: {
                                        imported: { type: 'boolean' },
                                        stats: { $ref: '#/components/schemas/WorldStats' },
                                    },
                                },
                                example: { imported: true, stats: { cells: 0, attachments: 0, contents: 0, orphans: 0 } },
                            },
                        },
                    },
                    ...managementErrorResponses,
                },
            },
        },
        '/api/v1/atlas/delta': {
            post: {
                operationId: 'getAtlasDelta',
                tags: ['Runtime and geometry'],
                summary: 'Fetch specific cells and content records in one batch.',
                description: 'Returns existing cells and content records for up to 256 combined addresses and contentIds. Missing keys are omitted.',
                security: standardAuth,
                requestBody: {
                    required: true,
                    content: {
                        'application/json': {
                            schema: {
                                type: 'object',
                                required: ['addresses', 'contentIds'],
                                properties: {
                                    addresses: { type: 'array', items: { $ref: '#/components/schemas/Address' }, description: 'Cell addresses to fetch.' },
                                    contentIds: { type: 'array', items: { type: 'string' }, description: 'Content IDs to fetch.' },
                                },
                            },
                            example: { addresses: [['1', '1', '1']], contentIds: [] },
                        },
                    },
                },
                responses: {
                    '200': {
                        description: 'Existing cells and content records.',
                        content: {
                            'application/json': {
                                schema: {
                                    type: 'object',
                                    required: ['cells', 'contents'],
                                    properties: {
                                        cells: { type: 'array', items: { $ref: '#/components/schemas/CellSnapshot' } },
                                        contents: {
                                            type: 'array',
                                            items: {
                                                type: 'object',
                                                required: ['id', 'kind', 'payload'],
                                                properties: {
                                                    id: { type: 'string' },
                                                    kind: { type: 'string' },
                                                    payload: { $ref: '#/components/schemas/JsonValue' },
                                                },
                                            },
                                        },
                                    },
                                },
                                example: { cells: [], contents: [] },
                            },
                        },
                    },
                    ...errorResponses,
                },
            },
        },

        // ── Content, attachments and cells ────────────────────────────────────
        '/api/v1/contents': {
            get: {
                operationId: 'listContents',
                tags: ['Content, attachments and cells'],
                summary: 'List paginated content identities.',
                description: 'Returns a paginated list of content items with id, kind, and placement count.',
                security: standardAuth,
                'x-loadPath': '/api/v1/contents?page=1&q=&kind=&orphans=false',
                parameters: [
                    { name: 'page', in: 'query', required: false, description: '1-based page number (30 items per page).', schema: { type: 'integer', minimum: 1, default: 1 } },
                    { name: 'q', in: 'query', required: false, description: 'Case-insensitive substring filter on id or kind.', schema: { type: 'string', maxLength: 256 } },
                    { name: 'kind', in: 'query', required: false, description: 'Exact content kind filter.', schema: { type: 'string', maxLength: 256 } },
                    { name: 'orphans', in: 'query', required: false, description: 'Set to "true" to return only unattached content.', schema: { type: 'boolean', default: false } },
                ],
                responses: {
                    '200': {
                        description: 'Paginated content list.',
                        content: {
                            'application/json': {
                                schema: {
                                    type: 'object',
                                    required: ['page', 'limit', 'total', 'items'],
                                    properties: {
                                        page: { type: 'integer' },
                                        limit: { type: 'integer' },
                                        total: { type: 'integer' },
                                        items: {
                                            type: 'array',
                                            items: {
                                                type: 'object',
                                                required: ['id', 'kind', 'placements'],
                                                properties: {
                                                    id: { type: 'string' },
                                                    kind: { type: 'string' },
                                                    placements: { type: 'integer' },
                                                },
                                            },
                                        },
                                    },
                                },
                                example: { page: 1, limit: 30, total: 1, items: [{ id: 'example-content-id', kind: 'observation', placements: 1 }] },
                            },
                        },
                    },
                    ...errorResponses,
                },
            },
            post: {
                operationId: 'createContent',
                tags: ['Content, attachments and cells'],
                summary: 'Create a content identity with an optional initial spatial placement.',
                description: 'Creates a new content record. If address is provided, also creates the first attachment at that cell with optional attachment metadata.',
                security: standardAuth,
                requestBody: {
                    required: true,
                    content: {
                        'application/json': {
                            schema: {
                                type: 'object',
                                required: ['kind', 'payload'],
                                properties: {
                                    kind: { type: 'string', maxLength: 256, description: 'Content kind identifier.' },
                                    payload: { $ref: '#/components/schemas/JsonValue', description: 'Arbitrary JSON payload for the content identity.' },
                                    address: { $ref: '#/components/schemas/Address', description: 'Optional cell address for the initial placement.' },
                                    metadata: { $ref: '#/components/schemas/AttachmentMetadata', description: 'Optional metadata for the initial placement (only used when address is set).' },
                                },
                            },
                            example: {
                                kind: 'observation',
                                payload: { temperature: 21.5 },
                            },
                        },
                    },
                },
                responses: {
                    '201': {
                        description: 'Content created',
                        content: {
                            'application/json': {
                                schema: {
                                    type: 'object',
                                    required: ['id'],
                                    properties: { id: { type: 'string' } },
                                },
                                example: { id: 'example-content-id' },
                            },
                        },
                    },
                    ...errorResponses,
                    '409': {
                        description: 'Mutation rejected by runtime or plugin veto.',
                        content: { 'application/json': { schema: { $ref: '#/components/schemas/ErrorResponse' }, example: { error: 'The runtime rejected this mutation.' } } },
                    },
                },
            },
        },
        '/api/v1/contents/{id}': {
            get: {
                operationId: 'getContent',
                tags: ['Content, attachments and cells'],
                summary: 'Fetch a content record and its placements.',
                description: 'Returns the content ID, kind, JSON payload, and all attached cell addresses.',
                security: standardAuth,
                parameters: [
                    { name: 'id', in: 'path', required: true, description: 'Content identity ID.', schema: { type: 'string' } },
                ],
                responses: {
                    '200': {
                        description: 'Content record.',
                        content: {
                            'application/json': {
                                schema: {
                                    type: 'object',
                                    required: ['id', 'kind', 'payload', 'placements'],
                                    properties: {
                                        id: { type: 'string' },
                                        kind: { type: 'string' },
                                        payload: { $ref: '#/components/schemas/JsonValue' },
                                        placements: { type: 'array', items: { $ref: '#/components/schemas/Address' } },
                                    },
                                },
                                example: { id: 'example-content-id', kind: 'observation', payload: { temperature: 21.5 }, placements: [['1', '1', '1']] },
                            },
                        },
                    },
                    '401': errorResponses['401'],
                    '404': {
                        description: 'Content not found.',
                        content: { 'application/json': { schema: { $ref: '#/components/schemas/ErrorResponse' }, example: { error: 'Content not found.' } } },
                    },
                },
            },
            patch: {
                operationId: 'updateContent',
                tags: ['Content, attachments and cells'],
                summary: 'Replace a content record payload.',
                description: 'Updates the JSON payload of an existing content identity.',
                security: standardAuth,
                parameters: [
                    { name: 'id', in: 'path', required: true, description: 'Content identity ID.', schema: { type: 'string' } },
                ],
                requestBody: {
                    required: true,
                    content: {
                        'application/json': {
                            schema: {
                                type: 'object',
                                required: ['payload'],
                                properties: {
                                    payload: { $ref: '#/components/schemas/JsonValue', description: 'Replacement JSON payload.' },
                                },
                            },
                            example: { payload: { note: 'Updated observation' } },
                        },
                    },
                },
                responses: {
                    '200': {
                        description: 'Updated content payload.',
                        content: {
                            'application/json': {
                                schema: {
                                    type: 'object',
                                    required: ['id', 'payload'],
                                    properties: {
                                        id: { type: 'string' },
                                        payload: { $ref: '#/components/schemas/JsonValue' },
                                    },
                                },
                                example: { id: 'example-content-id', payload: { note: 'Updated observation' } },
                            },
                        },
                    },
                    ...errorResponses,
                    '409': {
                        description: 'Mutation rejected by runtime or plugin veto.',
                        content: { 'application/json': { schema: { $ref: '#/components/schemas/ErrorResponse' }, example: { error: 'The runtime rejected this mutation.' } } },
                    },
                },
            },
            delete: {
                operationId: 'deleteContent',
                tags: ['Content, attachments and cells'],
                summary: 'Delete an unattached content identity.',
                description: 'Removes the content identity. Returns 409 if the content still has spatial placements.',
                security: standardAuth,
                parameters: [
                    { name: 'id', in: 'path', required: true, description: 'Content identity ID.', schema: { type: 'string' } },
                ],
                responses: {
                    '200': {
                        description: 'Removal result.',
                        content: {
                            'application/json': {
                                schema: {
                                    type: 'object',
                                    required: ['removed'],
                                    properties: { removed: { type: 'boolean' } },
                                },
                                example: { removed: true },
                            },
                        },
                    },
                    '401': errorResponses['401'],
                    '409': {
                        description: 'Content still has placements or mutation was vetoed.',
                        content: { 'application/json': { schema: { $ref: '#/components/schemas/ErrorResponse' }, example: { error: 'Detach all placements before removing this content.' } } },
                    },
                },
            },
        },
        '/api/v1/contents/{id}/placements': {
            get: {
                operationId: 'getContentPlacements',
                tags: ['Content, attachments and cells'],
                summary: 'List all placement addresses for a content identity.',
                description: 'Returns the content ID and an array of cell addresses where it is attached.',
                security: standardAuth,
                parameters: [
                    { name: 'id', in: 'path', required: true, description: 'Content identity ID.', schema: { type: 'string' } },
                ],
                responses: {
                    '200': {
                        description: 'Placement addresses.',
                        content: {
                            'application/json': {
                                schema: {
                                    type: 'object',
                                    required: ['id', 'placements'],
                                    properties: {
                                        id: { type: 'string' },
                                        placements: { type: 'array', items: { $ref: '#/components/schemas/Address' } },
                                    },
                                },
                                example: { id: 'example-content-id', placements: [['1', '1', '1']] },
                            },
                        },
                    },
                    '401': errorResponses['401'],
                    '404': {
                        description: 'Content not found.',
                        content: { 'application/json': { schema: { $ref: '#/components/schemas/ErrorResponse' }, example: { error: 'Content not found.' } } },
                    },
                },
            },
        },
        '/api/v1/cells': {
            get: {
                operationId: 'getCells',
                tags: ['Content, attachments and cells'],
                summary: 'List paginated cells or inspect a single cell by address.',
                description: 'Without address, returns paginated cell addresses and attachment counts. With address (JSON-encoded 3-tuple), returns the full CellSnapshot.',
                security: standardAuth,
                'x-loadPath': '/api/v1/cells?page=1',
                parameters: [
                    { name: 'page', in: 'query', required: false, description: '1-based page number when listing cells.', schema: { type: 'integer', minimum: 1, default: 1 } },
                    { name: 'address', in: 'query', required: false, description: 'JSON-encoded Address tuple, e.g. ["1","1","1"], to inspect one cell.', schema: { type: 'string' } },
                ],
                responses: {
                    '200': {
                        description: 'Paginated cell list or single CellSnapshot.',
                        content: {
                            'application/json': {
                                schema: {
                                    oneOf: [
                                        {
                                            type: 'object',
                                            required: ['page', 'limit', 'total', 'items'],
                                            properties: {
                                                page: { type: 'integer' },
                                                limit: { type: 'integer' },
                                                total: { type: 'integer' },
                                                items: {
                                                    type: 'array',
                                                    items: {
                                                        type: 'object',
                                                        required: ['address', 'attachments'],
                                                        properties: {
                                                            address: { $ref: '#/components/schemas/Address' },
                                                            attachments: { type: 'integer' },
                                                        },
                                                    },
                                                },
                                            },
                                        },
                                        { $ref: '#/components/schemas/CellSnapshot' },
                                    ],
                                },
                                example: { page: 1, limit: 30, total: 1, items: [{ address: ['1', '1', '1'], attachments: 1 }] },
                            },
                        },
                    },
                    ...errorResponses,
                    '404': {
                        description: 'Cell not found (when querying by address).',
                        content: { 'application/json': { schema: { $ref: '#/components/schemas/ErrorResponse' }, example: { error: 'Cell not found.' } } },
                    },
                },
            },
            delete: {
                operationId: 'clearCell',
                tags: ['Content, attachments and cells'],
                summary: 'Clear a cell and all of its attachments.',
                description: 'Detaches all content from the specified cell and clears its cell metadata.',
                security: standardAuth,
                requestBody: {
                    required: true,
                    content: {
                        'application/json': {
                            schema: {
                                type: 'object',
                                required: ['address'],
                                properties: {
                                    address: { $ref: '#/components/schemas/Address', description: 'Target cell address to clear.' },
                                },
                            },
                            example: { address: ['1', '1', '1'] },
                        },
                    },
                },
                responses: {
                    '200': {
                        description: 'Cell cleared.',
                        content: {
                            'application/json': {
                                schema: { type: 'object', required: ['removed'], properties: { removed: { type: 'boolean' } } },
                                example: { removed: true },
                            },
                        },
                    },
                    ...errorResponses,
                },
            },
        },
        '/api/v1/cells/metadata': {
            patch: {
                operationId: 'updateCellMetadata',
                tags: ['Content, attachments and cells'],
                summary: 'Set or replace metadata on a cell.',
                description: 'Updates the cell metadata object at the given address and returns the resulting cell.',
                security: standardAuth,
                requestBody: {
                    required: true,
                    content: {
                        'application/json': {
                            schema: {
                                type: 'object',
                                required: ['address', 'metadata'],
                                properties: {
                                    address: { $ref: '#/components/schemas/Address', description: 'Target cell address.' },
                                    metadata: { $ref: '#/components/schemas/CellMetadata', description: 'Metadata object to store on the cell.' },
                                },
                            },
                            example: { address: ['1', '1', '1'], metadata: { surveyed: true } },
                        },
                    },
                },
                responses: {
                    '200': {
                        description: 'Updated cell metadata.',
                        content: {
                            'application/json': {
                                schema: {
                                    type: 'object',
                                    required: ['address', 'cell'],
                                    properties: {
                                        address: { $ref: '#/components/schemas/Address' },
                                        cell: { $ref: '#/components/schemas/CellSnapshot' },
                                    },
                                },
                                example: { address: ['1', '1', '1'], cell: { address: ['1', '1', '1'], metadata: { surveyed: true }, attachments: [] } },
                            },
                        },
                    },
                    ...errorResponses,
                },
            },
        },
        '/api/v1/placements': {
            post: {
                operationId: 'attachPlacement',
                tags: ['Content, attachments and cells'],
                summary: 'Attach an existing content identity to a cell.',
                description: 'Creates a spatial placement linking an existing content ID to a cell address with optional attachment metadata.',
                security: standardAuth,
                requestBody: {
                    required: true,
                    content: {
                        'application/json': {
                            schema: {
                                type: 'object',
                                required: ['id', 'address'],
                                properties: {
                                    id: { type: 'string', description: 'Existing content ID.' },
                                    address: { $ref: '#/components/schemas/Address', description: 'Target cell address.' },
                                    metadata: { $ref: '#/components/schemas/AttachmentMetadata', description: 'Optional attachment metadata.' },
                                },
                            },
                            example: { id: '{id}', address: ['1', '1', '1'], metadata: { tags: ['survey'] } },
                        },
                    },
                },
                responses: {
                    '201': {
                        description: 'Placement attached.',
                        content: {
                            'application/json': {
                                schema: {
                                    type: 'object',
                                    required: ['id', 'address'],
                                    properties: {
                                        id: { type: 'string' },
                                        address: { $ref: '#/components/schemas/Address' },
                                    },
                                },
                                example: { id: 'example-content-id', address: ['1', '1', '1'] },
                            },
                        },
                    },
                    ...errorResponses,
                    '404': {
                        description: 'Content not found.',
                        content: { 'application/json': { schema: { $ref: '#/components/schemas/ErrorResponse' }, example: { error: 'Content not found.' } } },
                    },
                },
            },
            patch: {
                operationId: 'updatePlacementMetadata',
                tags: ['Content, attachments and cells'],
                summary: 'Update attachment metadata for a placement.',
                description: 'Replaces the attachment metadata for a content identity at a specific cell address.',
                security: standardAuth,
                requestBody: {
                    required: true,
                    content: {
                        'application/json': {
                            schema: {
                                type: 'object',
                                required: ['id', 'address', 'metadata'],
                                properties: {
                                    id: { type: 'string', description: 'Existing content ID.' },
                                    address: { $ref: '#/components/schemas/Address', description: 'Cell address of the attachment.' },
                                    metadata: { $ref: '#/components/schemas/AttachmentMetadata', description: 'Updated attachment metadata.' },
                                },
                            },
                            example: { id: '{id}', address: ['1', '1', '1'], metadata: { tags: ['reviewed'] } },
                        },
                    },
                },
                responses: {
                    '200': {
                        description: 'Updated attachment metadata.',
                        content: {
                            'application/json': {
                                schema: {
                                    type: 'object',
                                    required: ['id', 'address'],
                                    properties: {
                                        id: { type: 'string' },
                                        address: { $ref: '#/components/schemas/Address' },
                                        metadata: { $ref: '#/components/schemas/AttachmentMetadata' },
                                    },
                                },
                                example: { id: 'example-content-id', address: ['1', '1', '1'], metadata: { kind: 'observation', tags: ['reviewed'] } },
                            },
                        },
                    },
                    ...errorResponses,
                    '404': {
                        description: 'Content not found.',
                        content: { 'application/json': { schema: { $ref: '#/components/schemas/ErrorResponse' }, example: { error: 'Content not found.' } } },
                    },
                },
            },
            delete: {
                operationId: 'detachPlacement',
                tags: ['Content, attachments and cells'],
                summary: 'Detach a content identity from a cell.',
                description: 'Removes the attachment at the given cell address without deleting the underlying content identity.',
                security: standardAuth,
                requestBody: {
                    required: true,
                    content: {
                        'application/json': {
                            schema: {
                                type: 'object',
                                required: ['id', 'address'],
                                properties: {
                                    id: { type: 'string', description: 'Content ID.' },
                                    address: { $ref: '#/components/schemas/Address', description: 'Cell address to detach from.' },
                                },
                            },
                            example: { id: '{id}', address: ['1', '1', '1'] },
                        },
                    },
                },
                responses: {
                    '200': {
                        description: 'Detachment result.',
                        content: {
                            'application/json': {
                                schema: { type: 'object', required: ['removed'], properties: { removed: { type: 'boolean' } } },
                                example: { removed: true },
                            },
                        },
                    },
                    ...errorResponses,
                },
            },
        },
        '/api/v1/placements/relocate': {
            post: {
                operationId: 'relocatePlacement',
                tags: ['Content, attachments and cells'],
                summary: 'Atomically move one attachment from one cell to another.',
                description: 'Detaches the content from the source address and attaches it with the same metadata at the destination address in a single transaction.',
                security: standardAuth,
                requestBody: {
                    required: true,
                    content: {
                        'application/json': {
                            schema: {
                                type: 'object',
                                required: ['id', 'from', 'to'],
                                properties: {
                                    id: { type: 'string', description: 'Content ID.' },
                                    from: { $ref: '#/components/schemas/Address', description: 'Source cell address.' },
                                    to: { $ref: '#/components/schemas/Address', description: 'Destination cell address.' },
                                },
                            },
                            example: { id: '{id}', from: ['1', '1', '1'], to: ['0', '1', '1'] },
                        },
                    },
                },
                responses: {
                    '200': {
                        description: 'Attachment relocated.',
                        content: {
                            'application/json': {
                                schema: {
                                    type: 'object',
                                    required: ['id', 'address'],
                                    properties: {
                                        id: { type: 'string' },
                                        address: { $ref: '#/components/schemas/Address' },
                                    },
                                },
                                example: { id: 'example-content-id', address: ['0', '1', '1'] },
                            },
                        },
                    },
                    ...errorResponses,
                    '404': {
                        description: 'Source attachment does not exist.',
                        content: { 'application/json': { schema: { $ref: '#/components/schemas/ErrorResponse' }, example: { error: 'Source attachment does not exist.' } } },
                    },
                    '409': {
                        description: 'Content is already attached at the destination.',
                        content: { 'application/json': { schema: { $ref: '#/components/schemas/ErrorResponse' }, example: { error: 'This content is already attached at the destination.' } } },
                    },
                },
            },
        },
        '/api/v1/placements/move': {
            post: {
                operationId: 'moveContentPlacements',
                tags: ['Content, attachments and cells'],
                summary: 'Replace all placements of a content identity with a new spatial box.',
                description: 'Recomputes cell placements for the content identity at coordinate `at` with optional `extent` and `metadata`.',
                security: standardAuth,
                requestBody: {
                    required: true,
                    content: {
                        'application/json': {
                            schema: {
                                type: 'object',
                                required: ['id', 'at'],
                                properties: {
                                    id: { type: 'string', description: 'Content ID.' },
                                    at: { $ref: '#/components/schemas/Vec3', description: 'Target [x, y, z] origin coordinate.' },
                                    extent: { $ref: '#/components/schemas/Extent', description: 'Optional extent around `at`.' },
                                    metadata: { $ref: '#/components/schemas/AttachmentMetadata', description: 'Optional replacement attachment metadata.' },
                                },
                            },
                            example: { id: '{id}', at: [10, 0, 10], extent: [2, 2, 2] },
                        },
                    },
                },
                responses: {
                    '200': {
                        description: 'Replacement placements.',
                        content: {
                            'application/json': {
                                schema: {
                                    type: 'object',
                                    required: ['id', 'placements'],
                                    properties: {
                                        id: { type: 'string' },
                                        placements: { type: 'array', items: { $ref: '#/components/schemas/Address' } },
                                    },
                                },
                                example: { id: 'example-content-id', placements: [['10000000000010', '011111111111111', '10000000000010']] },
                            },
                        },
                    },
                    ...errorResponses,
                    '404': {
                        description: 'Content not found.',
                        content: { 'application/json': { schema: { $ref: '#/components/schemas/ErrorResponse' }, example: { error: 'Content not found.' } } },
                    },
                },
            },
        },

        // ── Queries and events ────────────────────────────────────────────────
        '/api/v1/search': {
            post: {
                operationId: 'searchContent',
                tags: ['Queries and events'],
                summary: 'Search content or attachments within a spatial region.',
                description: 'Queries the spatial index with optional kind, tag, and metadata filters. Set unique=true for deduplicated content results; false returns attachment-level matches. Query duration is returned in X-Query-Time-Ms.',
                security: standardAuth,
                requestBody: {
                    required: true,
                    content: {
                        'application/json': {
                            schema: {
                                type: 'object',
                                properties: {
                                    region: { $ref: '#/components/schemas/Region', description: 'Spatial scope. Omit for the entire world.' },
                                    overlap: { type: 'boolean', default: false, description: 'Include cells overlapping the region boundary.' },
                                    kind: { type: 'string', description: 'Filter by content kind.' },
                                    tags: { type: 'array', items: { type: 'string' }, maxItems: 32, description: 'Require all specified tags.' },
                                    where: { type: 'object', additionalProperties: true, description: 'Exact-match metadata field filters (max 32 fields).' },
                                    unique: { type: 'boolean', default: false, description: 'Deduplicate results by content ID.' },
                                    limit: { type: 'integer', minimum: 1, maximum: 1000, default: 250, description: 'Maximum results to return (1–1000).' },
                                },
                            },
                            example: { region: ['1', '', '1'], overlap: true, kind: 'observation', tags: ['survey'], where: {}, unique: true, limit: 50 },
                        },
                    },
                },
                responses: {
                    '200': {
                        description: 'Array of matching results (query timing in X-Query-Time-Ms).',
                        content: {
                            'application/json': {
                                schema: { type: 'array', items: { $ref: '#/components/schemas/SearchResult' } },
                                example: [{ address: ['1', '1', '1'], id: 'example-content-id', kind: 'observation', metadata: { kind: 'observation', tags: ['survey'] }, content: { temperature: 21.5 } }],
                            },
                        },
                    },
                    ...errorResponses,
                },
            },
        },
        '/api/v1/cells/search': {
            post: {
                operationId: 'searchCells',
                tags: ['Queries and events'],
                summary: 'Search cells within a spatial region.',
                description: 'Returns CellSnapshot objects within the specified Region. Query duration is returned in X-Query-Time-Ms.',
                security: standardAuth,
                requestBody: {
                    required: true,
                    content: {
                        'application/json': {
                            schema: {
                                type: 'object',
                                properties: {
                                    region: { $ref: '#/components/schemas/Region', description: 'Spatial scope. Omit for the entire world.' },
                                    overlap: { type: 'boolean', default: false, description: 'Include cells overlapping the region boundary.' },
                                    limit: { type: 'integer', minimum: 1, maximum: 1000, default: 250, description: 'Maximum cells to return (1–1000).' },
                                },
                            },
                            example: { region: [[-10, 10], [0, 4], [-10, 10]], overlap: true, limit: 50 },
                        },
                    },
                },
                responses: {
                    '200': {
                        description: 'Array of matching CellSnapshots.',
                        content: {
                            'application/json': {
                                schema: { type: 'array', items: { $ref: '#/components/schemas/CellSnapshot' } },
                                example: [{ address: ['0', '0', '0'], metadata: { surveyed: true }, attachments: [] }],
                            },
                        },
                    },
                    ...errorResponses,
                },
            },
        },
        '/api/v1/nearest': {
            post: {
                operationId: 'nearestContent',
                tags: ['Queries and events'],
                summary: 'Find nearest unique content records to a point.',
                description: 'Returns the closest matching content records ordered by Euclidean distance from `at`.',
                security: standardAuth,
                requestBody: {
                    required: true,
                    content: {
                        'application/json': {
                            schema: {
                                type: 'object',
                                required: ['at'],
                                properties: {
                                    at: { $ref: '#/components/schemas/Vec3', description: 'Query origin [x, y, z].' },
                                    limit: { type: 'integer', minimum: 1, maximum: 1000, default: 20, description: 'Maximum results (1–1000).' },
                                    kind: { type: 'string', description: 'Filter by content kind.' },
                                    tags: { type: 'array', items: { type: 'string' }, maxItems: 32, description: 'Require all specified tags.' },
                                    where: { type: 'object', additionalProperties: true, description: 'Metadata field filters.' },
                                },
                            },
                            example: { at: [0, 0, 0], limit: 20 },
                        },
                    },
                },
                responses: {
                    '200': {
                        description: 'Nearest matching content records with distance.',
                        content: {
                            'application/json': {
                                schema: { type: 'array', items: { $ref: '#/components/schemas/DistanceResult' } },
                                example: [{ address: ['0', '0', '0'], id: 'example-content-id', kind: 'observation', metadata: { kind: 'observation' }, content: { temperature: 21.5 }, distance: 1.5 }],
                            },
                        },
                    },
                    ...errorResponses,
                },
            },
        },
        '/api/v1/radius': {
            post: {
                operationId: 'radiusContent',
                tags: ['Queries and events'],
                summary: 'Find content records within a radius of a point.',
                description: 'Returns unique content records within `radius` units of `at`, ordered with distance.',
                security: standardAuth,
                requestBody: {
                    required: true,
                    content: {
                        'application/json': {
                            schema: {
                                type: 'object',
                                required: ['at', 'radius'],
                                properties: {
                                    at: { $ref: '#/components/schemas/Vec3', description: 'Query center [x, y, z].' },
                                    radius: { type: 'number', minimum: 0, description: 'Non-negative search radius.' },
                                    limit: { type: 'integer', minimum: 1, maximum: 1000, default: 250, description: 'Maximum results (1–1000).' },
                                    kind: { type: 'string', description: 'Filter by content kind.' },
                                    tags: { type: 'array', items: { type: 'string' }, maxItems: 32, description: 'Require all specified tags.' },
                                    where: { type: 'object', additionalProperties: true, description: 'Metadata field filters.' },
                                },
                            },
                            example: { at: [0, 0, 0], radius: 30, limit: 50 },
                        },
                    },
                },
                responses: {
                    '200': {
                        description: 'Matching content records within radius.',
                        content: {
                            'application/json': {
                                schema: { type: 'array', items: { $ref: '#/components/schemas/DistanceResult' } },
                                example: [{ address: ['0', '0', '0'], id: 'example-content-id', kind: 'observation', metadata: { kind: 'observation' }, content: { temperature: 21.5 }, distance: 4.2 }],
                            },
                        },
                    },
                    ...errorResponses,
                },
            },
        },
        '/api/v1/events': {
            get: {
                operationId: 'subscribeEvents',
                tags: ['Queries and events'],
                summary: 'Subscribe to Server-Sent Events (SSE).',
                description: 'Streams `ready`, `change` (regions, contentIds, or reset: true when > 256), and optional `activity` events. On reconnect, resynchronize scoped state.',
                security: standardAuth,
                parameters: [
                    { name: 'region', in: 'query', required: false, description: 'Optional JSON-encoded Region to scope change delivery.', schema: { type: 'string' } },
                    { name: 'activity', in: 'query', required: false, description: 'Set to "1" to also stream activity journal events (management access required).', schema: { type: 'string', enum: ['1'] } },
                ],
                responses: {
                    '200': {
                        description: 'SSE stream opened.',
                        content: { 'text/event-stream': { schema: { type: 'string' }, example: 'event: ready\ndata: {}\n\nevent: change\ndata: {"regions":[["1","1","1"]],"contentIds":["example-content-id"]}\n\n' } },
                    },
                    ...managementErrorResponses,
                },
            },
            post: {
                operationId: 'emitEvent',
                tags: ['Queries and events'],
                summary: 'Emit a custom spatial event.',
                description: 'Broadcasts a custom event to subscribers and plugins. Event names cannot start with reserved namespaces (`mutation:`, `spatial:`, `update`).',
                security: standardAuth,
                requestBody: {
                    required: true,
                    content: {
                        'application/json': {
                            schema: {
                                type: 'object',
                                required: ['name'],
                                properties: {
                                    name: { type: 'string', maxLength: 100, description: 'Custom event name (e.g. "survey:completed").' },
                                    data: { $ref: '#/components/schemas/JsonValue', description: 'Optional event payload.' },
                                    region: { $ref: '#/components/schemas/Region', description: 'Optional region scope. Omit for global delivery.' },
                                },
                            },
                            example: { name: 'survey:completed', data: { complete: true }, region: ['1', '', '1'] },
                        },
                    },
                },
                responses: {
                    '200': {
                        description: 'Event emitted.',
                        content: {
                            'application/json': {
                                schema: { type: 'object', required: ['emitted'], properties: { emitted: { type: 'boolean' } } },
                                example: { emitted: true },
                            },
                        },
                    },
                    ...errorResponses,
                },
            },
        },
        '/api/v1/activity': {
            get: {
                operationId: 'queryActivity',
                tags: ['Queries and events'],
                summary: 'Query the persisted SQLite activity journal.',
                description: 'Returns filtered activity events and total count. Requires management access.',
                security: managementAuth,
                'x-loadPath': '/api/v1/activity?limit=256',
                parameters: [
                    { name: 'category', in: 'query', required: false, description: 'Filter by event category.', schema: { type: 'string' } },
                    { name: 'name', in: 'query', required: false, description: 'Filter by event name.', schema: { type: 'string' } },
                    { name: 'kind', in: 'query', required: false, description: 'Filter by content kind.', schema: { type: 'string' } },
                    { name: 'contentId', in: 'query', required: false, description: 'Filter by content ID.', schema: { type: 'string' } },
                    { name: 'source', in: 'query', required: false, description: 'Filter by source plugin/component.', schema: { type: 'string' } },
                    { name: 'limit', in: 'query', required: false, description: 'Maximum events to return (1–1000, default 256).', schema: { type: 'integer', minimum: 1, maximum: 1000, default: 256 } },
                    { name: 'offset', in: 'query', required: false, description: 'Pagination offset.', schema: { type: 'integer', minimum: 0, default: 0 } },
                ],
                responses: {
                    '200': {
                        description: 'Activity journal page.',
                        content: {
                            'application/json': {
                                schema: {
                                    type: 'object',
                                    required: ['events', 'total'],
                                    properties: {
                                        events: { type: 'array', items: { type: 'object', additionalProperties: true } },
                                        total: { type: 'integer' },
                                    },
                                },
                                example: { events: [], total: 0 },
                            },
                        },
                    },
                    ...managementErrorResponses,
                },
            },
        },
        '/api/v1/queries': {
            get: {
                operationId: 'listSavedQueries',
                tags: ['Queries and events'],
                summary: 'List server-persisted Query Workbench configurations.',
                description: 'Returns all saved query presets ordered by last update. Requires management access.',
                security: managementAuth,
                responses: {
                    '200': {
                        description: 'Saved query configurations.',
                        content: {
                            'application/json': {
                                schema: {
                                    type: 'object',
                                    required: ['queries'],
                                    properties: {
                                        queries: {
                                            type: 'array',
                                            items: {
                                                type: 'object',
                                                required: ['id', 'name', 'config', 'updatedAt'],
                                                properties: {
                                                    id: { type: 'string' },
                                                    name: { type: 'string' },
                                                    config: { type: 'object', additionalProperties: true },
                                                    updatedAt: { type: 'integer' },
                                                },
                                            },
                                        },
                                    },
                                },
                                example: { queries: [{ id: 'uuid', name: 'recent-surveys', config: { kind: 'observation' }, updatedAt: 1730000000000 }] },
                            },
                        },
                    },
                    ...managementErrorResponses,
                },
            },
            post: {
                operationId: 'saveQuery',
                tags: ['Queries and events'],
                summary: 'Create or update a saved Query Workbench configuration.',
                description: 'Upserts a named query configuration in SQLite. Requires management access.',
                security: managementAuth,
                requestBody: {
                    required: true,
                    content: {
                        'application/json': {
                            schema: {
                                type: 'object',
                                required: ['name', 'config'],
                                properties: {
                                    name: { type: 'string', maxLength: 100, description: 'Unique preset name.' },
                                    config: { type: 'object', additionalProperties: true, description: 'Query Workbench configuration object.' },
                                },
                            },
                            example: { name: 'recent-surveys', config: { kind: 'observation', limit: 50 } },
                        },
                    },
                },
                responses: {
                    '200': {
                        description: 'Query saved.',
                        content: {
                            'application/json': {
                                schema: {
                                    type: 'object',
                                    required: ['saved', 'name'],
                                    properties: { saved: { type: 'boolean' }, name: { type: 'string' } },
                                },
                                example: { saved: true, name: 'recent-surveys' },
                            },
                        },
                    },
                    ...managementErrorResponses,
                },
            },
            delete: {
                operationId: 'deleteSavedQuery',
                tags: ['Queries and events'],
                summary: 'Delete a saved Query Workbench configuration.',
                description: 'Deletes a saved query preset by name. Requires management access.',
                security: managementAuth,
                requestBody: {
                    required: true,
                    content: {
                        'application/json': {
                            schema: {
                                type: 'object',
                                required: ['name'],
                                properties: {
                                    name: { type: 'string', maxLength: 100, description: 'Name of the saved query to remove.' },
                                },
                            },
                            example: { name: 'recent-surveys' },
                        },
                    },
                },
                responses: {
                    '200': {
                        description: 'Deletion result.',
                        content: {
                            'application/json': {
                                schema: { type: 'object', required: ['removed'], properties: { removed: { type: 'boolean' } } },
                                example: { removed: true },
                            },
                        },
                    },
                    ...managementErrorResponses,
                },
            },
        },

        // ── Administration ────────────────────────────────────────────────────
        '/api/v1/clients': {
            get: {
                operationId: 'listClients',
                tags: ['Administration'],
                summary: 'List registered API clients and active stream counts.',
                description: 'Returns client identifiers, creation/rotation/auth timestamps, and active SSE stream counts. Requires management access.',
                security: managementAuth,
                responses: {
                    '200': {
                        description: 'Registered clients.',
                        content: {
                            'application/json': {
                                schema: {
                                    type: 'object',
                                    required: ['clients'],
                                    properties: {
                                        clients: {
                                            type: 'array',
                                            items: {
                                                type: 'object',
                                                required: ['clientId', 'createdAt', 'rotatedAt', 'lastAuthenticatedAt', 'connections'],
                                                properties: {
                                                    clientId: { type: 'string' },
                                                    createdAt: { type: 'integer' },
                                                    rotatedAt: { type: ['integer', 'null'] },
                                                    lastAuthenticatedAt: { type: ['integer', 'null'] },
                                                    connections: { type: 'integer' },
                                                },
                                            },
                                        },
                                    },
                                },
                                example: { clients: [{ clientId: 'survey-worker', createdAt: 1730000000000, rotatedAt: null, lastAuthenticatedAt: null, connections: 0 }] },
                            },
                        },
                    },
                    ...managementErrorResponses,
                },
            },
            post: {
                operationId: 'manageClient',
                tags: ['Administration'],
                summary: 'Issue, reroll, or burn a client credential.',
                description: 'Manages client Bearer credentials. `issue` returns 201 with the secret once; `reroll` returns 200 with a new secret and closes active streams; `burn` returns 204 and closes active streams.',
                security: managementAuth,
                requestBody: {
                    required: true,
                    content: {
                        'application/json': {
                            schema: {
                                type: 'object',
                                required: ['operation', 'clientId'],
                                properties: {
                                    operation: { type: 'string', enum: ['issue', 'reroll', 'burn'], description: 'Credential lifecycle operation.' },
                                    clientId: { type: 'string', maxLength: 128, description: 'Client identifier (1–128 characters).' },
                                },
                            },
                            example: { operation: 'issue', clientId: 'survey-worker' },
                        },
                    },
                },
                responses: {
                    '200': {
                        description: 'Client credential rerolled (new secret returned once; active streams closed).',
                        content: {
                            'application/json': {
                                schema: { $ref: '#/components/schemas/ClientCredentials' },
                                example: { clientId: 'survey-worker', secret: '<43-char-base64url-secret>' },
                            },
                        },
                    },
                    '201': {
                        description: 'Client issued (secret is returned once).',
                        content: {
                            'application/json': {
                                schema: { $ref: '#/components/schemas/ClientCredentials' },
                                example: { clientId: 'survey-worker', secret: '<43-char-base64url-secret>' },
                            },
                        },
                    },
                    '204': { description: 'Client burned and active streams closed.' },
                    ...managementErrorResponses,
                    '404': { description: 'Client does not exist (reroll/burn).', content: { 'application/json': { schema: { $ref: '#/components/schemas/ErrorResponse' }, example: { error: 'Client does not exist.' } } } },
                    '409': { description: 'Client ID already exists (issue).', content: { 'application/json': { schema: { $ref: '#/components/schemas/ErrorResponse' }, example: { error: 'That client ID already exists.' } } } },
                },
            },
        },
        '/api/v1/plugins': {
            get: {
                operationId: 'listActivePlugins',
                tags: ['Administration'],
                summary: 'List names of active runtime plugins.',
                description: 'Returns the names of currently active runtime plugins.',
                security: standardAuth,
                responses: {
                    '200': {
                        description: 'Active plugin names.',
                        content: {
                            'application/json': {
                                schema: {
                                    type: 'object',
                                    required: ['plugins'],
                                    properties: { plugins: { type: 'array', items: { type: 'string' } } },
                                },
                                example: { plugins: ['example.ts'] },
                            },
                        },
                    },
                    '401': errorResponses['401'],
                },
            },
        },
        '/api/v1/operator/plugins': {
            get: {
                operationId: 'getOperatorPlugins',
                tags: ['Administration'],
                summary: 'Inspect filesystem plugin status, scheduler settings, or plugin logs.',
                description: 'Returns plugin statuses and scheduler configuration, or diagnostic logs for a plugin when ?logs=<source> is provided. Requires management access.',
                security: managementAuth,
                parameters: [
                    { name: 'logs', in: 'query', required: false, description: 'Optional plugin source name to query diagnostic logs.', schema: { type: 'string' } },
                ],
                responses: {
                    '200': {
                        description: 'Plugin statuses and scheduler settings (or diagnostic activity page when ?logs is set).',
                        content: {
                            'application/json': {
                                schema: {
                                    type: 'object',
                                    properties: {
                                        plugins: { type: 'array', items: { type: 'object', additionalProperties: true } },
                                        scheduler: { $ref: '#/components/schemas/SchedulerStatus' },
                                        events: { type: 'array', items: { type: 'object', additionalProperties: true } },
                                        total: { type: 'integer' },
                                    },
                                },
                                example: { plugins: [], scheduler: { intervalMs: 1000, running: true } },
                            },
                        },
                    },
                    ...managementErrorResponses,
                },
            },
            post: {
                operationId: 'toggleOperatorPlugin',
                tags: ['Administration'],
                summary: 'Enable or disable a runtime plugin.',
                description: 'Toggles a plugin by filename and returns updated plugin and scheduler statuses. Requires management access.',
                security: managementAuth,
                requestBody: {
                    required: true,
                    content: {
                        'application/json': {
                            schema: {
                                type: 'object',
                                required: ['filename', 'enabled'],
                                properties: {
                                    filename: { type: 'string', description: 'Plugin filename.' },
                                    enabled: { type: 'boolean', description: 'Target enabled state.' },
                                },
                            },
                            example: { filename: 'example.ts', enabled: true },
                        },
                    },
                },
                responses: {
                    '200': {
                        description: 'Updated plugin status.',
                        content: {
                            'application/json': {
                                schema: {
                                    type: 'object',
                                    required: ['plugins', 'scheduler'],
                                    properties: {
                                        plugins: { type: 'array', items: { type: 'object', additionalProperties: true } },
                                        scheduler: { $ref: '#/components/schemas/SchedulerStatus' },
                                    },
                                },
                                example: { plugins: [], scheduler: { intervalMs: 1000, running: true } },
                            },
                        },
                    },
                    ...managementErrorResponses,
                    '404': { description: 'Plugin not found.', content: { 'application/json': { schema: { $ref: '#/components/schemas/ErrorResponse' }, example: { error: 'Operation not found.' } } } },
                },
            },
        },
        '/api/v1/operator/lua': {
            get: {
                operationId: 'getLuaWorkspace',
                tags: ['Administration'],
                summary: 'List Lua plugins, shared modules, and binding documentation.',
                description: 'Returns Lua plugins, shared modules, and binding docs (or a single plugin with ?plugin=<id>, or docs only with ?docs=1). Requires management access.',
                security: managementAuth,
                parameters: [
                    { name: 'plugin', in: 'query', required: false, description: 'Optional Lua plugin ID to inspect.', schema: { type: 'string' } },
                    { name: 'docs', in: 'query', required: false, description: 'Set to "1" to return only Lua binding documentation.', schema: { type: 'string', enum: ['1'] } },
                ],
                responses: {
                    '200': {
                        description: 'Lua workspace details, single plugin, or binding documentation.',
                        content: {
                            'application/json': {
                                schema: {
                                    type: 'object',
                                    properties: {
                                        plugins: { type: 'array', items: { $ref: '#/components/schemas/LuaPluginEntity' } },
                                        sharedModules: { type: 'array', items: { $ref: '#/components/schemas/LuaSharedModule' } },
                                        plugin: { $ref: '#/components/schemas/LuaPluginEntity' },
                                        docs: { type: 'array', items: { type: 'object', additionalProperties: true } },
                                    },
                                },
                                example: { plugins: [], sharedModules: [], docs: [] },
                            },
                        },
                    },
                    ...managementErrorResponses,
                    '404': { description: 'Lua plugin not found.', content: { 'application/json': { schema: { $ref: '#/components/schemas/ErrorResponse' }, example: { error: 'Operation not found.' } } } },
                },
            },
            post: {
                operationId: 'mutateLuaWorkspace',
                tags: ['Administration'],
                summary: 'Create, save, reload, or delete Lua plugins and shared modules.',
                description: 'Supports `create-plugin`, `save-plugin`, `reload-plugin`, `delete-plugin`, `save-module`, and `delete-module`. Requires management access.',
                security: managementAuth,
                requestBody: {
                    required: true,
                    content: {
                        'application/json': {
                            schema: {
                                type: 'object',
                                required: ['operation'],
                                properties: {
                                    operation: {
                                        type: 'string',
                                        enum: ['create-plugin', 'save-plugin', 'reload-plugin', 'delete-plugin', 'save-module', 'delete-module'],
                                        description: 'Lua management operation to execute.',
                                    },
                                    id: { type: 'string', maxLength: 64, description: 'Plugin ID (for plugin operations).' },
                                    name: { type: 'string', maxLength: 80, description: 'Plugin display name or shared module name (max 64 for modules).' },
                                    description: { type: 'string', description: 'Optional plugin or module description.' },
                                    version: { type: 'string', default: '1.0.0', description: 'Plugin version (create-plugin / save-plugin).' },
                                    entrypoint: { type: 'string', default: 'main.lua', description: 'Plugin entrypoint file path.' },
                                    config: { type: 'object', additionalProperties: true, description: 'Optional plugin configuration object.' },
                                    files: {
                                        type: 'array',
                                        items: {
                                            type: 'object',
                                            required: ['path', 'content'],
                                            properties: { path: { type: 'string' }, content: { type: 'string' } },
                                        },
                                        description: 'Plugin source files (create-plugin / save-plugin).',
                                    },
                                    enabled: { type: 'boolean', description: 'Whether the plugin is enabled.' },
                                    content: { type: 'string', description: 'Lua source content (for save-module).' },
                                },
                            },
                            example: {
                                operation: 'create-plugin',
                                id: 'survey-logger',
                                name: 'Survey Logger',
                                version: '1.0.0',
                                entrypoint: 'main.lua',
                                enabled: true,
                                files: [{ path: 'main.lua', content: 'print("ready")' }],
                            },
                        },
                    },
                },
                responses: {
                    '200': {
                        description: 'Lua operation completed.',
                        content: {
                            'application/json': {
                                schema: {
                                    type: 'object',
                                    properties: {
                                        plugin: { $ref: '#/components/schemas/LuaPluginEntity' },
                                        plugins: { type: 'array', items: { type: 'object', additionalProperties: true } },
                                        module: { $ref: '#/components/schemas/LuaSharedModule' },
                                        deleted: { type: 'boolean' },
                                    },
                                },
                                example: { deleted: true },
                            },
                        },
                    },
                    ...managementErrorResponses,
                    '404': { description: 'Plugin or module not found.', content: { 'application/json': { schema: { $ref: '#/components/schemas/ErrorResponse' }, example: { error: 'Operation not found.' } } } },
                },
            },
        },
        '/api/v1/operator/scheduler': {
            post: {
                operationId: 'updateScheduler',
                tags: ['Administration'],
                summary: 'Update the runtime update scheduler interval.',
                description: 'Sets the scheduler tick interval in milliseconds (50–60000) or 0 to stop. Requires management access.',
                security: managementAuth,
                requestBody: {
                    required: true,
                    content: {
                        'application/json': {
                            schema: {
                                type: 'object',
                                required: ['intervalMs'],
                                properties: {
                                    intervalMs: { type: 'integer', description: '0 to stop, or an integer from 50 to 60000 ms.' },
                                },
                            },
                            example: { intervalMs: 1000 },
                        },
                    },
                },
                responses: {
                    '200': {
                        description: 'Effective scheduler status.',
                        content: {
                            'application/json': {
                                schema: { $ref: '#/components/schemas/SchedulerStatus' },
                                example: { intervalMs: 1000, running: true },
                            },
                        },
                    },
                    ...managementErrorResponses,
                },
            },
        },
        '/api/v1/operator/diagnostics': {
            get: {
                operationId: 'getDiagnostics',
                tags: ['Administration'],
                summary: 'Inspect server diagnostics, resources, and recent errors.',
                description: 'Returns process memory/CPU, uptime, world stats, query/mutation performance metrics, client stream counts, and recent diagnostic errors. Requires management access.',
                security: managementAuth,
                responses: {
                    '200': {
                        description: 'Diagnostics snapshot.',
                        content: {
                            'application/json': {
                                schema: {
                                    type: 'object',
                                    required: ['memory', 'cpu', 'uptimeSeconds', 'runtime', 'performance', 'clients', 'errors'],
                                    properties: {
                                        memory: { type: 'object', additionalProperties: { type: 'integer' } },
                                        cpu: {
                                            type: 'object',
                                            required: ['userMicros', 'systemMicros', 'averagePercent'],
                                            properties: {
                                                userMicros: { type: 'integer' },
                                                systemMicros: { type: 'integer' },
                                                averagePercent: { type: 'number' },
                                            },
                                        },
                                        uptimeSeconds: { type: 'number' },
                                        runtime: { $ref: '#/components/schemas/WorldStats' },
                                        performance: { type: 'object', additionalProperties: true },
                                        clients: {
                                            type: 'object',
                                            required: ['registered', 'activeStreams'],
                                            properties: {
                                                registered: { type: 'integer' },
                                                activeStreams: { type: 'integer' },
                                            },
                                        },
                                        errors: { type: 'array', items: { type: 'object', additionalProperties: true } },
                                    },
                                },
                                example: { uptimeSeconds: 120, runtime: { cells: 0, attachments: 0, contents: 0, orphans: 0 }, clients: { registered: 0, activeStreams: 0 }, errors: [] },
                            },
                        },
                    },
                    ...managementErrorResponses,
                },
            },
        },
        '/api/v1/operator/settings': {
            get: {
                operationId: 'getSettings',
                tags: ['Administration'],
                summary: 'Inspect startup settings, runtime controls, and logging configuration.',
                description: 'Returns effective server startup settings, active dashboard session count, and activity retention limit. Requires management access.',
                security: managementAuth,
                responses: {
                    '200': {
                        description: 'Server settings.',
                        content: {
                            'application/json': {
                                schema: {
                                    type: 'object',
                                    required: ['startup', 'runtime', 'logging'],
                                    properties: {
                                        startup: {
                                            type: 'object',
                                            required: ['host', 'port', 'databasePath', 'pluginsDirectory', 'bits', 'sessionTtlSeconds', 'cookieSecure', 'publicOrigin'],
                                            properties: {
                                                host: { type: 'string' },
                                                port: { type: 'integer' },
                                                databasePath: { type: 'string' },
                                                pluginsDirectory: { type: 'string' },
                                                bits: { type: 'integer' },
                                                sessionTtlSeconds: { type: 'integer' },
                                                cookieSecure: { type: 'boolean' },
                                                publicOrigin: { type: ['string', 'null'] },
                                            },
                                        },
                                        runtime: {
                                            type: 'object',
                                            required: ['scheduler', 'activeDashboardSessions'],
                                            properties: {
                                                scheduler: { $ref: '#/components/schemas/SchedulerStatus' },
                                                activeDashboardSessions: { type: 'integer' },
                                            },
                                        },
                                        logging: {
                                            type: 'object',
                                            required: ['runtimeDiagnostics', 'limit'],
                                            properties: {
                                                runtimeDiagnostics: { type: 'string' },
                                                limit: { type: 'integer' },
                                            },
                                        },
                                    },
                                },
                                example: { startup: { host: '127.0.0.1', port: 4321, bits: 16 }, runtime: { activeDashboardSessions: 1 }, logging: { runtimeDiagnostics: 'SQLite activity_log', limit: 2000 } },
                            },
                        },
                    },
                    ...managementErrorResponses,
                },
            },
            post: {
                operationId: 'updateSettings',
                tags: ['Administration'],
                summary: 'Perform runtime settings operations (revoke sessions or set activity retention).',
                description: 'Supports `revoke-sessions` (requires `confirm: "revoke-sessions"`) and `set-retention` (`limit`: 100–20000). Requires management access.',
                security: managementAuth,
                requestBody: {
                    required: true,
                    content: {
                        'application/json': {
                            schema: {
                                type: 'object',
                                required: ['operation'],
                                properties: {
                                    operation: { type: 'string', enum: ['revoke-sessions', 'set-retention'], description: 'Settings operation to execute.' },
                                    confirm: { type: 'string', description: 'Required to equal "revoke-sessions" for revoke-sessions.' },
                                    limit: { type: 'integer', minimum: 100, maximum: 20000, description: 'Activity retention limit (for set-retention).' },
                                },
                            },
                            example: { operation: 'revoke-sessions', confirm: 'revoke-sessions' },
                        },
                    },
                },
                responses: {
                    '200': {
                        description: 'Operation result.',
                        content: {
                            'application/json': {
                                schema: {
                                    type: 'object',
                                    properties: {
                                        revoked: { type: 'integer' },
                                        limit: { type: 'integer' },
                                    },
                                },
                                example: { revoked: 1 },
                            },
                        },
                    },
                    ...managementErrorResponses,
                },
            },
        },
        '/api/v1/operator/storage': {
            get: {
                operationId: 'getStorageInfo',
                tags: ['Administration'],
                summary: 'Inspect SQLite storage, runtime counts, and recent backups.',
                description: 'Returns SQLite vs runtime counts, allocation stats, journal mode, and up to 100 recent backups. Requires management access.',
                security: managementAuth,
                responses: {
                    '200': {
                        description: 'Storage and backup summary.',
                        content: {
                            'application/json': {
                                schema: {
                                    type: 'object',
                                    required: ['counts', 'runtime', 'matching', 'backups', 'databasePath', 'journal', 'allocatedBytes', 'backupCount'],
                                    properties: {
                                        counts: { $ref: '#/components/schemas/WorldStats' },
                                        runtime: { $ref: '#/components/schemas/WorldStats' },
                                        matching: { type: 'boolean' },
                                        databasePath: { type: 'string' },
                                        journal: { type: 'string' },
                                        allocatedBytes: { type: 'integer' },
                                        backupCount: { type: 'integer' },
                                        backups: {
                                            type: 'array',
                                            items: {
                                                type: 'object',
                                                required: ['id', 'label', 'createdAt', 'bytes'],
                                                properties: {
                                                    id: { type: 'string' },
                                                    label: { type: 'string' },
                                                    createdAt: { type: 'integer' },
                                                    bytes: { type: 'integer' },
                                                },
                                            },
                                        },
                                    },
                                },
                                example: { matching: true, backups: [] },
                            },
                        },
                    },
                    ...managementErrorResponses,
                },
            },
            post: {
                operationId: 'runStorageOperation',
                tags: ['Administration'],
                summary: 'Validate storage, create/restore/delete backups, or collect orphans.',
                description: 'Supports `validate`, `backup` (`label`), `delete-backup` (`id`), `restore` (`id`, `confirm: "restore"`), and `collect-orphans` (`confirm: "collect-orphans"`). Requires management access.',
                security: managementAuth,
                requestBody: {
                    required: true,
                    content: {
                        'application/json': {
                            schema: {
                                type: 'object',
                                required: ['operation'],
                                properties: {
                                    operation: { type: 'string', enum: ['validate', 'backup', 'delete-backup', 'restore', 'collect-orphans'], description: 'Storage operation to execute.' },
                                    label: { type: 'string', maxLength: 120, description: 'Backup label (for backup).' },
                                    id: { type: 'string', description: 'Backup ID (for restore / delete-backup).' },
                                    confirm: { type: 'string', description: 'Confirmation string ("restore" or "collect-orphans").' },
                                },
                            },
                            example: { operation: 'validate' },
                        },
                    },
                },
                responses: {
                    '200': {
                        description: 'Storage operation result.',
                        content: {
                            'application/json': {
                                schema: {
                                    type: 'object',
                                    properties: {
                                        ok: { type: 'boolean' },
                                        database: { type: 'array', items: { type: 'string' } },
                                        foreignKeys: { type: 'integer' },
                                        runtime: { type: 'boolean' },
                                        matching: { type: 'boolean' },
                                        deleted: { type: 'boolean' },
                                        restored: { type: 'boolean' },
                                        count: { type: 'integer' },
                                    },
                                },
                                example: { ok: true, database: ['ok'], foreignKeys: 0, runtime: true, matching: true },
                            },
                        },
                    },
                    '201': {
                        description: 'Backup created (for operation: "backup").',
                        content: {
                            'application/json': {
                                schema: {
                                    type: 'object',
                                    required: ['id', 'label', 'createdAt'],
                                    properties: {
                                        id: { type: 'string' },
                                        label: { type: 'string' },
                                        createdAt: { type: 'integer' },
                                    },
                                },
                                example: { id: 'backup-uuid', label: 'Manual backup', createdAt: 1730000000000 },
                            },
                        },
                    },
                    ...managementErrorResponses,
                    '404': { description: 'Backup not found.', content: { 'application/json': { schema: { $ref: '#/components/schemas/ErrorResponse' }, example: { error: 'Operation not found.' } } } },
                },
            },
        },
        '/api/v1/operator/backup': {
            get: {
                operationId: 'getBackupSnapshot',
                tags: ['Administration'],
                summary: 'Download the stored world snapshot for a backup.',
                description: 'Returns the substratum-atlas/1 snapshot JSON stored for the given backup ID. Requires management access.',
                security: managementAuth,
                parameters: [
                    { name: 'id', in: 'query', required: true, description: 'Backup ID.', schema: { type: 'string' } },
                ],
                responses: {
                    '200': {
                        description: 'Stored backup snapshot.',
                        content: {
                            'application/json': {
                                schema: { $ref: '#/components/schemas/Snapshot' },
                                example: { format: 'substratum-atlas/1', bits: 16, contents: [], cells: [] },
                            },
                        },
                    },
                    ...managementErrorResponses,
                    '404': { description: 'Backup not found.', content: { 'application/json': { schema: { $ref: '#/components/schemas/ErrorResponse' }, example: { error: 'Operation not found.' } } } },
                },
            },
        },
        '/api/auth/session': {
            get: {
                operationId: 'getAuthSession',
                tags: ['Administration'],
                summary: 'Inspect current authentication method.',
                description: 'Returns whether the caller is authenticated and which authentication method (`session` or `management`) is active.',
                security: managementAuth,
                responses: {
                    '200': {
                        description: 'Current session status.',
                        content: {
                            'application/json': {
                                schema: {
                                    type: 'object',
                                    required: ['authenticated', 'method'],
                                    properties: {
                                        authenticated: { type: 'boolean' },
                                        method: { type: 'string', enum: ['session', 'management'] },
                                    },
                                },
                                example: { authenticated: true, method: 'session' },
                            },
                        },
                    },
                    ...managementErrorResponses,
                },
            },
        },
        '/api/auth/login': {
            post: {
                operationId: 'loginDashboard',
                tags: ['Administration'],
                summary: 'Authenticate with the dashboard password.',
                description: 'Public same-origin endpoint. Issues an HttpOnly session cookie (204). Use the dashboard sign-in form rather than the request builder.',
                security: [],
                requestBody: {
                    required: true,
                    content: {
                        'application/json': {
                            schema: {
                                type: 'object',
                                required: ['password'],
                                properties: {
                                    password: { type: 'string', maxLength: 1024, description: 'Dashboard password.' },
                                },
                            },
                            example: { password: '<dashboard-password>' },
                        },
                    },
                },
                responses: {
                    '204': { description: 'Authenticated; Set-Cookie header issued.' },
                    '400': { description: 'Invalid request or password format.' },
                    '401': { description: 'Login failed or rate-limited.' },
                    '403': { description: 'Same-origin check failed.' },
                },
            },
        },
        '/api/auth/logout': {
            post: {
                operationId: 'logoutDashboard',
                tags: ['Administration'],
                summary: 'Invalidate the current dashboard session.',
                description: 'Destroys the active session, clears the session cookie, and closes its active SSE streams.',
                security: managementAuth,
                responses: {
                    '200': {
                        description: 'Logged out.',
                        content: {
                            'application/json': {
                                schema: { type: 'object', required: ['ok'], properties: { ok: { type: 'boolean' } } },
                                example: { ok: true },
                            },
                        },
                    },
                    ...managementErrorResponses,
                },
            },
        },
    },
};
