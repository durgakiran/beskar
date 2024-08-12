"use client";
import { useLazyQuery, useMutation } from "@apollo/client";
import { client } from "@http";
import { GRAPHQL_DELETE_PAGE, GRAPHQL_GET_PAGES, GRAPHQL_GET_PAGES_BY_SPACE_ID } from "@queries/space";
import { useCallback, useEffect, useState } from "react";
import { usePathname, useRouter, useSelectedLayoutSegment } from "next/navigation";
import AddPage from "./addPage";
import { Sidebar, Spinner } from "flowbite-react";
import { HiHome, HiOutlinePlusSm, HiOutlineChevronDown, HiOutlineChevronRight, HiCog } from "react-icons/hi";
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

interface PageDocMap {
    title: string;
}

interface CoreSpaceUrlData {
    id: number;
    parent_id: number;
    page_doc_maps: Array<PageDocMap>;
}

interface SpaceData {
    core_page: Array<CoreSpaceUrlData>;
}

interface Props {
    id: string;
}

interface IPages {
    id: number;
    parentId: number;
    details: PageDocMap;
    children: Array<IPages>;
}

function SideNavItem({ pages, spaceId, openAddPage }: { pages: Array<IPages>; spaceId: string; openAddPage: (parentId: number) => void }) {
    return (
        <div className="dropdown-content">
            <ul className="list-disc pl-6 pt-2 pr-2">
                {pages &&
                    pages.map((page, i) => {
                        if (page.details && page.details.title) {
                            return (
                                <li key={i}>
                                    {/* active={pahtName2 === `/space/${param.id}/view/${page.id}`} */}
                                    <div className="flex flex-row items-center py-1 px-1 hover:bg-gray-100">
                                        <Link className="text-sm" href={`/space/${spaceId}/view/${page.id}`}>
                                            {page.details.title}
                                        </Link>
                                        <button className="ml-auto hover:bg-gray-200 rounded p-1" onClick={() => openAddPage(page.id)}>
                                            <HiOutlinePlusSm />
                                        </button>
                                    </div>
                                    {page.children.length > 0 && <SideNavItem pages={page.children} spaceId={spaceId} openAddPage={openAddPage} />}
                                </li>
                            );
                        }
                    })}
            </ul>
        </div>
    );
}

export default function SideNav(param: Props) {
    // const user = useUser();
    const { data: sessionData, status } = useSession();
    const [isOpen, setIsOpen] = useState(false);
    const [isDropdownOpen, setIsDropdownOpen] = useState(true);
    const [showCreateDialog, setShowCreateDialog] = useState(false);
    const router = useRouter();
    const [getPages, { data, loading, error, refetch }] = useLazyQuery<SpaceData>(GRAPHQL_GET_PAGES_BY_SPACE_ID, { client: client, variables: { id: param.id } });
    const [mutateFunction] = useMutation(GRAPHQL_DELETE_PAGE, { client: client });
    const pathName = useSelectedLayoutSegment();
    const [pagesData, setPagesData] = useState<Array<Pages>>([]);
    const pahtName2 = usePathname();
    const [parentId, setParentId] = useState<number>();
    const [pages, setPages] = useState<IPages[]>();

    useEffect(() => {
        if (status === "authenticated" && sessionData) {
            getPages();
        } else if (status !== "loading") {
            router.push("/");
        }
    }, [sessionData, status]);

    useEffect(() => {
        if (error && error.message.includes("JWTExpired")) {
            signIn("keycloak");
        }
    }, [error]);

    useEffect(() => {
        if (data) {
            const pagemap = new Map<number, Array<IPages>>();
            const pages: Array<IPages> = [];
            data.core_page
                .map((page): IPages => {
                    return {
                        id: page.id,
                        parentId: page.parent_id,
                        details: {
                            title: page.page_doc_maps && page.page_doc_maps[0] && page.page_doc_maps[0].title ? page.page_doc_maps[0].title : "",
                        },
                        children: [],
                    };
                    // if (page.parentId && page.page_doc_maps && page.page_doc_maps[0].title) {
                    //     const parent = pagemap.get(page.parentId);
                    //     if (parent) {
                    //         parent.push({ id: page.id, details: { title: page.page_doc_maps[0].title }, children: [] });
                    //     } else {
                    //         pagemap.set(page.parentId, [{ id: page.id, details: { title: page.page_doc_maps[0].title }, children: [] }]);
                    //     }
                    // }
                })
                .forEach((page) => {
                    if (pagemap.get(page.parentId)) {
                        pagemap.get(page.parentId).push(page);
                    } else if (page.parentId) {
                        pagemap.set(page.parentId, [page]);
                    }
                    pages.push(page);
                });
            const rootPages: IPages[] = [];
            pages.forEach((page) => {
                console.log(pagemap.get(page.parentId));
                if (!pagemap.get(page.parentId)) {
                    // it is not child of anyone
                    rootPages.push(page);
                }
                if (pagemap.get(page.id)) {
                    page.children.push(...pagemap.get(page.id));
                }
            });
            setPages(rootPages);
        }
    }, [data]);

    useEffect(() => {
        console.log(pages);
    }, [pages]);

    const toggleDropdown = () => {
        setIsDropdownOpen(!isDropdownOpen);
    };

    const openAddPage = (parentId?: number) => {
        setParentId(parentId);
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
                            {/* <Sidebar.Item href={`/space/${param.id}/settings`} icon={HiCog}>
                                Settings
                            </Sidebar.Item> */}
                            <div className="sidenav-content-container">
                                <div className="content-header flex flex-row items-center">
                                    <button onClick={toggleDropdown}>{isDropdownOpen ? <HiOutlineChevronDown /> : <HiOutlineChevronRight />}</button>
                                    <span className="ml-2 mr-1 text-sm font-medium">PAGES</span>
                                    <button className="ml-auto" onClick={() => openAddPage()}>
                                        <HiOutlinePlusSm />
                                    </button>
                                </div>
                                {isDropdownOpen && (
                                    <>
                                        <SideNavItem pages={pages} openAddPage={openAddPage} spaceId={param.id} />
                                    </>
                                )}
                            </div>
                        </Sidebar.ItemGroup>
                    </Sidebar.Items>
                </Sidebar>
                <AddPage isOpen={isOpen} setIsOpen={setIsOpen} editPage={editePage} spaceId={param.id} parentId={parentId} />
            </>
        );
    }

    return <>error</>;
}
