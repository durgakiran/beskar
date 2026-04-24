import { useCallback, useState } from "react";

const USER_URI = process.env.NEXT_PUBLIC_USER_SERVER_URL;
const EMPTY_HEADERS: Record<string, any> = {};

/**
 *
 * @param path
 * @param headers
 * @returns isLoading, Data type and any errors
 */
export function usePost<T, P>(path: string, headers: Record<string, any> = {}): [{ isLoading: boolean; data: T; errors: any; response: number }, mutateData: (payLoad: P) => void] {
    const [isDataFetching, setIsDataFetching] = useState<boolean>(false);
    const [data, setData] = useState<T>();
    const [errors, setErrors] = useState<any>();
    const [response, setResponse] = useState<number>();
    const requestHeaders = headers ?? EMPTY_HEADERS;
    const headersKey = JSON.stringify(requestHeaders);

    const mutateData = useCallback((payLoad: P) => {
        setIsDataFetching(true);
        setData(undefined);
        setErrors(undefined);
        setResponse(undefined);
        fetch(USER_URI + "/" + path, {
            method: "POST",
            body: JSON.stringify(payLoad),
            credentials: "include",
            headers: { "Content-Type": "application/json", ...requestHeaders },
        })
            .then((res) => {
                setResponse(res.status);
                if (res.ok) {
                    res.clone()
                        .json()
                        .then((data) => {
                            setIsDataFetching(false);
                            setData(data as T);
                        })
                        .catch(() => {
                            setIsDataFetching(false);
                            res.text().then((text) => setData(text as T));
                        });
                } else {
                    res.json()
                        .then((body) => {
                            const message = body?.error?.detail || body?.error?.message || `Request failed with status ${res.status}`;
                            setIsDataFetching(false);
                            setErrors(new Error(message));
                        })
                        .catch(() => {
                            setIsDataFetching(false);
                            setErrors(new Error(`Request failed with status ${res.status}`));
                        });
                }
            })
            .catch((err) => {
                setIsDataFetching(false);
                setErrors(err);
            });
    }, [headersKey, path]);

    return [{ isLoading: isDataFetching, data, errors, response }, mutateData];
}
