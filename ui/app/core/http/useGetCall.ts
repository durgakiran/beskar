import { useEffect, useState } from "react";
import { get } from "./call";

interface Response<T> {
    data: T;
    message: string;
    success: boolean;
}

export function useGetCall<T>(url: string): [number, Response<T>] {
    const [res, setRes] = useState<Response<T>>();
    const [status, setStatus] = useState<number>();

    useEffect(() => {
        const fetchData = async () => {
            try {
                const response = await get(url);
                console.log("response code: ", response.status);
                // if (response.status == 302) { // redirect to url
                //     const urlObj = new URL(response.headers.Location);
                //     urlObj.hostname = "localhost";
                //     urlObj.port = "8084";
                //     window.location.href = urlObj.toString();
                // }
                setRes(response.data as Response<T>)
                setStatus(response.status);
            } catch (error) {
                console.error(error);
            }
        }
        fetchData();
    }, []);

    return [status, res]
}
