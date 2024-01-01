import { useQuery } from "@apollo/client";
import { client } from "@http";
import { Box, Heading, IconButton, NavList, Spinner } from "@primer/react";
import { GRAPHQL_GET_PAGES } from "@queries/space";
import { HomeIcon, GearIcon, PlusIcon } from '@primer/octicons-react';
import { useCallback } from "react";
import { useSelectedLayoutSegment } from "next/navigation";


interface Props {
    id: string;
}

export default function SideNav(param: Props) {
    const { data, loading, error, refetch } = useQuery(GRAPHQL_GET_PAGES, { client: client, variables: { id: param.id } });
    const pathName = useSelectedLayoutSegment();

    const activeItem = useCallback((path: string) => {
        if (pathName === path) {
            return 'true';
        }

        return 'false'
    }, [pathName]);

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
                    <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }} >
                        <Heading as="h3" id="content-heading" sx={{fontSize: 1}}>
                            Content
                        </Heading>
                        <IconButton variant="invisible"  aria-label="Add a page" size="small" icon={PlusIcon} />
                    </Box>
                    <NavList.Divider></NavList.Divider>
                    <Box sx={{pt: 2, pb: 4}}>

                    </Box>
                </NavList>
            </>
        );
    }

    return (
        <>error</>
    )
}
