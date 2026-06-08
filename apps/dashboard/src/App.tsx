import { useState } from "react";
import { PortfolioCard } from "./components/PortfolioCard";
import { SignalFeed } from "./components/SignalFeed";
import { TradeTable } from "./components/TradeTable";
import { EnginePerformance } from "./components/EnginePerformance";
import { PriceChart } from "./components/PriceChart";
import { ActionBar } from "./components/ActionBar";
import { useDashboard } from "./hooks/useData";

type Page = "dashboard" | "signals" | "trades" | "events" | "performance" | "guide";

const NAV: { id: Page; label: string }[] = [
  { id: "dashboard", label: "Dashboard" },
  { id: "signals", label: "Signals" },
  { id: "trades", label: "Trades" },
  { id: "performance", label: "Engines" },
  { id: "guide", label: "How To Use" },
];

export function App() {
  const [page, setPage] = useState<Page>("dashboard");
  const [chartAsset, setChartAsset] = useState("BTC");
  const { portfolio, openTrades, signals, history } = useDashboard();

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
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-sm font-semibold tracking-wide text-terminal-text uppercase">
              {NAV.find((n) => n.id === page)?.label}
            </h1>
            <p className="text-[10px] text-terminal-muted">
              {new Date().toLocaleDateString("de-DE", { weekday: "long", year: "numeric", month: "long", day: "numeric" })}
            </p>
          </div>
          <ActionBar onRefresh={refetchAll} />
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
      </main>
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
  const pipeline = [
    {
      step: "1",
      title: "Ingest Run",
      command: "POST /api/ingest/run",
      body: "RSS, Finnhub market news and Reddit are queried. Each news item is scored by the Event Engine and relevant items become rows in events.",
      output: "New unprocessed events with title, summary, relevance, sentiment placeholder and affected assets.",
    },
    {
      step: "2",
      title: "Process Queue",
      command: "POST /api/signals/process-queue",
      body: "Unprocessed events are selected by relevance. For each event, Event, Sentiment, Polymarket and Kronos engines run and their outputs are combined.",
      output: "Rows in signals with final direction, final score, confidence and reasoning. The event is then marked processed.",
    },
    {
      step: "3",
      title: "Execute Signals",
      command: "POST /api/trades/execute",
      body: "Only pending signals above the configured score and confidence thresholds can open paper trades. Neutral signals are skipped.",
      output: "Rows in paper_trades plus reserved virtual cash in portfolio_state.",
    },
    {
      step: "4",
      title: "Close Expired",
      command: "POST /api/trades/close-expired",
      body: "Open paper trades older than the configured holding period are closed with the latest quote and PnL is calculated.",
      output: "Closed trades, updated portfolio cash and a portfolio snapshot.",
    },
  ];

  const sources = [
    ["RSS feeds", "General finance and technology news used as raw event candidates."],
    ["Finnhub", "Market news, quotes and OHLCV candles for charting and trade entry/exit prices."],
    ["Reddit", "Recent posts for asset-level sentiment. May be empty if Reddit returns 403."],
    ["Polymarket", "Prediction-market probabilities used as directional context."],
    ["Kronos", "Time-series direction from configured mode. If external candles fail, current code can fall back to mock behavior."],
  ];

  const recommendations = [
    ["LONG", "The combined engines lean bullish and the signal passes score/confidence thresholds."],
    ["SHORT", "The combined engines lean bearish and the signal passes score/confidence thresholds."],
    ["NEUTRAL", "Engines are mixed, confidence is too weak, or no clear direction exists."],
    ["PENDING", "Signal exists but has not been evaluated by the trade executor."],
    ["TRADED", "A paper trade was opened from the signal."],
    ["SKIPPED", "The signal did not qualify, was neutral, had duplicate exposure, lacked capital, or had quote issues."],
  ];

  return (
    <div className="space-y-4">
      <section className="bg-terminal-card border border-terminal-border rounded-lg p-5">
        <div className="text-[10px] uppercase tracking-widest text-terminal-muted mb-2">Operating Model</div>
        <h2 className="text-lg font-semibold text-terminal-text mb-3">How Nostrad Turns Data Into Paper Trades</h2>
        <p className="text-xs leading-6 text-terminal-muted max-w-4xl">
          Nostrad is a paper-trading research loop. It collects market-related inputs, filters them into events, converts
          events into multi-engine signals, and only opens virtual trades when a signal is strong enough. The useful test is
          not whether every signal trades, but whether the full chain is observable and repeatable.
        </p>
      </section>

      <section className="grid grid-cols-1 xl:grid-cols-4 gap-4">
        {pipeline.map((item) => (
          <div key={item.step} className="bg-terminal-card border border-terminal-border rounded-lg p-4">
            <div className="flex items-center justify-between mb-3">
              <span className="text-terminal-blue text-sm font-semibold">{item.step}</span>
              <span className="text-[9px] uppercase tracking-widest text-terminal-muted">{item.title}</span>
            </div>
            <div className="text-[10px] font-mono text-terminal-yellow mb-3">{item.command}</div>
            <p className="text-[11px] leading-5 text-terminal-muted mb-3">{item.body}</p>
            <p className="text-[11px] leading-5 text-terminal-text">{item.output}</p>
          </div>
        ))}
      </section>

      <section className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <GuidePanel title="Data Sources" rows={sources} />
        <GuidePanel title="Signal And Trade Meanings" rows={recommendations} />
      </section>

      <section className="bg-terminal-card border border-terminal-border rounded-lg p-5">
        <div className="text-[10px] uppercase tracking-widest text-terminal-muted mb-3">Manual Test Run</div>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <StepList
            title="Dashboard Steps"
            items={[
              "Open Dashboard and click Ingest Run.",
              "Click Process Queue after ingest finishes.",
              "Review Signal Feed for score, confidence, direction and reasoning.",
              "Click Execute Signals to open eligible paper trades.",
              "Review Portfolio and Open Positions.",
              "Use Close Expired after the configured holding period.",
            ]}
          />
          <StepList
            title="What To Watch"
            items={[
              "Inserted events should be greater than zero unless all items are duplicates.",
              "Signals can be generated without becoming trades.",
              "Trades require score and confidence thresholds from the backend environment.",
              "Skipped signals are expected and should include a reason.",
              "Quote or external-source failures should be treated separately from database failures.",
              "This is virtual capital only; no broker or real-money execution exists.",
            ]}
          />
        </div>
      </section>
    </div>
  );
}

function GuidePanel({ title, rows }: { title: string; rows: string[][] }) {
  return (
    <div className="bg-terminal-card border border-terminal-border rounded-lg p-5">
      <div className="text-[10px] uppercase tracking-widest text-terminal-muted mb-3">{title}</div>
      <div className="divide-y divide-terminal-border">
        {rows.map(([label, text]) => (
          <div key={label} className="py-3 grid grid-cols-3 gap-4">
            <div className="text-[11px] font-semibold text-terminal-blue">{label}</div>
            <div className="col-span-2 text-[11px] leading-5 text-terminal-muted">{text}</div>
          </div>
        ))}
      </div>
    </div>
  );
}

function StepList({ title, items }: { title: string; items: string[] }) {
  return (
    <div>
      <div className="text-[10px] uppercase tracking-widest text-terminal-blue mb-3">{title}</div>
      <ol className="space-y-2">
        {items.map((item, index) => (
          <li key={item} className="flex gap-3 text-[11px] leading-5 text-terminal-muted">
            <span className="text-terminal-text font-semibold tabular-nums">{index + 1}</span>
            <span>{item}</span>
          </li>
        ))}
      </ol>
    </div>
  );
}
