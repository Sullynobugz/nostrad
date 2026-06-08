interface Signal {
  id: string;
  created_at: string;
  asset: string;
  final_direction: "long" | "short" | "neutral";
  final_score: number;
  confidence: number;
  event_score: number;
  sentiment_score: number;
  polymarket_score: number;
  kronos_score: number;
  reasoning: string;
  status: string;
}

interface Props {
  signals: Signal[];
}

function ScoreBadge({ label, value, max = 100 }: { label: string; value: number; max?: number }) {
  const normalized = Math.abs(value) / max;
  const color = normalized > 0.65 ? "text-terminal-green" : normalized > 0.35 ? "text-terminal-yellow" : "text-terminal-muted";
  return (
    <div className="flex flex-col items-center gap-0.5">
      <span className="text-[9px] uppercase tracking-wider text-terminal-muted">{label}</span>
      <span className={`text-xs font-mono font-semibold ${color}`}>{value}</span>
    </div>
  );
}

function DirectionBadge({ direction }: { direction: string }) {
  const cfg = {
    long: { bg: "bg-terminal-green/10 border-terminal-green/30", text: "text-terminal-green", label: "▲ LONG" },
    short: { bg: "bg-terminal-red/10 border-terminal-red/30", text: "text-terminal-red", label: "▼ SHORT" },
    neutral: { bg: "bg-terminal-gray/10 border-terminal-gray/30", text: "text-terminal-muted", label: "◆ NEUTRAL" },
  }[direction] || { bg: "bg-terminal-gray/10 border-terminal-gray/30", text: "text-terminal-muted", label: direction };

  return (
    <span className={`text-[10px] font-mono font-semibold px-2 py-0.5 rounded border ${cfg.bg} ${cfg.text}`}>
      {cfg.label}
    </span>
  );
}

function StatusDot({ status }: { status: string }) {
  const colors: Record<string, string> = {
    pending: "bg-terminal-yellow",
    traded: "bg-terminal-green",
    skipped: "bg-terminal-muted",
    expired: "bg-terminal-gray",
  };
  return <div className={`w-1.5 h-1.5 rounded-full ${colors[status] || "bg-terminal-muted"}`} />;
}

export function SignalFeed({ signals }: Props) {
  return (
    <div className="bg-terminal-card border border-terminal-border rounded-lg flex flex-col">
      <div className="px-4 py-3 border-b border-terminal-border flex items-center justify-between">
        <span className="text-[10px] uppercase tracking-widest text-terminal-muted">Signal Feed</span>
        <span className="text-[10px] text-terminal-muted font-mono">{signals.length} signals</span>
      </div>
      <div className="overflow-y-auto max-h-[480px] divide-y divide-terminal-border">
        {signals.length === 0 && (
          <div className="px-4 py-6 text-center text-terminal-muted text-xs font-mono">Keine Signale vorhanden</div>
        )}
        {signals.map((signal) => {
          const time = new Date(signal.created_at).toLocaleTimeString("de-DE", { hour: "2-digit", minute: "2-digit" });
          const finalColor =
            signal.final_score >= 65 ? "text-terminal-green" : signal.final_score >= 40 ? "text-terminal-yellow" : "text-terminal-red";

          return (
            <div key={signal.id} className="px-4 py-3 hover:bg-terminal-hover transition-colors">
              <div className="flex items-center gap-3 mb-2">
                <StatusDot status={signal.status} />
                <span className="text-[10px] text-terminal-muted font-mono">{time}</span>
                <span className="text-sm font-mono font-semibold text-terminal-text">{signal.asset}</span>
                <DirectionBadge direction={signal.final_direction} />
                <div className="ml-auto flex items-center gap-1">
                  <span className="text-[10px] text-terminal-muted">Score</span>
                  <span className={`text-sm font-mono font-bold ${finalColor}`}>{signal.final_score}</span>
                  <span className="text-[10px] text-terminal-muted ml-1">Conf</span>
                  <span className="text-xs font-mono text-terminal-text">{signal.confidence}%</span>
                </div>
              </div>
              <div className="flex items-center gap-4 mb-2">
                <ScoreBadge label="Event" value={signal.event_score} />
                <ScoreBadge label="Sentiment" value={signal.sentiment_score} max={100} />
                <ScoreBadge label="Polymarket" value={signal.polymarket_score} />
                <ScoreBadge label="Kronos" value={signal.kronos_score} />
              </div>
              {signal.reasoning && (
                <p className="text-[11px] text-terminal-muted font-mono leading-relaxed truncate">{signal.reasoning}</p>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
