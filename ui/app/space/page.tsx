"use client";
import { useEffect, useState } from "react";
import { client } from "@http";
import { useQuery } from "@apollo/client";
import { GRAPHQL_GET_SPACES } from "@queries/space";
import AddSpace from "@components/addSpace";
import { useRouter } from "next/navigation";
import { Avatar, Button, Card, Spinner } from "flowbite-react";
import Slate from "@components/slate";
import { useLogout } from "app/core/auth/useKeycloak";
import { signIn } from "next-auth/react";


interface Data {
    name: string;
    id: string;
    slug: string;
}

const BLANK_STATE_HEADING = "No Spaces, Please create one";
const BLANK_STATE_BTN_TEXT = "Create a space";

export default function Page() {
    const router = useRouter();
    const [isOpen, setIsOpen] = useState(false);
    const [tableData, setTableData] = useState([]);
    const { loading, error, data, refetch } = useQuery(GRAPHQL_GET_SPACES, { client: client });
    const logout = useLogout();

    useEffect(() => {
        if (data && data.core_space) {
            const newData: Data[] = data.core_space.map((datum, i) => {
                return { id: datum.id, slug: datum.space_urls[0].id ?? "#", name: datum.name };
            });
            setTableData(newData);
        }
    }, [data]);

    useEffect(() => {
        if (error && error.message.includes("JWTExpired")) {
            signIn("keycloak")
        }
    }, [error]);

    return (
        <>
            <div className="py-2.5 md:mx-8">
                <div className="mb-8 flex justify-between">
                    <div>
                        <h1 className="text-xl font-bold tracking-tight text-gray-900 dark:text-white">
                            Your Spaces
                        </h1>
                        <h6 className="text-sm font-bold tracking-tight text-gray-500 dark:text-white">Organize your content across spaces</h6>
                    </div>
                    <div>
                        <Button size={"sm"} onClick={() => {
                            setIsOpen(true);
                        }}>Add Space +</Button>
                    </div>
                </div>
                <div className="flex flex-col items-center">
                    {
                        loading ? <Spinner aria-label="loading data" size="xl" /> : null
                    }
                </div>
                <div className="flex flex-wrap space-x-4">
                    {
                        !loading && tableData.length ? (
                            tableData.map((item, i) => {
                                return (
                                    <Card href={`/space/${item.slug}`} className="w-48" key={i}>
                                        <div className="flex flex-col items-center">
                                            <Avatar size="lg" placeholderInitials={item.name.charAt(0).toUpperCase()} />
                                        </div>
                                        <div className="text-center">
                                            <h2 className="text-lg font-bold tracking-tight text-gray-900 dark:text-white">
                                                {item.name}
                                            </h2>
                                            <p className="font-normal text-gray-700 dark:text-gray-400">
                                                About the space
                                            </p>
                                        </div>
                                    </Card>
                                )
                            })
                        ) : null
                    }
                    {
                        !loading && !tableData.length ? (<Slate title={BLANK_STATE_HEADING} />) : null
                    }
                </div>
                <AddSpace
                    isOpen={isOpen}
                    setIsOpen={(open: boolean) => {
                        setIsOpen(open);
                        refetch();
                    }}
                />
            </div>
        </>
    );
}
