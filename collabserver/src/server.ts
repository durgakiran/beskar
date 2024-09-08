import * as Y from "yjs";
import { Hocuspocus } from "@hocuspocus/server";
import { Logger } from "@hocuspocus/extension-logger";
import { TiptapTransformer } from "@hocuspocus/transformer";




const server = new Hocuspocus({
    port: 1234,
    extensions: [
        new Logger({
            onLoadDocument: false,
            onConnect: false,
            onDisconnect: false,
            onUpgrade: false,
            onRequest: false,
            onDestroy: false,
            onConfigure: false,
            onChange: true,
        })
    ],
    async onChange(data) {
        const prosemirrorJSON = TiptapTransformer.fromYdoc(data.document);
        console.log(JSON.stringify(prosemirrorJSON));
    },
});


server.listen();

