import { usePost } from "@http/hooks";
import { Session, CreateSessionRequest } from "../types";
import { useFocusContext } from "../../core/context/FocusContext";
import { useEffect } from "react";

export function useCreateSession() {
    const [createSessionState, createSession] = usePost<{ status: string; data: Session }, CreateSessionRequest>("focus/sessions");
    const { setCurrentSession } = useFocusContext();
    
    const startSession = (sessionData: CreateSessionRequest) => {
        createSession(sessionData);
    };

    // Update context when session is created
    useEffect(() => {
        if (createSessionState.data?.data) {
            setCurrentSession(createSessionState.data.data);
        }
    }, [createSessionState.data, setCurrentSession]);

    return {
        session: createSessionState.data?.data,
        loading: createSessionState.isLoading,
        error: createSessionState.errors,
        startSession,
    };
} 