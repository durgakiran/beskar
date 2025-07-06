import { useCallback, useState } from "react";

const USER_URI = process.env.NEXT_PUBLIC_USER_SERVER_URL;

/**
 *
 * @param path
 * @param headers
 * @returns isLoading, Data type and any errors
 */
export function useGet<T>(path: string, headers: Record<string, any> = {}): [{ isLoading: boolean; data: T; errors: any, response: number }, fetchData: (queryParams?: Record<string, any>, pathOverride?: string) => void] {
    const [isDataFetching, setIsDataFetching] = useState<boolean>(false);
    const [data, setData] = useState<T>();
    const [errors, setErrors] = useState();
    const [response, setResponse] = useState<number>();

    const fetchData = useCallback((queryParams?: Record<string, any>, pathOverride?: string) => {
        setIsDataFetching(true);
        fetch(USER_URI + "/" + (pathOverride || path) + (queryParams ? `?${new URLSearchParams(queryParams).toString()}` : ""), { credentials: "include", headers: { "Content-Type": "application/json", ...headers } })
            .then((res) => {
                setIsDataFetching(false);
                setResponse(res.status);
                res.json()
                    .then((data) => setData(data as T))
                    .catch((e) => setErrors(e));
            })
            .catch((err) => {
                setIsDataFetching(false);
                setErrors(err);
            });
    }, []);

    return [{ isLoading: isDataFetching, data, errors, response }, fetchData];
}
