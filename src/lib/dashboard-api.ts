export async function dashboardResponse(path: string, init?: RequestInit): Promise<Response> {
    const response = await fetch(path, {
        cache: 'no-store',
        ...init,
        headers: {
            Accept: 'application/json',
            ...(init?.body ? { 'Content-Type': 'application/json' } : {}),
            ...init?.headers,
        },
    });
    if (response.status === 401) window.location.assign('/login');
    if (!response.ok) {
        const error = await response.json().catch(() => null) as { error?: string } | null;
        throw new Error(error?.error ?? `Request failed (${response.status}).`);
    }
    return response;
}

export async function dashboardRequest<T>(path: string, init?: RequestInit): Promise<T> {
    const response = await dashboardResponse(path, init);
    return (response.status === 204 ? undefined : await response.json()) as T;
}
