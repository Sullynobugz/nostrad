import { useState } from "react";
import { api } from "../lib/api";

interface Props {
  onRefresh: () => void;
}

export function ActionBar({ onRefresh }: Props) {
  const [loading, setLoading] = useState<string | null>(null);
  const [result, setResult] = useState<string | null>(null);
  const [showResetConfirm, setShowResetConfirm] = useState(false);

  async function run(label: string, action: () => Promise<any>) {
    setLoading(label);
    setResult(null);
    try {
      const res = await action();
      const summary = res.executed != null
        ? `${res.executed} trades eröffnet, ${res.skipped} übersprungen`
        : res.trades_executed != null
        ? `${res.signals_created ?? 0} signals, ${res.trades_executed} eröffnet, ${res.trades_closed ?? 0} geschlossen`
        : res.closed != null
        ? `${res.closed} trades geschlossen`
        : res.inserted != null
        ? `${res.inserted} events, ${res.signals_generated ?? 0} signals`
        : res.steps
        ? res.steps.slice(-1)[0]
        : "OK";
      setResult(`✓ ${label}: ${summary}`);
      onRefresh();
    } catch (err) {
      setResult(`✗ Fehler: ${(err as Error).message}`);
    } finally {
      setLoading(null);
    }
  }

  async function handleReset() {
    setShowResetConfirm(false);
    await run("Reset", () => api.resetPortfolio());
  }

  const actions = [
    { label: "Kronos Scan", action: () => api.kronosScan(), highlight: true },
    { label: "Execute Signals", action: () => api.executeSignals(), highlight: false },
    { label: "Close Expired", action: () => api.closeExpired(), highlight: false },
    { label: "Ingest + Queue", action: async () => {
        await api.runIngest();
        return api.processSignalQueue();
      }, highlight: false },
  ] as const;

  return (
    <>
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
                : a.highlight
                ? "border-terminal-blue/60 text-terminal-blue hover:bg-terminal-blue/10"
                : "border-terminal-border text-terminal-muted hover:border-terminal-blue/50 hover:text-terminal-blue hover:bg-terminal-blue/5"
            }`}
          >
            {loading === a.label ? "Running..." : a.label}
          </button>
        ))}

        <div className="w-px h-4 bg-terminal-border mx-1" />

        <button
          onClick={() => setShowResetConfirm(true)}
          disabled={loading !== null}
          className="text-[10px] font-mono uppercase tracking-wider px-3 py-1.5 rounded border border-terminal-red/40 text-terminal-red/70 hover:border-terminal-red hover:text-terminal-red hover:bg-terminal-red/5 transition-colors disabled:opacity-40"
        >
          Reset
        </button>

        {result && (
          <span
            className={`text-[10px] font-mono ml-auto max-w-sm truncate ${
              result.startsWith("✓") ? "text-terminal-green" : "text-terminal-red"
            }`}
          >
            {result}
          </span>
        )}
      </div>

      {showResetConfirm && (
        <div className="fixed inset-0 bg-black/70 flex items-center justify-center z-50">
          <div className="bg-terminal-card border border-terminal-red/50 rounded-lg p-6 w-80 shadow-2xl">
            <div className="text-[10px] uppercase tracking-widest text-terminal-red mb-3">Achtung</div>
            <p className="text-sm text-terminal-text mb-2 font-semibold">Kompletter Reset</p>
            <p className="text-xs text-terminal-muted leading-5 mb-5">
              Alle Trades, Signale und Events werden gelöscht.
              Das Portfolio wird auf <span className="text-terminal-text font-semibold">1.000€</span> zurückgesetzt.
              Diese Aktion kann nicht rückgängig gemacht werden.
            </p>
            <div className="flex gap-3">
              <button
                onClick={() => setShowResetConfirm(false)}
                className="flex-1 text-[11px] font-mono uppercase tracking-wider px-3 py-2 rounded border border-terminal-border text-terminal-muted hover:text-terminal-text transition-colors"
              >
                Abbrechen
              </button>
              <button
                onClick={handleReset}
                className="flex-1 text-[11px] font-mono uppercase tracking-wider px-3 py-2 rounded border border-terminal-red text-terminal-red hover:bg-terminal-red/10 transition-colors"
              >
                Ja, Reset
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
