'use client'
import { Button } from "flowbite-react";
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
        <div style={{
            display: 'flex', 
            flexDirection: 'column', 
            justifyContent: 'flex-start', 
            alignItems: 'center', 
            height: '100vh',
            textAlign: 'center', 
            width: '100%' }}>
            <div>
                <HiBookOpen size="50" />
            </div>
            <h1>
                {props.title}
            </h1>
            { props.description && <div></div> }
            {props.primaryAction && <Button  size="md" onClick={props.primaryAction} >{props.primaryActionText}</Button> }
        </div>
    )
}
