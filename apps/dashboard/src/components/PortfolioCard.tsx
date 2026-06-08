interface Props {
  portfolio: any;
}

function Metric({ label, value, sub, color }: { label: string; value: string; sub?: string; color?: string }) {
  return (
    <div className="flex flex-col gap-0.5">
      <span className="text-[10px] uppercase tracking-widest text-terminal-muted">{label}</span>
      <span className={`text-xl font-mono font-semibold ${color || "text-terminal-text"}`}>{value}</span>
      {sub && <span className="text-xs text-terminal-muted font-mono">{sub}</span>}
    </div>
  );
}

export function PortfolioCard({ portfolio }: Props) {
  if (!portfolio) return <CardSkeleton />;

  const pnl = portfolio.total_pnl ?? 0;
  const pct = portfolio.total_pnl_percent ?? 0;
  const pnlColor = pnl >= 0 ? "text-terminal-green" : "text-terminal-red";
  const sign = pnl >= 0 ? "+" : "";

  return (
    <div className="col-span-full bg-terminal-card border border-terminal-border rounded-lg p-5">
      <div className="flex items-center justify-between mb-4">
        <div className="flex items-center gap-2">
          <div className="w-2 h-2 rounded-full bg-terminal-green animate-pulse" />
          <span className="text-[10px] uppercase tracking-widest text-terminal-muted">Portfolio</span>
        </div>
        <span className="text-[10px] text-terminal-muted font-mono">{new Date().toLocaleTimeString("de-DE")}</span>
      </div>
      <div className="grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-7 gap-6">
        <Metric label="Total Equity" value={`${portfolio.total_equity?.toFixed(2) ?? "—"}€`} color="text-terminal-blue" />
        <Metric label="Cash" value={`${portfolio.cash_balance?.toFixed(2) ?? "—"}€`} />
        <Metric label="Positions" value={`${portfolio.trade_count_open ?? 0}`} sub={`${portfolio.open_positions_value?.toFixed(2) ?? 0}€ invested`} />
        <Metric label="Total PnL" value={`${sign}${pnl.toFixed(2)}€`} sub={`${sign}${pct.toFixed(2)}%`} color={pnlColor} />
        <Metric label="Closed Trades" value={`${portfolio.trade_count_closed ?? 0}`} />
      </div>
    </div>
  );
}

function CardSkeleton() {
  return (
    <div className="col-span-full bg-terminal-card border border-terminal-border rounded-lg p-5 animate-pulse">
      <div className="h-6 bg-terminal-border rounded w-1/4 mb-4" />
      <div className="grid grid-cols-4 gap-6">
        {[...Array(4)].map((_, i) => (
          <div key={i} className="h-10 bg-terminal-border rounded" />
        ))}
      </div>
    </div>
  );
}
