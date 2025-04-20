import { HocuspocusProvider } from "@hocuspocus/provider";
import { useMemo } from "react";
import * as Y from "yjs";

export default function useCollaboration(document: string): HocuspocusProvider {
    const yDoc = useMemo(() => {
        return new Y.Doc()
    }, []);

    const provider = useMemo(() => {
        return new HocuspocusProvider({
            document: yDoc,
            url: "ws://app.tededox.com:1234",
            name: document,
        })
    }, [yDoc]);

    return provider;
}
