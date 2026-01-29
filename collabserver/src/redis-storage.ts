import Redis from 'ioredis';
import * as Y from 'yjs';

export class RedisStorage {
    private redis: Redis;
    private readonly DOCUMENT_PREFIX = 'doc:';

    constructor(port: number, host: string, password: string) {
        this.redis = new Redis(
            {
                port: port,
                host: host,
                password: password
            }
        );
    }

    async storeDocument(documentName: string, ydoc: Y.Doc): Promise<void> {
        const documentKey = `${this.DOCUMENT_PREFIX}${documentName}`;
        
        // Get the current document state
        const update = Y.encodeStateAsUpdate(ydoc);
        
        // Store the document state
        await this.redis.set(documentKey, Buffer.from(update).toString('base64'));
    }

    async loadDocument(documentName: string): Promise<Y.Doc> {
        const documentKey = `${this.DOCUMENT_PREFIX}${documentName}`;
        
        // Get the stored document data
        const storedData = await this.redis.get(documentKey);
        
        if (!storedData) {
            // Return a new document if none exists
            return new Y.Doc();
        }

        // Create a new document
        const doc = new Y.Doc();
        
        // Apply the stored update
        const update = Buffer.from(storedData, 'base64');
        Y.applyUpdate(doc, update);

        return doc;
    }

    async deleteDocument(documentName: string): Promise<void> {
        const documentKey = `${this.DOCUMENT_PREFIX}${documentName}`;
        await this.redis.del(documentKey);
    }

    async close(): Promise<void> {
        await this.redis.quit();
    }
} 