"use client";
import { TipTap } from "@editor";
import { useGet } from "@http/hooks";
import { PageParams } from "app/space/types";
import { useEffect, useRef, useState } from "react";

export default function Page({ params }: { params: PageParams }) {
    const workerRef = useRef<Worker>();
    const [{ isLoading, data, errors }, fetchData] = useGet<{ data: any; status: string }>(`editor/space/${params.spaceId}/page/${params.page}`);
    const [workerInitiated, setWorkerInitiated] = useState(false);
    const [content, setContent] = useState();

    useEffect(() => {
        workerRef.current = new Worker("/workers/editor.js", { type: "module" });
        workerRef.current.onmessage = (e) => {
            console.log(e);
            switch (e.data.type) {
                case "initiated":
                    setWorkerInitiated(true);
                    break;
                case "editorData":
                    console.log(JSON.parse(e.data.data));
                    setContent(JSON.parse(e.data.data));
                    break;
                default:
                    break;
            }
        };
        workerRef.current.onerror = (e) => {
            console.log(e);
        };
        workerRef.current.postMessage({ type: "init" });
        return () => {
            workerRef.current.terminate();
        };
    }, []);

    useEffect(() => {
        if (workerInitiated) {
            fetchData();
        }
    }, [workerInitiated]);

    useEffect(() => {
        if (data) {
            console.log(data);
            workerRef.current.postMessage({ type: "doc", data: data.data });
        }
    }, [data]);

    useEffect(() => {
        if (errors != null) {
            console.error(errors);
        }
    }, [errors]);

    if (isLoading || !workerInitiated) {
        return <div>Loading data .... </div>;
    }

    if (errors) {
        return <div>something went wrong ... </div>;
    }

    if (data) {
        return (
            <div>
                <TipTap
                    content={content}
                    title={""}
                    pageId="14"
                    id={14}
                    editable={false}
                    updateContent={(content, title) => console.log(content, title)}
                    setEditorContext={() => {}}
                />
            </div>
        );
    }

    return <div>Editor</div>;
}
