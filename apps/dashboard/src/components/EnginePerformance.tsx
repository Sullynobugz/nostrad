interface Props {
  signals: any[];
}

interface EngineStats {
  name: string;
  label: string;
  wins: number;
  losses: number;
  totalScore: number;
  count: number;
}

export function EnginePerformance({ signals }: Props) {
  const engines: Record<string, EngineStats> = {
    event: { name: "event", label: "Event Engine", wins: 0, losses: 0, totalScore: 0, count: 0 },
    sentiment: { name: "sentiment", label: "Sentiment Engine", wins: 0, losses: 0, totalScore: 0, count: 0 },
    polymarket: { name: "polymarket", label: "Polymarket Engine", wins: 0, losses: 0, totalScore: 0, count: 0 },
    kronos: { name: "kronos", label: "Kronos Engine", wins: 0, losses: 0, totalScore: 0, count: 0 },
  };

  // Stats aus Signalen berechnen (vereinfacht)
  for (const sig of signals) {
    engines.event.totalScore += sig.event_score || 0;
    engines.event.count++;
    engines.sentiment.totalScore += Math.abs(sig.sentiment_score || 0);
    engines.sentiment.count++;
    engines.polymarket.totalScore += sig.polymarket_score || 0;
    engines.polymarket.count++;
    engines.kronos.totalScore += sig.kronos_score || 0;
    engines.kronos.count++;
  }

  const sorted = Object.values(engines).sort((a, b) => {
    const avgA = a.count > 0 ? a.totalScore / a.count : 0;
    const avgB = b.count > 0 ? b.totalScore / b.count : 0;
    return avgB - avgA;
  });

  return (
    <div className="bg-terminal-card border border-terminal-border rounded-lg">
      <div className="px-4 py-3 border-b border-terminal-border">
        <span className="text-[10px] uppercase tracking-widest text-terminal-muted">Engine Performance</span>
      </div>
      <div className="p-4 space-y-3">
        {sorted.map((engine, i) => {
          const avgScore = engine.count > 0 ? engine.totalScore / engine.count : 0;
          const barWidth = Math.round(avgScore);
          const color = i === 0 ? "bg-terminal-green" : i === sorted.length - 1 ? "bg-terminal-red" : "bg-terminal-blue";

          return (
            <div key={engine.name} className="space-y-1">
              <div className="flex justify-between items-center">
                <span className="text-xs font-mono text-terminal-text">{engine.label}</span>
                <div className="flex items-center gap-3">
                  <span className="text-[10px] text-terminal-muted font-mono">
                    {engine.count} signals
                  </span>
                  <span className="text-xs font-mono font-semibold text-terminal-text">
                    {avgScore.toFixed(0)}/100
                  </span>
                </div>
              </div>
              <div className="h-1.5 bg-terminal-border rounded-full overflow-hidden">
                <div
                  className={`h-full ${color} rounded-full transition-all duration-500`}
                  style={{ width: `${barWidth}%` }}
                />
              </div>
            </div>
          );
        })}
        {signals.length === 0 && (
          <p className="text-[11px] text-terminal-muted font-mono text-center py-4">
            Noch keine Signals — Engine-Performance wird nach ersten Analysen angezeigt
          </p>
        )}
      </div>
    </div>
  );
}
