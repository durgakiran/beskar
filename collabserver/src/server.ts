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
import { RedisStorage } from "./redis-storage";
import * as Y from "yjs";

// Initialize Redis storage
const redisStorage = new RedisStorage(`redis://${process.env.REDIS_HOST}:${process.env.REDIS_PORT}?password=${process.env.REDIS_PASSWORD}`);

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
    async onStoreDocument(data) {
        console.log("Storing document:", data.documentName);
        await redisStorage.storeDocument(data.documentName, data.document);
    },
    async onLoadDocument(data) {
        console.log("Loading document:", data.documentName);
        
        // First try to load from Redis
        const redisDoc = await redisStorage.loadDocument(data.documentName);
        
        // Check if document exists in Redis by looking for title
        const hasTitle = redisDoc.getText('title').length > 0;
        
        // If document exists in Redis, use it
        if (hasTitle) {
            console.log("Document found in Redis");
            return redisDoc;
        }
        
        // If not in Redis, load from database
        console.log("Document not found in Redis, loading from database");
        const [doc, title] = await getDocFromDatabase(data.documentName, data.requestHeaders);
        
        // Convert database document to Y.Doc
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
        
        // Create title Y doc and merge it
        const titleYdoc = new Y.Doc();
        console.log("Title of the document: ", title);
        titleYdoc.getText('title').insert(0, title || '');
        Y.applyUpdate(ydoc, Y.encodeStateAsUpdate(titleYdoc));
        
        // Store the loaded document in Redis for future use
        await redisStorage.storeDocument(data.documentName, ydoc);
        
        return ydoc;
    },
});

server.listen().then(() => {
    initWasm().then(() => {
        console.log("WASM initialized");
    });
});

// Handle cleanup on process termination
process.on('SIGTERM', async () => {
    console.log('SIGTERM received. Cleaning up...');
    await redisStorage.close();
    process.exit(0);
});

process.on('SIGINT', async () => {
    console.log('SIGINT received. Cleaning up...');
    await redisStorage.close();
    process.exit(0);
});

