'use client'
import { useLazyQuery, useMutation } from "@apollo/client";
import { client } from "@http";
import { GRAPHQL_DELETE_PAGE, GRAPHQL_GET_PAGES } from "@queries/space";
import { useCallback, useEffect, useState } from "react";
import { useRouter, useSelectedLayoutSegment } from "next/navigation";
import AddPage from "./addPage";
import { useUser } from "app/core/auth/useKeycloak";
import { Dropdown, Sidebar, Spinner } from "flowbite-react";
import { HiHome, HiDocumentText, HiTrash, HiOutlinePencil, HiOutlineDotsHorizontal, HiOutlineMinusSm, HiOutlinePlusSm, HiCog } from 'react-icons/hi';
import { twMerge } from 'tailwind-merge';
import Link from "next/link";


interface Docs {
    title: string;
    id: number;
}

interface Pages {
    id: number;
    docs: Array<Docs>;

}

interface SpaceDatum {
    name: string;
    id: string;
    pages: Array<Pages>
}

interface CoreSpaceUrlData {
    space: SpaceDatum
}

interface SpaceData {
    core_space_url: Array<CoreSpaceUrlData>;
}

interface Props {
    id: string;
}

export default function SideNav(param: Props) {
    const user = useUser();
    const [isOpen, setIsOpen] = useState(false);
    const router = useRouter();
    const [getPages, { data, loading, error, refetch }] = useLazyQuery<SpaceData>(GRAPHQL_GET_PAGES, { client: client, variables: { id: param.id } });
    const [mutateFunction] = useMutation(GRAPHQL_DELETE_PAGE, { client: client })
    const pathName = useSelectedLayoutSegment();

    useEffect(() => {
        if (user && user.authenticated) {
            getPages();
        }
        if (user && !user.authenticated) {
            router.push("/");
        }
    }, [user]);


    const activeItem = useCallback((path: string) => {
        if (pathName === path) {
            return 'true';
        }

        return 'false'
    }, [pathName]);

    const deletePage = async (page: number) => {
        // TODO: Add confirmation page
        // await mutateFunction({ variables: { pgId: page } });
        // refetch();
        // router.push(`/space/${param.id}`);
    };

    const editePage = async (page: number) => {
        router.push(`/edit/${param.id}/${page}`);
    };


    if (loading || user.loading) {
        return <Spinner size="lg" />;
    }


    if (data) {
        return (
            <>
                <Sidebar aria-label="Content navigation">
                    <Sidebar.Items>
                        <Sidebar.ItemGroup>
                            <Sidebar.Item href={`/space/${param.id}`} icon={HiHome}>
                                Overview
                            </Sidebar.Item>
                            <Sidebar.Item href={`/space/${param.id}/settings`} icon={HiCog}>
                                Settings
                            </Sidebar.Item>
                        </Sidebar.ItemGroup>
                        <Sidebar.ItemGroup>
                            <Sidebar.Collapse
                                icon={HiDocumentText}
                                label="Content"
                                open
                                renderChevronIcon={(theme, open) => {
                                    const IconComponent = open ? HiOutlineMinusSm : HiOutlinePlusSm;

                                    return <IconComponent aria-hidden className={twMerge(theme.label.icon.open[open ? 'on' : 'off'])} />;
                                }}
                            >
                                { 
                                    data.core_space_url[0].space.pages.map((value, i) => {
                                        if (value.docs[0]) {
                                            return (
                                                <li className="py-2 pl-4 flex flex-nowrap border-r-2 hover:bg-gray-100 active:bg-gray-100" key={i}>
                                                    <Link href={`/space/${param.id}/view/${value.id}`}>{value.docs[0].title}</Link>
                                                    <div className="relative">
                                                        <Dropdown className="bg-white" label={<HiOutlineDotsHorizontal size="24" />} inline aria-label="options" >
                                                            <Dropdown.Item onClick={() => editePage(value.id)} icon={HiOutlinePencil}>Edit</Dropdown.Item>
                                                            <Dropdown.Item icon={HiTrash}>Delete</Dropdown.Item>
                                                        </Dropdown>
                                                    </div>
                                                </li>
                                            );
                                        }
                                        return null;
                                    })
                                }
                            </Sidebar.Collapse>
                        </Sidebar.ItemGroup>
                    </Sidebar.Items>
                </Sidebar>
                <AddPage isOpen={isOpen} setIsOpen={setIsOpen} spaceId={data.core_space_url[0].space.id} />
            </>
        );
    }

    return (
        <>error</>
    )
}
