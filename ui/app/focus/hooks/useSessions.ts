import { useGet } from "@http/hooks";
import { Session, SessionListResponse } from "../types";

interface SessionFilters {
    status?: string;
    sessionType?: string;
    limit?: number;
    offset?: number;
}

export function useSessions() {
    const [getSessionsState, fetchSessions] = useGet<{ status: string; data: SessionListResponse }>("focus/sessions");
    
    const loadSessions = (filters?: SessionFilters) => {
        const queryParams: Record<string, any> = {};
        
        if (filters?.status) queryParams.status = filters.status;
        if (filters?.sessionType) queryParams.sessionType = filters.sessionType;
        if (filters?.limit) queryParams.limit = filters.limit;
        if (filters?.offset) queryParams.offset = filters.offset;
        
        fetchSessions(Object.keys(queryParams).length > 0 ? queryParams : undefined);
    };

    return {
        sessions: getSessionsState.data?.data?.sessions || [],
        total: getSessionsState.data?.data?.total || 0,
        limit: getSessionsState.data?.data?.limit || 10,
        offset: getSessionsState.data?.data?.offset || 0,
        loading: getSessionsState.isLoading,
        error: getSessionsState.errors,
        loadSessions,
    };
} 