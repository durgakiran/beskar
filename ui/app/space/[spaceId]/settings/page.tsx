'use client'

import User from "@components/settings/User";
import { Response, useGet } from "@http/hooks";
import { Tabs } from "flowbite-react";
import { useEffect } from "react";

interface User {
    id: string;
    name: string;
    role: string;
}

export default function Page({ params }: { params: { spaceId: string } }) {
    const [ { isLoading, data, errors }, fetchData ] = useGet<Response<User[]>>(`space/${params.spaceId}/users`);

    useEffect(() => {
        fetchData();
    }, []);

    useEffect(() => {
        console.log(data);
    }, [data]);

    return (
        <Tabs aria-label="Settings tabs">
            <Tabs.Item active title="Users">
                <User />
            </Tabs.Item>
            <Tabs.Item title="General">
                <p>Users</p>
            </Tabs.Item>
        </Tabs>
    )
}
