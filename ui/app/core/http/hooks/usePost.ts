import { useCallback, useState } from "react";

/**
 *
 * @param path
 * @param headers
 * @returns isLoading, Data type and any errors
 */
export function usePost<T, P>(path: string, headers: Record<string, any> = {}): [{ isLoading: boolean; data: T; errors: any }, mutateData: (payLoad: P) => void] {
    const [isDataFetching, setIsDataFetching] = useState<boolean>(false);
    const [data, setData] = useState<T>();
    const [errors, setErrors] = useState<any>();

    const mutateData = useCallback((payLoad: P) => {
        setIsDataFetching(true);
        fetch("http://localhost:9095/" + path, {
            method: "POST",
            credentials: "omit",
            body: JSON.stringify(payLoad),
            headers: { Authorization: `Bearer ${localStorage.getItem("access_token")}`, "Content-Type": "application/json", ...headers },
        })
            .then((res) => {
                setIsDataFetching(false);
                if (res.ok) {
                    res.clone()
                        .json()
                        .then((data) => setData(data as T))
                        .catch((e) => setData(res.text() as T));
                }
                setErrors(new Error(`Request failed with status ${res.status}`))
            })
            .catch((err) => {
                setIsDataFetching(false);
                setErrors(err);
            });
    }, []);

    return [{ isLoading: isDataFetching, data, errors }, mutateData];
}
