"use client";

import { HocuspocusProviderWebsocket } from "@hocuspocus/provider";
import { createContext } from "react";
import { WebSocket } from "ws";

const socket = new HocuspocusProviderWebsocket({
    url: "ws://app.tededox.com:1234",
    WebSocketPolyfill: WebSocket,
});

export const SocketContext = createContext<HocuspocusProviderWebsocket | null>(socket);
