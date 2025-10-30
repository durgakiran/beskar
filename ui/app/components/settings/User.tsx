import { Avatar, Flex, Text, Box } from "@radix-ui/themes";

type Props = {
    name: string;
    role: string;
    id: string;
};

export default function User(p: Props) {
    return (
        <Flex align="center" gap="3">
            <Avatar 
                size="3" 
                fallback={p.name.charAt(0).toUpperCase()} 
                radius="full"
            />
            <Box>
                <Text weight="medium" as="div">{p.name}</Text>
                <Text size="2" color="gray" as="div">Joined in August 2014</Text>
            </Box>
        </Flex>
    );
}
