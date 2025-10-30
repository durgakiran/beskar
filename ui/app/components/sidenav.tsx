"use client";
import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import AddPage from "./addPage";
import { Box, Flex, Text, IconButton, Spinner } from "@radix-ui/themes";
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
        <div className="space-y-0.5">
            <ul className="list-none pl-4 space-y-0.5">
                {pages &&
                    pages.map((page, i) => {
                        if (page.details && page.details.title) {
                            return (
                                <li key={i}>
                                    <div className="flex flex-row items-center gap-1 py-1.5 px-2 rounded-sm hover:bg-mauve-50 transition-colors group">
                                        <Link 
                                            className="text-sm text-neutral-700 hover:text-primary-600 flex-1 truncate transition-colors" 
                                            href={`/space/${spaceId}/view/${page.id}`}
                                        >
                                            {page.details.title}
                                        </Link>
                                        <button 
                                            className="opacity-0 group-hover:opacity-100 hover:bg-primary-100 text-primary-600 rounded-sm p-1 transition-all" 
                                            onClick={() => openAddPage(page.id)}
                                            title="Add sub-page"
                                        >
                                            <HiOutlinePlusSm size={14} />
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
        return (
            <Box className="w-64 h-full bg-neutral-50 border-r border-neutral-200" p="4">
                <Flex align="center" justify="center">
                    <Spinner size="3" />
                </Flex>
            </Box>
        );
    }

    if (data) {
        return (
            <>
                <Box className="w-64 h-full bg-neutral-50 border-r border-neutral-200" p="4">
                    <Flex direction="column" gap="1">
                        {/* Navigation Links */}
                        <Link 
                            href={`/space/${param.id}`} 
                            className="flex items-center gap-3 px-3 py-2.5 rounded-sm hover:bg-mauve-100 hover:text-primary-700 text-neutral-700 text-sm font-medium transition-colors"
                        >
                            <HiHome size={18} className="text-mauve-600" />
                            <span>Overview</span>
                        </Link>
                        <Link 
                            href={`/space/${param.id}/settings/users`} 
                            className="flex items-center gap-3 px-3 py-2.5 rounded-sm hover:bg-mauve-100 hover:text-primary-700 text-neutral-700 text-sm font-medium transition-colors"
                        >
                            <HiCog size={18} className="text-mauve-600" />
                            <span>Settings</span>
                        </Link>
                        
                        {/* Divider */}
                        <div className="my-3 border-t border-neutral-200" />
                        
                        {/* Pages Section */}
                        <Box>
                            <Flex 
                                align="center" 
                                gap="2" 
                                mb="2" 
                                px="2"
                                className="group"
                            >
                                <IconButton 
                                    size="1" 
                                    variant="ghost" 
                                    onClick={toggleDropdown}
                                    className="text-mauve-600 hover:text-primary-600 hover:bg-primary-50"
                                >
                                    {isDropdownOpen ? <HiOutlineChevronDown size={16} /> : <HiOutlineChevronRight size={16} />}
                                </IconButton>
                                <Text 
                                    size="1" 
                                    weight="bold" 
                                    className="flex-1 text-neutral-500 uppercase tracking-wide"
                                >
                                    Pages
                                </Text>
                                <IconButton 
                                    size="1" 
                                    variant="ghost" 
                                    onClick={() => openAddPage()}
                                    className="text-primary-600 hover:bg-primary-100"
                                    title="Add new page"
                                >
                                    <HiOutlinePlusSm size={16} />
                                </IconButton>
                            </Flex>
                            {isDropdownOpen && pages && pages.length > 0 && (
                                <SideNavItem pages={pages} openAddPage={openAddPage} spaceId={param.id} />
                            )}
                            {isDropdownOpen && (!pages || pages.length === 0) && (
                                <Box px="4" py="3">
                                    <Text size="2" className="text-neutral-500 italic">
                                        No pages yet
                                    </Text>
                                </Box>
                            )}
                        </Box>
                    </Flex>
                </Box>
                <AddPage isOpen={isOpen} setIsOpen={setIsOpen} editPage={editePage} spaceId={param.id} parentId={parentId} />
            </>
        );
    }

    return (
        <Box className="w-64 h-full bg-neutral-50 border-r border-neutral-200" p="4">
            <Flex align="center" gap="2" className="bg-error-50 border border-error-200 rounded-sm p-3">
                <Text size="2" className="text-error-700">Error loading navigation</Text>
            </Flex>
        </Box>
    );
}
