import type * as Y from "yjs";
import type { RecoveryWrite, YjsRecoveryAdapter } from "./types";
import { LocalRecoveryUnavailableError } from "./types";

export class UnavailableYjsRecoveryAdapter implements YjsRecoveryAdapter {
    constructor(private readonly error: Error = new LocalRecoveryUnavailableError()) {}

    async hydrate(_doc: Y.Doc): Promise<RecoveryWrite | null> {
        return null;
    }

    async persist(_write: RecoveryWrite): Promise<void> {
        throw this.error;
    }

    async clearThrough(_write: RecoveryWrite): Promise<void> {}

    advanceDraft(_sessionKey: string, _draftId: string): void {}

    async dispose(): Promise<void> {}
}
