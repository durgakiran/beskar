import { Blankslate } from "@primer/react/drafts";
import { BookIcon } from '@primer/octicons-react';
import { Button } from "@primer/react";

interface ISlate {
    title: string;
    description?: string;
    primaryActionText?: string;
    primaryAction?: () => void;
}

export default function Slate(props: ISlate) {
    return (
        <Blankslate>
            <Blankslate.Visual>
                <BookIcon size="medium" />
            </Blankslate.Visual>
            <Blankslate.Heading>
                {props.title}
            </Blankslate.Heading>
            { props.description && <Blankslate.Description></Blankslate.Description> }
            {props.primaryAction && <Button variant="primary" size="medium" onClick={props.primaryAction} >{props.primaryActionText}</Button> }
        </Blankslate>
    )
}
