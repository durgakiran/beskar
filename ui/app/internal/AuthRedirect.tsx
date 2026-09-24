import { Navigate } from "react-router-dom";
import { useState } from "react";
import { consumeInviteReturn } from "../components/invite/inviteReturn";
export default function AuthRedirect() {
    const [destination] = useState(() => consumeInviteReturn() || "/space");
    return <Navigate to={destination} replace />;
}
