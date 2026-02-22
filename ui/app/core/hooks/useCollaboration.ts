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
            url: "wss://app.durgakiran.com/collab",
            name: document,
        })
    }, [yDoc]);

    return provider;
}
