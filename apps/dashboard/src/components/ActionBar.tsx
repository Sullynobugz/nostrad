import { useState } from "react";
import { api } from "../lib/api";

interface Props {
  onRefresh: () => void;
}

export function ActionBar({ onRefresh }: Props) {
  const [loading, setLoading] = useState<string | null>(null);
  const [result, setResult] = useState<string | null>(null);

  async function run(label: string, action: () => Promise<any>) {
    setLoading(label);
    setResult(null);
    try {
      const res = await action();
      setResult(`✓ ${label}: ${JSON.stringify(res).slice(0, 120)}`);
      onRefresh();
    } catch (err) {
      setResult(`✗ Fehler: ${(err as Error).message}`);
    } finally {
      setLoading(null);
    }
  }

  const actions = [
    { label: "Ingest Run", action: () => api.runIngest() },
    { label: "Process Queue", action: () => api.processSignalQueue() },
    { label: "Demo Trades", action: () => api.demoExecuteSignals(3) },
    { label: "Execute Signals", action: () => api.executeSignals() },
    { label: "Close Expired", action: () => api.closeExpired() },
  ];

  return (
    <div className="bg-terminal-card border border-terminal-border rounded-lg px-4 py-3 flex flex-wrap items-center gap-3">
      <span className="text-[10px] uppercase tracking-widest text-terminal-muted mr-2">Actions</span>
      {actions.map((a) => (
        <button
          key={a.label}
          onClick={() => run(a.label, a.action)}
          disabled={loading !== null}
          className={`text-[10px] font-mono uppercase tracking-wider px-3 py-1.5 rounded border transition-colors ${
            loading === a.label
              ? "border-terminal-yellow/50 text-terminal-yellow bg-terminal-yellow/10"
              : "border-terminal-border text-terminal-muted hover:border-terminal-blue/50 hover:text-terminal-blue hover:bg-terminal-blue/5"
          }`}
        >
          {loading === a.label ? "Running..." : a.label}
        </button>
      ))}
      {result && (
        <span className={`text-[10px] font-mono ml-auto ${result.startsWith("✓") ? "text-terminal-green" : "text-terminal-red"}`}>
          {result}
        </span>
      )}
    </div>
  );
}
