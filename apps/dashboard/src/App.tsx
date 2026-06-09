import { useEffect, useState } from "react";
import { PortfolioCard } from "./components/PortfolioCard";
import { SignalFeed } from "./components/SignalFeed";
import { TradeTable } from "./components/TradeTable";
import { EnginePerformance } from "./components/EnginePerformance";
import { PriceChart } from "./components/PriceChart";
import { ActionBar } from "./components/ActionBar";
import { useDashboard } from "./hooks/useData";

type Page = "dashboard" | "signals" | "trades" | "events" | "performance" | "guide" | "glossary";

const NAV: { id: Page; label: string }[] = [
  { id: "dashboard", label: "Dashboard" },
  { id: "signals", label: "Signals" },
  { id: "trades", label: "Trades" },
  { id: "performance", label: "Engines" },
  { id: "guide", label: "How To Use" },
  { id: "glossary", label: "Glossary" },
];

export function App() {
  const [page, setPage] = useState<Page>("dashboard");
  const [chartAsset, setChartAsset] = useState("BTC");
  const [runState, setRunState] = useState<{
    label: string | null;
    startedAt: string | null;
    status: "idle" | "running" | "done" | "error";
    openedTrades?: number;
  }>({ label: null, startedAt: null, status: "idle" });
  const [tradePing, setTradePing] = useState<{ visible: boolean; count: number }>({ visible: false, count: 0 });
  const { portfolio, openTrades, signals, history } = useDashboard();

  useEffect(() => {
    if (runState.status === "done" && (runState.openedTrades || 0) > 0) {
      setTradePing({ visible: true, count: runState.openedTrades || 0 });
      const timer = window.setTimeout(() => setTradePing({ visible: false, count: 0 }), 5000);
      return () => window.clearTimeout(timer);
    }
  }, [runState]);

  function refetchAll() {
    portfolio.refetch();
    openTrades.refetch();
    signals.refetch();
    history.refetch();
  }

  return (
    <div className="min-h-screen bg-terminal-bg flex font-mono text-terminal-text">
      {/* Sidebar */}
      <aside className="w-48 border-r border-terminal-border flex flex-col bg-terminal-card shrink-0">
        <div className="px-4 py-4 border-b border-terminal-border">
          <div className="text-xs font-semibold tracking-[0.3em] text-terminal-blue">NOSTRAD</div>
          <div className="text-[9px] text-terminal-muted tracking-widest mt-0.5">RESEARCH TERMINAL</div>
        </div>
        <nav className="flex-1 py-3">
          {NAV.map((n) => (
            <button
              key={n.id}
              onClick={() => setPage(n.id)}
              className={`w-full text-left px-4 py-2 text-[11px] uppercase tracking-widest transition-colors ${
                page === n.id
                  ? "text-terminal-blue bg-terminal-blue/5 border-r-2 border-terminal-blue"
                  : "text-terminal-muted hover:text-terminal-text hover:bg-terminal-hover"
              }`}
            >
              {n.label}
            </button>
          ))}
        </nav>
        {/* Portfolio Mini-Stats in Sidebar */}
        {portfolio.data && (
          <div className="px-4 py-3 border-t border-terminal-border space-y-1.5">
            <MiniStat label="Equity" value={`${portfolio.data.total_equity?.toFixed(0)}€`} />
            <MiniStat
              label="PnL"
              value={`${portfolio.data.total_pnl >= 0 ? "+" : ""}${portfolio.data.total_pnl?.toFixed(2)}€`}
              color={portfolio.data.total_pnl >= 0 ? "text-terminal-green" : "text-terminal-red"}
            />
            <MiniStat label="Open" value={`${portfolio.data.trade_count_open} pos`} />
          </div>
        )}
        <div className="px-4 py-2 border-t border-terminal-border">
          <div className="flex items-center gap-1.5">
            <div className="w-1.5 h-1.5 rounded-full bg-terminal-green animate-pulse" />
            <span className="text-[9px] text-terminal-muted tracking-wider">LIVE</span>
          </div>
        </div>
      </aside>

      {/* Main */}
      <main className="flex-1 overflow-auto p-4 space-y-4">
        {/* Header */}
        <div className="bg-terminal-card border border-terminal-border rounded-lg px-4 py-3 flex flex-wrap items-center gap-4 justify-between">
          <div className="min-w-40">
            <h1 className="text-sm font-semibold tracking-wide text-terminal-text uppercase">
              {NAV.find((n) => n.id === page)?.label}
            </h1>
            <p className="text-[10px] text-terminal-muted">
              {new Date().toLocaleDateString("de-DE", { weekday: "long", year: "numeric", month: "long", day: "numeric" })}
            </p>
          </div>
          <RunStatus runState={runState} tradePing={tradePing} />
          <ActionBar onRefresh={refetchAll} onRunStateChange={setRunState} />
        </div>

        {/* Dashboard */}
        {page === "dashboard" && (
          <div className="grid grid-cols-1 xl:grid-cols-2 gap-4">
            <PortfolioCard portfolio={portfolio.data} />
            <PriceChart asset={chartAsset} onAssetChange={setChartAsset} trades={history.data || []} />
            <SignalFeed signals={signals.data || []} />
            <div className="space-y-4">
              <EnginePerformance signals={signals.data || []} />
              <TradeTable trades={openTrades.data || []} title="Open Positions" showOpen />
            </div>
          </div>
        )}

        {/* Signals */}
        {page === "signals" && (
          <SignalFeed signals={signals.data || []} />
        )}

        {/* Trades */}
        {page === "trades" && (
          <div className="space-y-4">
            <TradeTable trades={openTrades.data || []} title="Open Positions" showOpen />
            <TradeTable trades={(history.data || []).filter((t: any) => t.status === "closed")} title="Trade History" />
          </div>
        )}

        {/* Engine Performance */}
        {page === "performance" && (
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
            <EnginePerformance signals={signals.data || []} />
            <div className="bg-terminal-card border border-terminal-border rounded-lg p-4">
              <div className="text-[10px] uppercase tracking-widest text-terminal-muted mb-3">Signal Score Distribution</div>
              <ScoreHistogram signals={signals.data || []} />
            </div>
          </div>
        )}

        {page === "guide" && <HowToUse />}
        {page === "glossary" && <TradingGlossary />}
      </main>
    </div>
  );
}

function RunStatus({
  runState,
  tradePing,
}: {
  runState: { label: string | null; startedAt: string | null; status: "idle" | "running" | "done" | "error"; openedTrades?: number };
  tradePing: { visible: boolean; count: number };
}) {
  const isRunning = runState.status === "running";
  const started = runState.startedAt
    ? new Date(runState.startedAt).toLocaleTimeString("de-DE", { hour: "2-digit", minute: "2-digit", second: "2-digit" })
    : "--:--:--";
  const statusColor =
    runState.status === "running"
      ? "text-terminal-yellow border-terminal-yellow/40 bg-terminal-yellow/10"
      : runState.status === "error"
      ? "text-terminal-red border-terminal-red/40 bg-terminal-red/10"
      : runState.status === "done"
      ? "text-terminal-green border-terminal-green/40 bg-terminal-green/10"
      : "text-terminal-muted border-terminal-border";

  return (
    <div className="flex items-center gap-3 min-w-0">
      <div className={`border rounded px-3 py-2 ${statusColor}`}>
        <div className="flex items-center gap-2">
          <div className={`w-2 h-2 rounded-full ${isRunning ? "bg-terminal-yellow animate-pulse" : "bg-current"}`} />
          <span className="text-[10px] uppercase tracking-widest font-mono">
            {runState.label || "Idle"}
          </span>
        </div>
        <div className="text-[9px] text-terminal-muted mt-1 font-mono">started {started}</div>
      </div>
      {tradePing.visible && (
        <div className="relative border border-terminal-green/60 bg-terminal-green/10 text-terminal-green rounded px-3 py-2">
          <div className="absolute -inset-1 rounded border border-terminal-green/30 animate-ping" />
          <div className="relative text-[10px] uppercase tracking-widest font-mono">Trade Opened</div>
          <div className="relative text-[9px] font-mono">{tradePing.count} new position{tradePing.count === 1 ? "" : "s"}</div>
        </div>
      )}
    </div>
  );
}

function TradingGlossary() {
  const terms = [
    ["Expectancy", "Durchschnittlicher erwarteter Gewinn pro Trade. Wichtiger als Winrate allein."],
    ["Winrate", "Anteil gewonnener Trades. Eine hohe Winrate kann trotzdem unprofitabel sein, wenn Verluste größer sind."],
    ["Risk/Reward", "Verhältnis zwischen riskiertem Verlust und möglichem Gewinn. 2R bedeutet Zielgewinn doppelt so groß wie Risiko."],
    ["R-Multiple", "Gewinn oder Verlust gemessen in Einheiten des initialen Risikos. +2R ist ein Gewinn von zweimal Stop-Risiko."],
    ["ATR", "Average True Range. Misst typische Schwankungsbreite und hilft, Stops assetgerecht zu setzen."],
    ["Stop-Loss", "Regel zum Schließen eines Verlusttrades, bevor der Verlust zu groß wird."],
    ["Take-Profit", "Regel zum Realisieren eines Gewinns bei erreichtem Ziel."],
    ["Trailing Stop", "Stop, der einem Gewinner folgt und Gewinn schützt, wenn der Trade zurückläuft."],
    ["Drawdown", "Rückgang vom bisherigen Equity-Hoch. Max Drawdown zeigt, wie hart eine Strategie zwischenzeitlich fällt."],
    ["Profit Factor", "Bruttogewinne geteilt durch Bruttoverluste. Über 1 ist profitabel, höher ist besser."],
    ["Sharpe", "Rendite im Verhältnis zur Volatilität. Nützlich, aber bei kleinen Stichproben instabil."],
    ["Slippage", "Differenz zwischen erwartetem Preis und tatsächlichem Ausführungspreis."],
    ["Liquidity", "Wie leicht ein Asset handelbar ist, ohne den Preis stark zu bewegen."],
    ["Exposure", "Aktuell gebundenes Kapital im Markt. Zu hohe Exposure erhöht Portfolio-Risiko."],
    ["Correlation", "Wie ähnlich sich Positionen bewegen. Viele Tech-Aktien sind oft faktisch derselbe Makro-Trade."],
    ["Overtrading", "Zu viele Trades ohne klaren Edge. Häufiger Grund, warum gute Signale trotzdem Geld verlieren."],
    ["Signal", "Nostrad-Einschätzung zu Asset, Richtung, Score und Begründung."],
    ["Kronos Score", "Nostrad-Zeitreihen-/Chart-Score. Im Kronos-only Pfad ist das die zentrale Confidence."],
    ["Political Disclosure", "Öffentlich gemeldeter Politiker-Trade. Verzögertes Signal, kein Beweis für Insiderwissen."],
    ["Forward Test", "Live-Paper-Test ab jetzt. Wichtiger als überoptimierte historische Backtests."],
  ];

  return (
    <div className="bg-terminal-card border border-terminal-border rounded-lg p-5 max-w-5xl">
      <div className="text-[10px] uppercase tracking-widest text-terminal-muted mb-4">Trading Glossary</div>
      <div className="grid grid-cols-1 md:grid-cols-2 gap-x-8">
        {terms.map(([term, definition]) => (
          <div key={term} className="py-3 border-b border-terminal-border">
            <div className="text-[11px] uppercase tracking-wider text-terminal-blue font-semibold mb-1">{term}</div>
            <div className="text-[11px] leading-5 text-terminal-muted">{definition}</div>
          </div>
        ))}
      </div>
    </div>
  );
}

function MiniStat({ label, value, color }: { label: string; value: string; color?: string }) {
  return (
    <div className="flex justify-between items-center">
      <span className="text-[9px] text-terminal-muted uppercase tracking-wider">{label}</span>
      <span className={`text-[10px] font-semibold ${color || "text-terminal-text"}`}>{value}</span>
    </div>
  );
}

function ScoreHistogram({ signals }: { signals: any[] }) {
  const buckets = Array(10).fill(0);
  for (const s of signals) {
    const bucket = Math.min(Math.floor(s.final_score / 10), 9);
    buckets[bucket]++;
  }
  const max = Math.max(...buckets, 1);

  return (
    <div className="flex items-end gap-1 h-24">
      {buckets.map((count, i) => {
        const height = (count / max) * 100;
        const color = i >= 6 ? "bg-terminal-green" : i >= 3 ? "bg-terminal-yellow" : "bg-terminal-red";
        return (
          <div key={i} className="flex-1 flex flex-col items-center gap-1">
            <div className="w-full flex items-end" style={{ height: "80px" }}>
              <div
                className={`w-full ${color} rounded-t opacity-70 transition-all duration-500`}
                style={{ height: `${height}%` }}
              />
            </div>
            <span className="text-[8px] text-terminal-muted">{i * 10}</span>
          </div>
        );
      })}
    </div>
  );
}

function HowToUse() {
  return (
    <div className="space-y-4 max-w-5xl">

      {/* Intro */}
      <section className="bg-terminal-card border border-terminal-border rounded-lg p-5">
        <div className="text-[10px] uppercase tracking-widest text-terminal-muted mb-1">Was ist Nostrad</div>
        <p className="text-xs leading-6 text-terminal-muted">
          Nostrad ist ein Paper-Trading-Forschungssystem. Es sammelt Markt-News, analysiert sie mit vier Engines (Event, Sentiment, Polymarket, Kronos), erzeugt daraus Handelssignale und eröffnet virtuelle Trades mit 1.000€ Startkapital. Kein Echtgeld, keine Broker-Anbindung.
        </p>
      </section>

      {/* Der manuelle Zyklus */}
      <section className="bg-terminal-card border border-terminal-border rounded-lg p-5">
        <div className="text-[10px] uppercase tracking-widest text-terminal-muted mb-4">Manueller Zyklus — was wann klicken</div>
        <div className="space-y-0 divide-y divide-terminal-border">
          {[
            {
              nr: "1",
              btn: "Ingest Run",
              wann: "Zu Beginn einer Session oder wenn du frische Daten willst.",
              was: "Holt RSS-Feeds, Finnhub-News und Reddit-Posts. Jede News wird vom Event-Engine bewertet und relevante Artikel landen als unverarbeitete Events in der DB.",
              ergebnis: "Feedback im ActionBar: z.B. \"14 events, 0 signals\"",
            },
            {
              nr: "2",
              btn: "Process Queue",
              wann: "Direkt nach Ingest Run — verarbeitet alle unverarbeiteten Events.",
              was: "Für jedes relevante Event laufen alle vier Engines parallel: Event-Score, Sentiment-Score, Polymarket-Konfidenz und Kronos-Zeitreihenanalyse. Der Final Signal Engine kombiniert alles zu einem Score (0–100) und einer Richtung (LONG / SHORT / NEUTRAL).",
              ergebnis: "Signale erscheinen im Signal-Feed mit Score, Konfidenz und Begründung.",
            },
            {
              nr: "3",
              btn: "Execute Signals",
              wann: "Nach Process Queue — öffnet Trades für qualifizierte Signale.",
              was: "Nur Signale mit Final Score ≥ 65 UND Confidence ≥ 65 werden gehandelt. Neutrale Signale und Duplikate (selbes Asset bereits offen) werden übersprungen. Pro Trade werden 100€ reserviert.",
              ergebnis: "Neue Positionen erscheinen in Open Positions. Cash sinkt entsprechend.",
            },
            {
              nr: "4",
              btn: "Close Expired",
              wann: "Nach 24h — oder manuell wenn du Ergebnisse sehen willst.",
              was: "Alle offenen Trades älter als 24h werden zum aktuellen Marktpreis geschlossen. PnL wird berechnet. Cash wird zurückgebucht (inkl. Gewinn/Verlust).",
              ergebnis: "Trade-Historie zeigt Ergebnis. Portfolio-Equity aktualisiert sich.",
            },
          ].map((s) => (
            <div key={s.nr} className="py-4 grid grid-cols-12 gap-4 items-start">
              <div className="col-span-1 text-xl font-bold text-terminal-blue/30 tabular-nums">{s.nr}</div>
              <div className="col-span-2">
                <span className="text-[10px] font-mono uppercase tracking-wider border border-terminal-blue/40 text-terminal-blue px-2 py-0.5 rounded">
                  {s.btn}
                </span>
              </div>
              <div className="col-span-9 space-y-1.5">
                <p className="text-[11px] text-terminal-yellow font-medium">{s.wann}</p>
                <p className="text-[11px] leading-5 text-terminal-muted">{s.was}</p>
                <p className="text-[11px] text-terminal-text/60">→ {s.ergebnis}</p>
              </div>
            </div>
          ))}
        </div>
      </section>

      {/* Automatisches Trading mit Kronos 65% */}
      <section className="bg-terminal-card border border-[#3b82f6]/30 rounded-lg p-5">
        <div className="text-[10px] uppercase tracking-widest text-terminal-blue mb-4">Automatisch traden mit Kronos-Konfidenz 65%</div>
        <p className="text-xs text-terminal-muted leading-5 mb-5">
          Der Bot tradet automatisch, wenn du den kompletten Zyklus per n8n oder Cron-Job regelmäßig durchlaufen lässt.
          Die 65%-Schwelle ist bereits in der <code className="text-terminal-yellow text-[10px]">.env</code> konfiguriert.
        </p>

        <div className="space-y-4">
          <div className="border border-terminal-border rounded p-4">
            <div className="text-[10px] uppercase tracking-widest text-terminal-muted mb-3">Option A — n8n (empfohlen, läuft ohne dich)</div>
            <ol className="space-y-2">
              {[
                "n8n öffnen → neuen Workflow erstellen.",
                "Schedule-Trigger: alle 4 Stunden (oder nach Wunsch).",
                "HTTP Request Node → POST http://localhost:3000/api/ingest/run → warten bis fertig.",
                "HTTP Request Node → POST http://localhost:3000/api/signals/process-queue → warten.",
                "HTTP Request Node → POST http://localhost:3000/api/trades/execute.",
                "Zweiter Workflow mit 24h-Delay: POST /api/trades/close-expired.",
                "Workflow aktivieren. Ab jetzt läuft alles automatisch — du siehst neue Trades wenn du das Dashboard öffnest.",
              ].map((item, i) => (
                <li key={i} className="flex gap-3 text-[11px] leading-5 text-terminal-muted">
                  <span className="text-terminal-blue font-semibold tabular-nums shrink-0">{i + 1}</span>
                  <span>{item}</span>
                </li>
              ))}
            </ol>
          </div>

          <div className="border border-terminal-border rounded p-4">
            <div className="text-[10px] uppercase tracking-widest text-terminal-muted mb-3">Option B — macOS Cron (kein n8n nötig)</div>
            <p className="text-[11px] text-terminal-muted mb-3">Terminal öffnen, folgende Zeile in <code className="text-terminal-yellow">crontab -e</code> eintragen:</p>
            <pre className="text-[10px] font-mono text-terminal-green bg-black/40 p-3 rounded leading-6 overflow-x-auto">{`# Alle 4 Stunden: Ingest → Signale → Trades
0 */4 * * * curl -s -X POST http://localhost:3000/api/ingest/run && sleep 30 && curl -s -X POST http://localhost:3000/api/signals/process-queue && sleep 60 && curl -s -X POST http://localhost:3000/api/trades/execute

# Täglich 09:00: Abgelaufene Trades schließen
0 9 * * * curl -s -X POST http://localhost:3000/api/trades/close-expired`}</pre>
            <p className="text-[10px] text-terminal-muted mt-2">Voraussetzung: Backend muss laufen (<code className="text-terminal-yellow">npm run dev</code> im Hintergrund oder als Coolify-Service).</p>
          </div>

          <div className="border border-terminal-border rounded p-4">
            <div className="text-[10px] uppercase tracking-widest text-terminal-muted mb-3">Kronos-Konfidenz erhöhen oder senken</div>
            <p className="text-[11px] text-terminal-muted mb-3">In <code className="text-terminal-yellow text-[10px]">.env</code> anpassen — Server neu starten danach:</p>
            <pre className="text-[10px] font-mono text-terminal-green bg-black/40 p-3 rounded leading-6">{`# Aktuell (Standard): 65% Score + 65% Confidence
PAPER_TRADING_MIN_FINAL_SCORE=65
PAPER_TRADING_MIN_CONFIDENCE=65

# Konservativer (weniger Trades, höhere Qualität):
PAPER_TRADING_MIN_FINAL_SCORE=72
PAPER_TRADING_MIN_CONFIDENCE=72

# Kronos auf echtes Foundation Model umschalten:
KRONOS_MODE=python          # python | native | mock
KRONOS_MODEL_SIZE=small     # mini | small | base`}</pre>
          </div>
        </div>
      </section>

      {/* Reset */}
      <section className="bg-terminal-card border border-terminal-border rounded-lg p-5">
        <div className="text-[10px] uppercase tracking-widest text-terminal-muted mb-3">Reset — Sauberer Neustart</div>
        <p className="text-[11px] text-terminal-muted leading-5 mb-3">
          Der <span className="border border-terminal-red/40 text-terminal-red px-1.5 py-0.5 rounded text-[10px] font-mono">Reset</span>-Button (oben rechts, rot) löscht alle Trades, Signale und Events und setzt das Portfolio auf 1.000€ zurück. Nützlich nach Testläufen mit falschen Daten.
        </p>
        <p className="text-[11px] text-terminal-muted leading-5">
          Es erscheint ein Bestätigungsdialog — die Aktion ist nicht rückgängig zu machen.
        </p>
      </section>

      {/* Signal-Bedeutungen kompakt */}
      <section className="bg-terminal-card border border-terminal-border rounded-lg p-5">
        <div className="text-[10px] uppercase tracking-widest text-terminal-muted mb-3">Signal- und Trade-Status</div>
        <div className="grid grid-cols-2 gap-x-8 gap-y-2">
          {[
            ["LONG", "green", "Bullish-Signal, Schwellen erfüllt → Trade wird eröffnet"],
            ["SHORT", "red", "Bearish-Signal, Schwellen erfüllt → Trade wird eröffnet"],
            ["NEUTRAL", "muted", "Kein klares Signal — kein Trade"],
            ["PENDING", "yellow", "Signal existiert, noch nicht vom Executor geprüft"],
            ["TRADED", "green", "Trade wurde eröffnet"],
            ["SKIPPED", "muted", "Schwellen nicht erreicht, Duplikat, oder kein Kapital mehr"],
          ].map(([label, color, text]) => (
            <div key={label} className="flex gap-3 items-start py-1.5 border-b border-terminal-border/50">
              <span className={`text-[10px] font-mono font-semibold w-16 shrink-0 ${color === "green" ? "text-terminal-green" : color === "red" ? "text-terminal-red" : color === "yellow" ? "text-terminal-yellow" : "text-terminal-muted"}`}>
                {label}
              </span>
              <span className="text-[11px] text-terminal-muted leading-4">{text}</span>
            </div>
          ))}
        </div>
      </section>

    </div>
  );
}
