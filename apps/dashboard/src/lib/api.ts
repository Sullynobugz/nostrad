const BASE = "/api";

async function get<T>(path: string): Promise<T> {
  const res = await fetch(`${BASE}${path}`);
  if (!res.ok) throw new Error(`API ${path}: ${res.status}`);
  return res.json();
}

async function post<T>(path: string, body?: unknown): Promise<T> {
  const res = await fetch(`${BASE}${path}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: body ? JSON.stringify(body) : undefined,
  });
  if (!res.ok) throw new Error(`API ${path}: ${res.status}`);
  return res.json();
}

async function getText(path: string): Promise<string> {
  const res = await fetch(`${BASE}${path}`);
  if (!res.ok) throw new Error(`API ${path}: ${res.status}`);
  return res.text();
}

export const api = {
  portfolio: () => get<any>("/trades/portfolio"),
  openTrades: () => get<any[]>("/trades/open"),
  tradeHistory: (limit = 50) => get<any[]>(`/trades/history?limit=${limit}`),
  tradePerformance: () => get<any>("/trades/performance"),
  signals: (limit = 30) => get<any[]>(`/signals/latest?limit=${limit}`),
  snapshots: (limit = 30) => get<any[]>(`/reports/snapshots?limit=${limit}`),
  dailyReport: () => get<any>("/reports/daily"),
  dailyReportMarkdown: () => getText("/reports/daily/markdown"),
  enginePerformance: () => get<any[]>("/reports/performance"),
  runIngest: () => post<any>("/ingest/run"),
  processSignalQueue: () => post<any>("/signals/process-queue"),
  executeSignals: () => post<any>("/trades/execute"),
  demoExecuteSignals: (limit = 3) => post<any>("/trades/demo-execute", { limit }),
  closeExpired: () => post<any>("/trades/close-expired"),
  generateSignal: (asset: string) => post<any>("/signals/generate", { asset }),
  kronosScan: (assets?: string[]) => post<any>("/signals/kronos-scan", assets ? { assets } : {}),
  politicalScan: () => post<any>("/political/scan"),
  resetPortfolio: () => post<any>("/trades/reset"),
};
