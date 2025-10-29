'use client'

import { Response, useGet } from "@http/hooks"
import { Spinner } from "flowbite-react";
import { use, useEffect } from "react";

interface space {
    name: string;
    id: string;
}

export default function Page({ params }: { params: Promise<{ spaceId: string }> }) {
    const { spaceId } = use(params);
    const [ { isLoading, data, errors }, fetchData ] = useGet<Response<space>>(`space/${spaceId}/details`);

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
