import { useQuery } from "@apollo/client";
import { client } from "@http";
import { Box, Heading, IconButton, NavList, Spinner } from "@primer/react";
import { GRAPHQL_GET_PAGES } from "@queries/space";
import { useEffect } from "react"
import { HomeIcon, GearIcon, PlusIcon } from '@primer/octicons-react';


export default function SideNav({ id }: { id: string }) {
    const { data, loading, error, refetch } = useQuery(GRAPHQL_GET_PAGES, { client: client, variables: { id } });
    useEffect(() => {

    }, [id]);

    if (loading) {
        return <Spinner size="small" />;
    }

    if (data) {
        return (
            <>
                <NavList aria-aria-labelledby="workflows-heading" >
                    <Heading as="h3" id="workflows-heading" sx={{fontSize: 2}}>
                        {data.core_space_url[0].space.name.toUpperCase()}
                    </Heading>
                    <Box sx={{pt: 2, pb: 4}}>
                        <NavList.Item  href={`/space/${id}`} aria-current="page">
                            <NavList.LeadingVisual>
                                <HomeIcon />
                            </NavList.LeadingVisual>
                            overview
                        </NavList.Item>
                        <NavList.Item href={`/space/${id}/settings`}>
                            <NavList.LeadingVisual>
                                <GearIcon />
                            </NavList.LeadingVisual>
                            settings
                        </NavList.Item>
                    </Box>
                    <Heading as="h3" id="content-heading" sx={{fontSize: 1}}>
                        Content
                    </Heading>
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
