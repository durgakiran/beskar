import { useCallback, useState } from "react";

const USER_URI = process.env.NEXT_PUBLIC_USER_SERVER_URL;

/**
 *
 * @param path
 * @param headers
 * @returns isLoading, Data type and any errors
 */
export function usePUT<T, P>(path: string, headers: Record<string, any> = {}): [{ isLoading: boolean; data: T; errors: any }, mutateData: (payLoad: P) => void] {
    const [isDataFetching, setIsDataFetching] = useState<boolean>(false);
    const [data, setData] = useState<T>();
    const [errors, setErrors] = useState<any>();

    const mutateData = useCallback((payLoad: P) => {
        setIsDataFetching(true);
        fetch(USER_URI + "/" + path, {
            method: "PUT",
            body: JSON.stringify(payLoad),
            headers: { "Content-Type": "application/json", ...headers },
        })
            .then((res) => {
                setIsDataFetching(false);
                if (res.ok) {
                    res.clone()
                        .json()
                        .then((data) => setData(data as T))
                        .catch((e) => setErrors(e));
                } else {
                    setErrors(new Error(`Request failed with status ${res.status}`))
                }
            })
            .catch((err) => {
                setIsDataFetching(false);
                setErrors(err);
            });
    }, []);

    return [{ isLoading: isDataFetching, data, errors }, mutateData];
}
