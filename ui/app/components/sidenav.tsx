'use client'
import { useMutation, useQuery } from "@apollo/client";
import { client } from "@http";
import { ActionList, ActionMenu, Box, Heading, IconButton, NavList, Spinner } from "@primer/react";
import { GRAPHQL_DELETE_PAGE, GRAPHQL_GET_PAGES } from "@queries/space";
import { HomeIcon, GearIcon, PlusIcon, KebabHorizontalIcon, TrashIcon, PencilIcon } from '@primer/octicons-react';
import { useCallback, useEffect, useState } from "react";
import { useRouter, useSelectedLayoutSegment } from "next/navigation";
import AddPage from "./addPage";


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
    const [isOpen, setIsOpen] = useState(false);
    const router = useRouter();
    const { data, loading, error, refetch } = useQuery<SpaceData>(GRAPHQL_GET_PAGES, { client: client(), variables: { id: param.id } });
    const [mutateFunction] = useMutation(GRAPHQL_DELETE_PAGE, { client: client()} )
    const pathName = useSelectedLayoutSegment();


    const activeItem = useCallback((path: string) => {
        if (pathName === path) {
            return 'true';
        }

        return 'false'
    }, [pathName]);

    const deletePage = async (page: number) => {
        await mutateFunction({ variables: { pgId: page } });
        refetch();
        router.push(`/space/${param.id}`);
    };

    const editePage = async (page: number) => {
        router.push(`/edit/${page}`);
    };


    if (loading) {
        return <Spinner size="small" />;
    }

    
    if (data) {
        return (
            <>
                <Heading as="h2" id="workflows-heading" sx={{fontSize: 2}}>
                    {data.core_space_url[0].space.name.toUpperCase()}
                </Heading>
                <NavList aria-labelledby="workflows-heading" >
                    <Box sx={{pt: 2, pb: 4}}>
                        <NavList.Item  href={`/space/${param.id}`} aria-current={activeItem(null)}>
                            <NavList.LeadingVisual>
                                <HomeIcon />
                            </NavList.LeadingVisual>
                            overview
                        </NavList.Item>
                        <NavList.Item href={`/space/${param.id}/settings`} aria-current={activeItem('settings')}>
                            <NavList.LeadingVisual>
                                <GearIcon />
                            </NavList.LeadingVisual>
                            settings
                        </NavList.Item>
                    </Box>
                    <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', boxSizing: 'border-box', marginRight: '8px', paddingRight: '8px' }} >
                        <Heading as="h3" id="content-heading" sx={{fontSize: 1}}>
                            Content
                        </Heading>
                        <IconButton onClick={() => setIsOpen(true)} variant="invisible"  aria-label="Add a page" size="small" icon={PlusIcon} />
                    </Box>
                    <NavList.Divider></NavList.Divider>
                    <Box sx={{pt: 2, pb: 4}}>
                        {
                            data.core_space_url[0].space.pages.map((value, i) => {
                                if (value.docs[0]) {
                                    return (
                                        <NavList.Item as="a" role="link" sx={{lineHeight: '24px'}} key={i} href={`/space/${param.id}/view/${value.id}`}>
                                            {value.docs[0].title}
                                            <NavList.TrailingVisual>
                                                <Box as="div" onClick={(ev) => {ev.stopPropagation(); ev.preventDefault();}} sx={{ display: 'flex', alignItems: 'center', zIndex: 100 }}>
                                                    <ActionMenu>
                                                        <ActionMenu.Button variant="invisible" size="small" icon={KebabHorizontalIcon}>
                                                            <></>
                                                        </ActionMenu.Button>
                                                        <ActionMenu.Overlay sx={{paddingTop: '1rem', paddingBottom: '1rem'}} width="small">
                                                            <ActionList.Item onClick={() => editePage(value.id)}>
                                                                Edit
                                                                <ActionList.TrailingVisual><PencilIcon /></ActionList.TrailingVisual>
                                                            </ActionList.Item>
                                                            <ActionList.Item onClick={() => deletePage(value.id)} variant="danger">
                                                                Delete
                                                                <ActionList.TrailingVisual><TrashIcon /></ActionList.TrailingVisual>
                                                            </ActionList.Item>
                                                        </ActionMenu.Overlay>
                                                    </ActionMenu>
                                                    <IconButton variant="invisible" size="small" icon={PlusIcon} aria-label="add child page" />
                                                </Box>
                                            </NavList.TrailingVisual>
                                        </NavList.Item>
                                    )
                                }
                            })
                        }
                    </Box>
                </NavList>
                <AddPage isOpen={isOpen} setIsOpen={setIsOpen} spaceId={data.core_space_url[0].space.id} />
            </>
        );
    }

    return (
        <>error</>
    )
}
