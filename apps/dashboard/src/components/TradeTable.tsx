interface Trade {
  id: string;
  asset: string;
  direction: string;
  entry_price: number;
  exit_price?: number;
  current_price?: number;
  position_size: number;
  pnl_absolute?: number;
  pnl_percent?: number;
  unrealized_pnl_absolute?: number;
  unrealized_pnl_percent?: number;
  status: string;
  entry_time: string;
  exit_time?: string;
  hours_open?: number;
  price_error?: string;
}

interface Props {
  trades: Trade[];
  title: string;
  showOpen?: boolean;
}

export function TradeTable({ trades, title, showOpen = false }: Props) {
  return (
    <div className="bg-terminal-card border border-terminal-border rounded-lg flex flex-col">
      <div className="px-4 py-3 border-b border-terminal-border flex items-center justify-between">
        <span className="text-[10px] uppercase tracking-widest text-terminal-muted">{title}</span>
        <span className="text-[10px] font-mono text-terminal-muted">{trades.length} trades</span>
      </div>
      <div className="overflow-x-auto">
        <table className="w-full text-xs font-mono">
          <thead>
            <tr className="border-b border-terminal-border">
              {["Asset", "Dir", "Entry", "Exit", "Size", "PnL", showOpen ? "Hours" : "Status"].map((h) => (
                <th key={h} className="px-4 py-2 text-left text-[9px] uppercase tracking-widest text-terminal-muted font-normal">
                  {h}
                </th>
              ))}
            </tr>
          </thead>
          <tbody className="divide-y divide-terminal-border">
            {trades.length === 0 && (
              <tr>
                <td colSpan={7} className="px-4 py-4 text-center text-terminal-muted text-[11px]">
                  Keine Trades
                </td>
              </tr>
            )}
            {trades.map((trade) => {
              const pnl = trade.status === "open"
                ? trade.unrealized_pnl_absolute ?? 0
                : trade.pnl_absolute ?? 0;
              const pct = trade.status === "open"
                ? trade.unrealized_pnl_percent ?? 0
                : trade.pnl_percent ?? 0;
              const pnlColor = pnl > 0 ? "text-terminal-green" : pnl < 0 ? "text-terminal-red" : "text-terminal-muted";
              const dirColor = trade.direction === "long" ? "text-terminal-green" : "text-terminal-red";
              const sign = pnl >= 0 ? "+" : "";
              const displayExit = trade.status === "open"
                ? trade.current_price?.toFixed(2) ?? "—"
                : trade.exit_price?.toFixed(2) ?? "—";

              return (
                <tr key={trade.id} className="hover:bg-terminal-hover transition-colors">
                  <td className="px-4 py-2 text-terminal-blue font-semibold">{trade.asset}</td>
                  <td className={`px-4 py-2 font-semibold ${dirColor}`}>{trade.direction.toUpperCase()}</td>
                  <td className="px-4 py-2 text-terminal-text">{trade.entry_price?.toFixed(2)}</td>
                  <td className="px-4 py-2 text-terminal-muted">{displayExit}</td>
                  <td className="px-4 py-2 text-terminal-text">{trade.position_size?.toFixed(0)}€</td>
                  <td className={`px-4 py-2 ${pnlColor}`}>
                    {trade.price_error ? "price err" : `${sign}${pnl.toFixed(2)}€ (${sign}${pct.toFixed(2)}%)`}
                  </td>
                  <td className="px-4 py-2 text-terminal-muted">
                    {showOpen
                      ? `${(trade.hours_open ?? 0).toFixed(1)}h`
                      : <StatusBadge status={trade.status} />}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function StatusBadge({ status }: { status: string }) {
  const cfg: Record<string, { bg: string; text: string }> = {
    open: { bg: "bg-terminal-yellow/10 border-terminal-yellow/30", text: "text-terminal-yellow" },
    closed: { bg: "bg-terminal-green/10 border-terminal-green/30", text: "text-terminal-green" },
  };
  const { bg, text } = cfg[status] || { bg: "bg-terminal-gray/10 border-terminal-gray/30", text: "text-terminal-muted" };
  return (
    <span className={`text-[9px] px-1.5 py-0.5 rounded border font-semibold uppercase tracking-wider ${bg} ${text}`}>
      {status}
    </span>
  );
}
