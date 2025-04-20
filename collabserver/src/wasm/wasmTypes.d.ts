interface Go {
    new(): any;
}
declare global {
    interface globalThis {
        Go: Go;
    }
}

export {};
