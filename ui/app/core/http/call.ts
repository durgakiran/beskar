export const post = async (
    path: string,
    body: any,
    headerOptions: Record<string, any>,
    config?: { signal?: AbortSignal },
) => {
    const isFormData = body instanceof FormData;
    const fetchHeaders: HeadersInit = { ...headerOptions };
    if (!isFormData && !fetchHeaders['Content-Type']) {
        fetchHeaders['Content-Type'] = 'application/json';
    }

    const res = await fetch(path, {
        method: 'POST',
        credentials: 'include',
        headers: fetchHeaders,
        body: isFormData ? body : JSON.stringify(body),
        signal: config?.signal,
    });
    if (!res.ok) throw new Error(`Request failed with status ${res.status}`);
    const json = await res.json();
    return { data: json };
};

export const get = async (path: string, headers: Record<string, any> = {}) => {
    const res = await fetch(path, {
        credentials: 'include',
        headers: { 'Content-Type': 'application/json', ...headers },
    });
    if (!res.ok) throw new Error(`Request failed with status ${res.status}`);
    const json = await res.json();
    return { data: json };
};
