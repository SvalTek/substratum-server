import { openApiSpec, type OpenApiOperation, type OpenApiSchema } from './openapi';

export type HttpMethod = 'GET' | 'POST' | 'PATCH' | 'DELETE';

export interface SchemaFieldDoc {
    name: string;
    type: string;
    required: boolean;
    description: string;
}

export interface ParameterDoc {
    name: string;
    in: 'path' | 'query' | 'header';
    type: string;
    required: boolean;
    description: string;
}

export interface ResponseDoc {
    status: string;
    description: string;
    contentType?: string;
    example?: string;
    isError: boolean;
}

export interface EndpointDoc {
    id: string;
    method: HttpMethod;
    path: string;
    loadPath: string;
    summary: string;
    description: string;
    authLabel: string;
    authKind: 'public' | 'standard' | 'management';
    parameters: ParameterDoc[];
    requestSchemaNote?: string;
    requestFields: SchemaFieldDoc[];
    requestExample?: string;
    requestBodyObject?: unknown;
    confirmation?: string;
    primaryResponse?: ResponseDoc;
    otherResponses: ResponseDoc[];
    tags: string[];
}

export interface EndpointGroup {
    title: string;
    description: string;
    entries: EndpointDoc[];
}

function resolveSchema(schema: OpenApiSchema | undefined): OpenApiSchema {
    if (!schema) return {};
    if (schema.$ref) {
        const name = schema.$ref.replace('#/components/schemas/', '');
        const target = openApiSpec.components.schemas[name];
        if (target) return { ...target, ...(schema.description ? { description: schema.description } : {}) };
    }
    return schema;
}

function formatType(schema: OpenApiSchema | undefined): string {
    if (!schema) return 'any';
    if (schema['x-typeLabel']) return schema['x-typeLabel'];
    if (schema.$ref) {
        const name = schema.$ref.replace('#/components/schemas/', '');
        const target = openApiSpec.components.schemas[name];
        if (target?.['x-typeLabel']) return target['x-typeLabel'];
        return name;
    }
    if (schema.enum) return schema.enum.map(v => JSON.stringify(v)).join(' | ');
    if (schema.oneOf) return schema.oneOf.map(formatType).join(' | ');
    if (schema.type === 'array') {
        const itemType = formatType(schema.items);
        return `${itemType}[]`;
    }
    if (Array.isArray(schema.type)) return schema.type.join(' | ');
    return schema.type ?? 'any';
}

function formatAuth(security: OpenApiOperation['security']): { label: string; kind: EndpointDoc['authKind'] } {
    if (!security || security.length === 0) return { label: 'Public (no auth)', kind: 'public' };
    const schemes = new Set(security.flatMap(entry => Object.keys(entry)));
    if (schemes.has('clientBearer')) return { label: 'Session · Management · Client', kind: 'standard' };
    return { label: 'Management only', kind: 'management' };
}

function formatExample(value: unknown): string | undefined {
    if (value === undefined) return undefined;
    if (typeof value === 'string') return value;
    return JSON.stringify(value, null, 2);
}

function buildEndpoint(path: string, method: HttpMethod, op: OpenApiOperation): EndpointDoc {
    const auth = formatAuth(op.security);

    const parameters: ParameterDoc[] = (op.parameters ?? []).map(param => ({
        name: param.name,
        in: param.in,
        type: formatType(param.schema),
        required: Boolean(param.required),
        description: param.description,
    }));

    const jsonReq = op.requestBody?.content['application/json'];
    const resolvedBodySchema = resolveSchema(jsonReq?.schema);
    const requiredSet = new Set(resolvedBodySchema.required ?? []);
    const requestFields: SchemaFieldDoc[] = Object.entries(resolvedBodySchema.properties ?? {}).map(([name, propSchema]) => {
        const resolved = resolveSchema(propSchema);
        return {
            name,
            type: formatType(propSchema),
            required: requiredSet.has(name),
            description: propSchema.description ?? resolved.description ?? '',
        };
    });

    const responses: ResponseDoc[] = Object.entries(op.responses).map(([status, resp]) => {
        const mediaEntry = resp.content ? Object.entries(resp.content)[0] : undefined;
        const code = Number(status);
        return {
            status,
            description: resp.description,
            contentType: mediaEntry?.[0],
            example: formatExample(mediaEntry?.[1]?.example),
            isError: Number.isFinite(code) && code >= 400,
        };
    });

    const primaryResponse = responses.find(r => !r.isError) ?? responses[0];
    const otherResponses = responses.filter(r => r !== primaryResponse);

    return {
        id: op.operationId,
        method,
        path,
        loadPath: op['x-loadPath'] ?? path,
        summary: op.summary,
        description: op.description,
        authLabel: auth.label,
        authKind: auth.kind,
        parameters,
        requestSchemaNote: resolvedBodySchema.description,
        requestFields,
        requestExample: formatExample(jsonReq?.example),
        requestBodyObject: jsonReq?.example,
        confirmation: op['x-confirmation'],
        primaryResponse,
        otherResponses,
        tags: [...op.tags],
    };
}

export const contractGroups: EndpointGroup[] = (() => {
    const byTag = new Map<string, EndpointDoc[]>();
    for (const tag of openApiSpec.tags) byTag.set(tag.name, []);

    const methods: readonly ('get' | 'post' | 'patch' | 'delete')[] = ['get', 'post', 'patch', 'delete'];
    for (const [path, pathItem] of Object.entries(openApiSpec.paths)) {
        for (const m of methods) {
            const op = pathItem[m];
            if (!op) continue;
            const doc = buildEndpoint(path, m.toUpperCase() as HttpMethod, op);
            const primaryTag = op.tags[0] ?? 'Other';
            const list = byTag.get(primaryTag) ?? [];
            list.push(doc);
            byTag.set(primaryTag, list);
        }
    }

    return openApiSpec.tags.map(tag => ({
        title: tag.name,
        description: tag.description,
        entries: byTag.get(tag.name) ?? [],
    }));
})();
