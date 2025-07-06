import { usePUT } from "@http/hooks";
import { Session, EndSessionRequest } from "../types";

export function useEndSession() {
    const [endSessionState, endSession] = usePUT<{ status: string; data: Session }, EndSessionRequest>("focus/sessions");
    
    const finishSession = (sessionId: string, endData: EndSessionRequest) => {
        endSession(endData, `focus/sessions/${sessionId}/end`);
    };

    return {
        session: endSessionState.data?.data,
        loading: endSessionState.isLoading,
        error: endSessionState.errors,
        finishSession,
    };
} 