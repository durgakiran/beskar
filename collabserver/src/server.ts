import { Server } from "@hocuspocus/server";
import { Logger } from "@hocuspocus/extension-logger";
import { TiptapTransformer } from "@hocuspocus/transformer";
import { Document } from "@tiptap/extension-document";
import { Heading } from "@tiptap/extension-heading";
import { Paragraph } from "@tiptap/extension-paragraph";
import { Text } from "@tiptap/extension-text";
import { Bold } from "@tiptap/extension-bold";
import { BulletList } from "@tiptap/extension-bullet-list";
import { Code } from "@tiptap/extension-code";
import { Dropcursor } from "@tiptap/extension-dropcursor";
import { Gapcursor } from "@tiptap/extension-gapcursor";
import { Italic } from "@tiptap/extension-italic";
import { ListItem } from "@tiptap/extension-list-item";
import { OrderedList } from "@tiptap/extension-ordered-list";
import { Strike } from "@tiptap/extension-strike";
import { Blockquote } from "@tiptap/extension-blockquote";
import { CodeBlock } from "@tiptap/extension-code-block";
import { TextStyle } from "@tiptap/extension-text-style";
import { getDocFromDatabase, initWasm } from "./content";

const server = new Server({
    port: 1234,
    quiet: false,
    extensions: [
        new Logger({
            onLoadDocument: true,
            onConnect: true,
            onDisconnect: true,
            onDestroy: true,
            onConfigure: true,
            onChange: true,
            onRequest: true,
            onUpgrade: true,
            onStoreDocument: true,
        })
    ],
    async beforeSync({ payload, document, documentName, type }) {
        console.log(`Server will handle a sync message: "${payload}"!`)
    },
    async onLoadDocument(data) {
        // get data from database
        const doc = await getDocFromDatabase(data.documentName, data.requestHeaders);
        const ydoc = TiptapTransformer.toYdoc(
            doc, 
            "default", 
            [
                Document, 
                Bold, 
                BulletList, 
                Code, 
                Dropcursor, 
                Gapcursor, 
                Italic, 
                ListItem,
                OrderedList,
                Strike,
                Paragraph,
                Blockquote,
                Text,
                Heading,
                CodeBlock,
                TextStyle
            ]
        );
        return ydoc;
    },
});

server.listen().then(() => {
    initWasm().then(() => {
        console.log("wasm initialized");
    });
});
// const server = new Hocuspocus({
//     port: 1234,
//     extensions: [
//         new Logger({
//             onLoadDocument: false,
//             onConnect: false,
//             onDisconnect: false,
//             onUpgrade: false,
//             onRequest: false,
//             onDestroy: false,
//             onConfigure: false,
//             onChange: false,
//         })
//     ],
//     async onConnect(data) {
//         console.log("connected", data.documentName);
//     },
//     async onAuthenticate(data) {
//         console.log("authenticate", data.documentName);
//     },
//     async onStoreDocument(data) {
//         console.log("store document", data.documentName);
//     },
//     async onLoadDocument(data) {
//         console.log("load document", data.documentName);
//         // Check if document exists in memory
//         if (documentMap.has(data.documentName)) {
//             return documentMap.get(data.documentName);
//         }
        
//         // Create new document if it doesn't exist
//         const doc = new Y.Doc();
//         documentMap.set(data.documentName, doc);
//         console.log(doc);
//         return doc;
//     },
//     async onChange(data) {
//         const prosemirrorJSON = TiptapTransformer.fromYdoc(data.document);
//         console.log(JSON.stringify(prosemirrorJSON));
//     },
//     async onDisconnect() {
//         console.log("disconnected");
//     },
//     async onDestroy() {
//         console.log("destroyed");
//     }
// });


// server.listen();

