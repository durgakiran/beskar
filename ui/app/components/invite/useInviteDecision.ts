"use client";

import { Response, usePost } from "@http/hooks";
import { useCallback, useState } from "react";
import type { InviteDecision, InviteDecisionPayload, InviteDecisionResult } from "./types";

export function useInviteDecision() {
    const [pendingDecision, setPendingDecision] = useState<InviteDecision | null>(null);
    const [{ isLoading, data, errors, response }, postDecision] = usePost<Response<InviteDecisionResult>, InviteDecisionPayload>("invite/user/decision");

    const submitDecision = useCallback((token: string, decision: InviteDecision) => {
        setPendingDecision(decision);
        postDecision({ token, decision });
    }, [postDecision]);

    return {
        isLoading,
        data,
        errors,
        response,
        pendingDecision,
        submitDecision,
    };
}
