'use client'
import { Button, Flex, Heading } from "@radix-ui/themes";
import { HiBookOpen } from "react-icons/hi";
import React from "react";

interface ISlate {
    title: string;
    description?: string;
    primaryActionText?: string;
    primaryAction?: () => void;
}

export default function Slate(props: ISlate) {
   
    return (
        <Flex 
            direction="column" 
            align="center" 
            justify="start" 
            style={{ height: '100vh', width: '100%', textAlign: 'center' }}
            gap="4"
            pt="9"
        >
            <HiBookOpen size="50" />
            <Heading size="6">{props.title}</Heading>
            {props.description && <div>{props.description}</div>}
            {props.primaryAction && (
                <Button size="3" onClick={props.primaryAction}>
                    {props.primaryActionText}
                </Button>
            )}
        </Flex>
    )
}
