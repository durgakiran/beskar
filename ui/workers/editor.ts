import "./wasm_exec.js"

let initialised = false;

self.onmessage = (e) => {
    switch (e.data.type) {
        case 'init':
            loadWasm().then(() => {
                console.log("wasm loaded");
                self.postMessage({ type: "initiated" })
            });
            break;
        case 'data':
            if (initialised) {
                Run(JSON.stringify(e.data.data)).then((output) => {
                    console.log(output)
                });
            }
            break;
        case 'doc':
            if (initialised) {
                GetEditorDoc(JSON.stringify(e.data.data)).then((output) => {
                    self.postMessage({ type: "editorData", data: output })
                });
            }
            break;
        default:
            break;
    }
}

async function loadWasm(): Promise<void> {
    const goWasm = new globalThis.Go();
    const result = await WebAssembly.instantiateStreaming(fetch("/jbi.wasm"), goWasm.importObject);
    goWasm.run(result.instance);
    initialised = true;
}

async function Run(data: string) {
    return new Promise((resolve) => {
        const output = globalThis.run(data);
        resolve(output);
    })
}

async function GetEditorDoc(data: string) {
    return new Promise((resolve) => {
        const output = globalThis.getDoc(data);
        resolve(output)
    })
}

