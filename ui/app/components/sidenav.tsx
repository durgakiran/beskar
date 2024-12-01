"use client";
import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import AddPage from "./addPage";
import { Sidebar, Spinner } from "flowbite-react";
import { HiHome, HiOutlinePlusSm, HiOutlineChevronDown, HiOutlineChevronRight, HiCog } from "react-icons/hi";
import Link from "next/link";
import { Response, useGet } from "@http/hooks";
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

interface IPageList {
    pageId: number;
    ownerId: string;
    title: string;
    parentId: number;
}

export default function SideNav(param: Props) {
    const [isOpen, setIsOpen] = useState(false);
    const [isDropdownOpen, setIsDropdownOpen] = useState(true);
    const router = useRouter();
    const [{ data, isLoading: loading, errors: error }, fetchData] = useGet<Response<IPageList[]>>(`space/${param.id}/page/list`);
    const [parentId, setParentId] = useState<number>();
    const [pages, setPages] = useState<IPages[]>();


    useEffect(() => {
        fetchData();
    }, []);

    useEffect(() => {
        if (data && data.data) {
            const pagemap = new Map<number, Array<IPages>>();
            const pages: Array<IPages> = [];
            data.data
                .map((page): IPages => {
                    return {
                        id: page.pageId,
                        parentId: page.parentId,
                        details: {
                            title: page.title ? page.title : "",
                        },
                        children: [],
                    };
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

    if (loading) {
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
                            <Sidebar.Item href={`/space/${param.id}/settings/users`} icon={HiCog}>
                                Settings
                            </Sidebar.Item>
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
