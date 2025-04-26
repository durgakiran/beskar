import "./wasm/wasm_exec.js";

export async function getDocFromDatabase(docName: string, requestHeaders: any): Promise<[any, string, number, number]> {
    console.log(typeof requestHeaders);
    // fetch doc from service using edit api
    try {

        const [pageId, spaceId] = docName.split("-space-");
        const response = await fetch(`http://tededox-server:9095/api/v1/editor/space/${spaceId}/page/${pageId}/edit`, {
            headers: {
                "cookie": requestHeaders["cookie"],
                "Content-Type": "application/json",
                "Accept": "application/json",
            }
        });
        const res = await response.json();
        const { title, docId, parentId} = res.data;
        if (res.data.draft) {
            const eData = typeof res.data.data.data === "string" ? JSON.parse(res.data.data.data) : res.data.data.data;
            return [eData, title, docId, parentId];
        } else {
            const input = { title: res.data.title, ownerId: res.data.ownerId, parentId: res.data.parentId, id: res.data.id, docId: res.data.docId, spaceId: res.data.spaceId, nodeData: res.data.nodeData };
            const data = getEditorDoc(JSON.stringify(input));
            console.log("data", data);
            return typeof data === "string" ? [JSON.parse(data), title, docId, parentId] : [data, title, docId, parentId];
        }
    } catch (error) {
        console.error(error);
        return [null, "", 0, 0];
    }
}

// Initialize WASM
let wasmInstance: any = null;

export async function initWasm() {
    try {
        const goWasm = new (globalThis as any).Go();
        const wasmPath = require('path').join(__dirname, 'wasm', 'jbi.wasm');
        const wasmBuffer = require('fs').readFileSync(wasmPath);

        const wasmModule = await WebAssembly.instantiate(wasmBuffer, goWasm.importObject);
        goWasm.run(wasmModule.instance);
        wasmInstance = wasmModule.instance;
        return true;
    } catch (error) {
        console.error('Failed to initialize WASM:', error);
        return false;
    }
}

// Example function to use WASM
export function getEditorDoc(data: string) {
    if (!wasmInstance) {
        throw new Error('WASM not initialized. Call initWasm() first.');
    }
    // Use wasmInstance.exports to access WASM functions
    // Example: wasmInstance.exports.yourFunction();
    return (globalThis as any).getDoc(data);
}

