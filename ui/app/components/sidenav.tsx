"use client";
import { useLazyQuery, useMutation } from "@apollo/client";
import { client } from "@http";
import { GRAPHQL_DELETE_PAGE, GRAPHQL_GET_PAGES } from "@queries/space";
import { useCallback, useEffect, useState } from "react";
import { useRouter, useSelectedLayoutSegment } from "next/navigation";
import AddPage from "./addPage";
import { Button, Dropdown, Sidebar, Spinner } from "flowbite-react";
import {
    HiHome,
    HiDocumentText,
    HiTrash,
    HiOutlinePencil,
    HiOutlineDotsHorizontal,
    HiOutlineMinusSm,
    HiOutlinePlusSm,
    HiDotsCircleHorizontal,
    HiOutlineDotsCircleHorizontal,
    HiOutlineChevronDown,
    HiOutlineChevronRight,
    HiCog,
} from "react-icons/hi";

import { twMerge } from "tailwind-merge";
import Link from "next/link";
import { Accordion } from "flowbite-react";
import { useSession } from "next-auth/react";
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
    pages: Array<Pages>;
}

interface CoreSpaceUrlData {
    space: SpaceDatum;
}

interface SpaceData {
    core_space_url: Array<CoreSpaceUrlData>;
}

interface Props {
    id: string;
}

export default function SideNav(param: Props) {
    // const user = useUser();
    const { data: sessionData, status } = useSession()
    const [isOpen, setIsOpen] = useState(false);
    const [isDropdownOpen, setIsDropdownOpen] = useState(true);
    const [showCreateDialog, setShowCreateDialog] = useState(false);
    const router = useRouter();
    const [getPages, { data, loading, error, refetch }] = useLazyQuery<SpaceData>(GRAPHQL_GET_PAGES, { client: client, variables: { id: param.id } });
    const [mutateFunction] = useMutation(GRAPHQL_DELETE_PAGE, { client: client });
    const pathName = useSelectedLayoutSegment();
    const [pagesData, setPagesData] = useState<Array<Pages>>([]);

    useEffect(() => {
        if (status === "authenticated" && sessionData) {
            getPages();
        } else if (status !== "loading") {
            router.push("/");
        }
    }, [sessionData, status]);

    useEffect(() => {
        console.log(data);
    }, [data]);

    const toggleDropdown = () => {
        setIsDropdownOpen(!isDropdownOpen);
    };

    const openAddPage = () => {
        setIsOpen(true);
    };
    const activeItem = useCallback(
        (path: string) => {
            if (pathName === path) {
                return "true";
            }

            return "false";
        },
        [pathName],
    );

    const deletePage = async (page: number) => {
        // TODO: Add confirmation page
        // await mutateFunction({ variables: { pgId: page } });
        // refetch();
        // router.push(`/space/${param.id}`);
    };

    const editePage = async (page: number) => {
        router.push(`/edit/${param.id}/${page}`);
    };

    if (loading || status == "loading") {
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
                            <div className="sidenav-content-container">
                                <div className="content-header flex flex-row items-center">
                                    <button onClick={toggleDropdown}>{isDropdownOpen ? <HiOutlineChevronDown /> : <HiOutlineChevronRight />}</button>
                                    <span className="ml-2 mr-1">Contents</span>
                                    <button className="ml-auto" onClick={openAddPage}>
                                        <HiOutlinePlusSm />
                                    </button>
                                </div>
                                {isDropdownOpen && (
                                    <div className="dropdown-content">
                                        <Sidebar.ItemGroup>
                                            {data && data.core_space_url && data.core_space_url[0].space.pages.map((page, i) => (
                                                <Sidebar.Item href={`/space/${param.id}/view/${page.id}`} key={i}>{page.docs[0].title}</Sidebar.Item>
                                            ))}
                                        </Sidebar.ItemGroup>
                                    </div>
                                )}
                            </div>
                        </Sidebar.ItemGroup>
                    </Sidebar.Items>
                </Sidebar>
                <AddPage isOpen={isOpen} setIsOpen={setIsOpen} spaceId={data.core_space_url[0].space.id} />
            </>
        );
    }

    return <>error</>;
}
