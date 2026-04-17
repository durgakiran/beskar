"use client";
import { TipTap } from "@editor";
import { useGet } from "@http/hooks";
import { PageParams } from "app/space/types";
import { use, useEffect, useRef, useState } from "react";

export default function Page({ params }: { params: Promise<PageParams> }) {
    const { page, spaceId } = use(params);
    const workerRef = useRef<Worker>(null);
    const [{ isLoading, data, errors }, fetchData] = useGet<{ data: any; status: string }>(`editor/space/${spaceId}/page/${page}`);
    const [{ isLoading: loadingMeta, data: metaData, errors: metaErrors }, fetchMeta] = useGet<{ data: { type: string }; status: string }>(`editor/space/${spaceId}/page/${page}/metadata`);
    const [workerInitiated, setWorkerInitiated] = useState(false);
    const [content, setContent] = useState();

    useEffect(() => {
        workerRef.current = new Worker("/workers/editor.js", { type: "module" });
        workerRef.current.onmessage = (e) => {
            switch (e.data.type) {
                case "initiated":
                    setWorkerInitiated(true);
                    break;
                case "editorData":
                    setContent(JSON.parse(e.data.data));
                    break;
                default:
                    break;
            }
        };
        workerRef.current.onerror = (e) => {
            console.error(e);
        };
        workerRef.current.postMessage({ type: "init" });
        return () => {
            workerRef.current.terminate();
        };
    }, []);

    useEffect(() => {
        fetchMeta();
    }, [fetchMeta]);

    useEffect(() => {
        if (workerInitiated && metaData?.data?.type !== "whiteboard") {
            fetchData();
        }
    }, [fetchData, metaData?.data?.type, workerInitiated]);

    useEffect(() => {
        if (data) {
            workerRef.current.postMessage({ type: "doc", data: data.data });
        }
    }, [data]);

    useEffect(() => {
        if (errors != null) {
            console.error(errors);
        }
    }, [errors]);

    if (loadingMeta || isLoading || !workerInitiated) {
        return <div className="px-8 py-6 text-sm text-neutral-700">Loading data...</div>;
    }

    if (metaErrors || errors) {
        return <div className="px-8 py-6 text-sm text-neutral-700">Something went wrong...</div>;
    }

    if (metaData?.data?.type === "whiteboard") {
        return <div className="px-8 py-6 text-sm text-neutral-700">Whiteboards are temporarily unavailable.</div>;
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
                    user={null}
                />
            </div>
        );
    }

    return <div className="px-8 py-6 text-sm text-neutral-700">Editor</div>;
}
