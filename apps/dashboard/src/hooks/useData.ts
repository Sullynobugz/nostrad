import { useState, useEffect, useCallback } from "react";
import { api } from "../lib/api";

export function usePolling<T>(fetcher: () => Promise<T>, intervalMs = 30000) {
  const [data, setData] = useState<T | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetchData = useCallback(async () => {
    try {
      const result = await fetcher();
      setData(result);
      setError(null);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchData();
    const interval = setInterval(fetchData, intervalMs);
    return () => clearInterval(interval);
  }, [fetchData, intervalMs]);

  return { data, loading, error, refetch: fetchData };
}

export function useDashboard() {
  const portfolio = usePolling(() => api.portfolio(), 15000);
  const openTrades = usePolling(() => api.openTrades(), 15000);
  const signals = usePolling(() => api.signals(30), 20000);
  const history = usePolling(() => api.tradeHistory(50), 30000);
  const snapshots = usePolling(() => api.snapshots(30), 60000);

  return { portfolio, openTrades, signals, history, snapshots };
}
