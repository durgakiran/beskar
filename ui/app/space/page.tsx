"use client";
import { Box, Button, Link, Spinner } from "@primer/react";
import { Column, DataTable, Table } from "@primer/react/drafts";
import { useEffect, useState } from "react";
import { client } from "@http";
import styled from "styled-components";
import { useQuery } from "@apollo/client";
import { GRAPHQL_GET_SPACES } from "@queries/space";
import AddSpace from "@components/addSpace";
import Slate from "@components/slate";
import { useRouter } from "next/navigation";


const Container = styled.div`
    padding: 16px;
`;

const CenteredButton = styled(Button)`
    margin: auto;
`;

const Footer = styled.div`
    display: flex;
    flex-direction: row;
    flex-wrap: wrap;
    align-content: center;
    justify-content: flex-end;
    align-items: center;
    box-sizing: border-box;
    margin-top: 1rem;
`;

interface Data {
    name: string;
    id: string;
    slug: string;
}

const columns: Array<Column<Data>> = [
    {
        header: "Space Name",
        field: "name",
        rowHeader: true,
        renderCell: (row) => <Link href={`/space/${row.slug}`}>{row.name}</Link>,
    },
];

const BLANK_STATE_HEADING = "No Spaces, Please create one";
const BLANK_STATE_BTN_TEXT = "Create a space";

export default function Page() {
    const router = useRouter();
    const [isOpen, setIsOpen] = useState(false);
    const [tableData, setTableData] = useState([]);
    const { loading, error, data, refetch } = useQuery(GRAPHQL_GET_SPACES, { client: client });

    useEffect(() => {
        if (data && data.core_space) {
            console.log(data.core_space);
            const newData = data.core_space.map((datum, i) => {
                return { id: datum.id, slug: datum.space_urls[0].id ?? "#", name: datum.name };
            });
            console.log(newData);
            setTableData(newData);
        }
    }, [data]);

    useEffect(() => {
        if (error && error.message.includes("JWTExpired")) {
            router.push("/");
        }
    }, [error]);

    return (
        <Container>
            {loading ? (
                <Box sx={{ textAlign: "center" }}>
                    <Spinner size="large" />
                </Box>
            ) : !loading && tableData.length === 0 ? (
                <Slate title={BLANK_STATE_HEADING} primaryActionText={BLANK_STATE_BTN_TEXT} primaryAction={() => setIsOpen(true)} />
            ) : (
                <Table.Container>
                    <Table.Title as="h2" id="spaces">
                        All Spaces
                    </Table.Title>
                    <Table.Subtitle as="p" id="space-subtitle">
                        Organize your content across spaces
                    </Table.Subtitle>
                    <Table.Actions>
                        <Button
                            size="small"
                            onClick={() => {
                                setIsOpen(true);
                            }}
                        >
                            + Space
                        </Button>
                    </Table.Actions>
                    <DataTable aria-labelledby="spaces" aria-describedby="space-subtitle" data={tableData} columns={columns} />
                </Table.Container>
            )}
            <AddSpace
                isOpen={isOpen}
                setIsOpen={(open: boolean) => {
                    setIsOpen(open);
                    refetch();
                }}
            />
        </Container>
    );
}
