import { useCallback, useState } from "react";

/**
 *
 * @param path
 * @param headers
 * @returns isLoading, Data type and any errors
 */
export function useGet<T>(path: string, headers: Record<string, any> = {}): [{ isLoading: boolean; data: T; errors: any }, fetchData: () => void] {
    const [isDataFetching, setIsDataFetching] = useState<boolean>(false);
    const [data, setData] = useState<T>();
    const [errors, setErrors] = useState();

    const fetchData = useCallback(() => {
        setIsDataFetching(true);
        fetch("http://localhost:9095/" + path, { credentials: "omit", headers: { Authorization: `Bearer ${localStorage.getItem("access_token")}`, "Content-Type": "application/json", ...headers } })
            .then((res) => {
                setIsDataFetching(false);
                res.json().then(data => setData(data as T)).catch(e => setErrors(e))
            })
            .catch((err) => {
                setIsDataFetching(false);
                setErrors(err);
            });
    }, []);

    return [{ isLoading: isDataFetching, data, errors }, fetchData];
}
