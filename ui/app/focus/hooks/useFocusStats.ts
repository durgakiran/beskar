import { useEffect } from "react";
import { useGet } from "../../core/http/hooks";
import { useFocusContext } from "../../core/context/FocusContext";
import { FocusStats } from "../types";

export function useFocusStats() {
    const { setStats } = useFocusContext();

    // GET stats
    const [getStatsState, fetchStats] = useGet<{ status: string; data: FocusStats }>("focus/statistics");

    // Handle stats data
    useEffect(() => {
        if (getStatsState.data && getStatsState.data.data) {
            setStats(getStatsState.data.data);
        }
    }, [getStatsState.data, setStats]);

    // Load stats
    const loadStats = () => {
        fetchStats();
    };

    return {
        loadStats,
        loading: getStatsState.isLoading,
        error: getStatsState.errors,
    };
}
