"use client";
import { useLazyQuery, useMutation } from "@apollo/client";
import { client } from "@http";
import { GRAPHQL_DELETE_PAGE, GRAPHQL_GET_PAGES } from "@queries/space";
import { useCallback, useEffect, useState } from "react";
import { usePathname, useRouter, useSelectedLayoutSegment } from "next/navigation";
import AddPage from "./addPage";
import { Sidebar, Spinner } from "flowbite-react";
import {
    HiHome,
    HiOutlinePlusSm,
    HiOutlineChevronDown,
    HiOutlineChevronRight,
    HiCog,
} from "react-icons/hi";
import { signIn, useSession } from "next-auth/react";
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
    const pahtName2 = usePathname();

    useEffect(() => {
        if (status === "authenticated" && sessionData) {
            getPages();
        } else if (status !== "loading") {
            router.push("/");
        }
    }, [sessionData, status]);

    useEffect(() => {
        if (error && error.message.includes("JWTExpired")) {
            signIn("keycloak")
        }
    }, [error])

    const toggleDropdown = () => {
        setIsDropdownOpen(!isDropdownOpen);
    };

    const openAddPage = () => {
        setIsOpen(true);
    };

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
                                    <span className="ml-2 mr-1 text-sm font-medium">PAGES</span>
                                    <button className="ml-auto" onClick={openAddPage}>
                                        <HiOutlinePlusSm />
                                    </button>
                                </div>
                                {isDropdownOpen && (
                                    <div className="dropdown-content">
                                        <ul className="list-disc pl-6 pt-2 pr-2">
                                            {data && data.core_space_url && data.core_space_url[0].space.pages.map((page, i) => (
                                                <li className="py-1 hover:bg-gray-100" key={i}>
                                                    {/* active={pahtName2 === `/space/${param.id}/view/${page.id}`} */}
                                                    <Link className="text-sm" href={`/space/${param.id}/view/${page.id}`}>{page.docs[0].title}</Link>
                                                </li>
                                            ))}
                                        </ul>
                                    </div>
                                )}
                            </div>
                        </Sidebar.ItemGroup>
                    </Sidebar.Items>
                </Sidebar>
                <AddPage isOpen={isOpen} setIsOpen={setIsOpen} editPage={editePage} spaceId={data.core_space_url[0].space.id} />
            </>
        );
    }

    return <>error</>;
}
