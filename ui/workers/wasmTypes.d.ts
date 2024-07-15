declare global {
    export interface DedicatedWorkerGlobalScope {
        Go: any,
        run: (data: string) => any,
        Add: (a: number, b: number) => number,
    }
}

export {};
