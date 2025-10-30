import ModifiedIcon from "@components/modifiedIcon";
import { Callout, Flex, IconButton } from "@radix-ui/themes";
import { Cross2Icon } from "@radix-ui/react-icons";
import { useState } from "react";

interface props {
    icon: string;
    type: "success" | "error" | "warning";
    toggle: boolean;
    message: string;
}

export default function ToastComponent(props: props) {
    const [visible, setVisible] = useState(true);

    if (!visible) return null;

    const colorMap = {
        success: "green",
        error: "red",
        warning: "orange"
    } as const;

    return (
        <div className="fixed bottom-5 right-5 z-50">
            <Callout.Root color={colorMap[props.type]} style={{ minWidth: '300px' }}>
                <Flex align="center" gap="2">
                    <Callout.Icon>
                        <ModifiedIcon name={props.icon} size={16} />
                    </Callout.Icon>
                    <Callout.Text style={{ flex: 1 }}>
                        {props.message}
                    </Callout.Text>
                    {props.toggle && (
                        <IconButton 
                            size="1" 
                            variant="ghost" 
                            color="gray"
                            onClick={() => setVisible(false)}
                        >
                            <Cross2Icon />
                        </IconButton>
                    )}
                </Flex>
            </Callout.Root>
        </div>
    );
}
