import { HocuspocusProvider } from "@hocuspocus/provider";
import { useMemo } from "react";
import * as Y from "yjs";
import { getCollaborationUrl } from "app/core/signaling";

export default function useCollaboration(document: string): HocuspocusProvider {
    const yDoc = useMemo(() => {
        return new Y.Doc()
    }, []);

    const provider = useMemo(() => {
        return new HocuspocusProvider({
            document: yDoc,
            url: getCollaborationUrl(),
            name: document,
        })
    }, [yDoc]);

    return provider;
}
