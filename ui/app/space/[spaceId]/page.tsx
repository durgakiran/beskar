'use client'

import { Response, useGet } from "@http/hooks"
import { Spinner } from "flowbite-react";
import { useEffect } from "react";

interface space {
    name: string;
    id: string;
}

export default function Page({ params }: { params: { spaceId: string } }) {
    const [ { isLoading, data, errors }, fetchData ] = useGet<Response<space>>(`space/${params.spaceId}/details`);

    useEffect(() => {
        fetchData();
    }, []);

    if (errors) {
        return (
            <div>{errors.message}</div>
        )
    }

    if (isLoading) {
        return (
            <div><Spinner /></div>
        )
    }
    
    return (
        <div>
            {
                data && data.data ? <h1>{data.data.name}</h1> : null
            }
        </div>
    )
}
