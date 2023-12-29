import { Box, Heading, Text } from "@primer/react";
import styled from 'styled-components';


interface ISpaceBox {
    name: string;
}

export default function SpaceBox({ name }: ISpaceBox) {
    return (
        <Box sx={{ borderWidth: 0.5, margin: 1, borderStyle: 'solid', borderColor: 'border.muted', paddingLeft: 2, paddingRight: 2, boxSizing: 'border-box' }}>
            <Text as="h4">{name}</Text>
            <Text as="p">
                Some space description...
            </Text>
        </Box>
    )
}
