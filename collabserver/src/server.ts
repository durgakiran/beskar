import { Server } from "@hocuspocus/server";
import { Logger } from "@hocuspocus/extension-logger";
import { TiptapTransformer } from "@hocuspocus/transformer";
import { getDocFromDatabase, initWasm } from "./content";
import { RedisStorage } from "./redis-storage";
import { extensions } from "./extensions";
import * as Y from "yjs";

// Initialize Redis storage
const redisStorage = new RedisStorage(parseInt(process.env.REDIS_PORT || '6379'), process.env.REDIS_HOST || 'localhost', process.env.REDIS_PASSWORD || '');

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
        const [doc, title, docId, parentId] = await getDocFromDatabase(data.documentName, data.requestHeaders);

        let ydoc = new Y.Doc();
        console.log("doc", doc);
        // if doc is null, initialize a new doc
        if (doc === null) {
            // do nothing
            // Create title Y doc and merge it
            const titleYdoc = new Y.Doc();
            console.log("Title of the document: ", title);
            titleYdoc.getText('title').insert(0, title || '');
            Y.applyUpdate(ydoc, Y.encodeStateAsUpdate(titleYdoc));
            
            const metadata = new Y.Doc();
            metadata.getText('docId').insert(0, docId.toString());
            metadata.getText('parentId').insert(0, parentId.toString());
            Y.applyUpdate(ydoc, Y.encodeStateAsUpdate(metadata)); 
        } else {
            const data = Buffer.from(doc.data, 'base64');
            Y.applyUpdate(ydoc, data);
        }
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

