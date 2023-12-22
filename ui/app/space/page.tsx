'use client'
import { BaseStyles, Button, ThemeProvider } from "@primer/react";
import styled from 'styled-components';

const Container = styled.div`
    text-align: center;
`;

const CenteredButton = styled(Button)`
    margin: auto;
`;

export default function Page() {
    return (
        <ThemeProvider>
            <BaseStyles>
                <Container>
                    <h1>Create Spaces</h1>
                    <CenteredButton>+ Space</CenteredButton>
                </Container>
            </BaseStyles>
        </ThemeProvider>
    )
}
