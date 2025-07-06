import { useCallback, useMemo, useState } from "react";
import { AudioService } from "../media/audio";

export function useVoiceAssistant() {
    const audioService = useMemo(() => new AudioService(), []);
    const [enabled, setEnabled] = useState(true);

    const playSessionStart = useCallback((delay: number = 0) => {
        if (!enabled) return;
        const messageIndex = Math.floor(Math.random() * 4);
        audioService.playMessage("session-start", messageIndex, delay);
    }, [enabled, audioService]);

    const playMidSession = useCallback((delay: number = 0) => {
        if (!enabled) return;
        const messageIndex = Math.floor(Math.random() * 4);
        audioService.playMessage("mid-session", messageIndex, delay);
    }, [enabled, audioService]);

    const playSessionComplete = useCallback((delay: number = 0) => {
        if (!enabled) return;
        const messageIndex = Math.floor(Math.random() * 4);
        audioService.playMessage("completion", messageIndex, delay);
    }, [enabled, audioService]);

    const setMinDelay = useCallback((delayMs: number) => {
        audioService.setMinDelay(delayMs);
    }, [audioService]);

    return {
        playSessionStart,
        playMidSession,
        playSessionComplete,
        setMinDelay,
        enabled,
        setEnabled
    };
}
