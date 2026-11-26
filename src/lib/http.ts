export function jsonResponse(value: unknown, status = 200, headers?: HeadersInit): Response {
    const result = new Headers(headers);
    result.set('Content-Type', 'application/json; charset=utf-8');
    result.set('Cache-Control', 'no-store');
    return new Response(JSON.stringify(value), { status, headers: result });
}

export async function readJson(request: Request, maxBytes = 1024 * 1024): Promise<unknown> {
    const length = Number(request.headers.get('content-length') ?? 0);
    if (length > maxBytes) throw new RangeError('Request body is too large.');
    if (!request.body) throw new TypeError('Request body is required.');
    const reader = request.body.getReader();
    const chunks: Uint8Array[] = [];
    let size = 0;
    for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        size += value.byteLength;
        if (size > maxBytes) {
            await reader.cancel();
            throw new RangeError('Request body is too large.');
        }
        chunks.push(value);
    }
    const bytes = new Uint8Array(size);
    let offset = 0;
    for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
    const text = new TextDecoder('utf-8', { fatal: true }).decode(bytes);
    try { return JSON.parse(text); }
    catch { throw new TypeError('Request body must be valid JSON.'); }
}

export function record(value: unknown): Record<string, unknown> {
    if (!value || typeof value !== 'object' || Array.isArray(value)) throw new TypeError('Expected a JSON object.');
    return value as Record<string, unknown>;
}

export function stringField(value: unknown, name: string, max = 256): string {
    if (typeof value !== 'string' || !value.trim() || value.length > max) throw new TypeError(`${name} must be a non-empty string of at most ${max} characters.`);
    return value;
}

