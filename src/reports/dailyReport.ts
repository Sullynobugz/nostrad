import { supabase } from "../services/supabase";
import { getPortfolioSummary } from "../paperTrading/portfolio";
import type { DbPaperTrade, DailyReportData, EngineName } from "../types";
import fs from "fs/promises";
import path from "path";

const START_BALANCE = parseFloat(process.env.PAPER_TRADING_START_BALANCE || "1000");

export async function generateDailyReport(): Promise<DailyReportData> {
  const today = new Date();
  const todayStart = new Date(today.getFullYear(), today.getMonth(), today.getDate()).toISOString();

  // Heute geschlossene Trades
  const { data: closedToday } = await supabase
    .from("paper_trades")
    .select("*, signals(*)")
    .eq("status", "closed")
    .gte("exit_time", todayStart)
    .order("exit_time", { ascending: false });

  const trades = (closedToday || []) as (DbPaperTrade & { signals?: any })[];

  // Win Rate
  const wins = trades.filter((t) => (t.pnl_absolute || 0) > 0);
  const winRate = trades.length > 0 ? (wins.length / trades.length) * 100 : 0;

  // Avg Return
  const avgReturn = trades.length > 0
    ? trades.reduce((sum, t) => sum + (t.pnl_percent || 0), 0) / trades.length
    : 0;

  // Best / Worst Trade
  const sortedByPnl = [...trades].sort((a, b) => (b.pnl_absolute || 0) - (a.pnl_absolute || 0));
  const bestTrade = sortedByPnl[0] || null;
  const worstTrade = sortedByPnl[sortedByPnl.length - 1] || null;

  // Engine Performance berechnen
  const enginePerf: Record<EngineName, { wins: number; losses: number; avg_score: number }> = {
    event: { wins: 0, losses: 0, avg_score: 0 },
    sentiment: { wins: 0, losses: 0, avg_score: 0 },
    polymarket: { wins: 0, losses: 0, avg_score: 0 },
    kronos: { wins: 0, losses: 0, avg_score: 0 },
    final: { wins: 0, losses: 0, avg_score: 0 },
  };

  for (const trade of trades) {
    const won = (trade.pnl_absolute || 0) > 0;
    const sig = trade.signals;
    if (!sig) continue;

    const engines: Array<[EngineName, number]> = [
      ["event", sig.event_score || 0],
      ["sentiment", Math.abs(sig.sentiment_score || 0)],
      ["polymarket", sig.polymarket_score || 0],
      ["kronos", sig.kronos_score || 0],
      ["final", sig.final_score || 0],
    ];

    for (const [name, score] of engines) {
      if (won) enginePerf[name].wins++;
      else enginePerf[name].losses++;
      enginePerf[name].avg_score = (enginePerf[name].avg_score + score) / 2;
    }
  }

  // Top Assets
  const assetMap = new Map<string, { trades: number; wins: number }>();
  for (const trade of trades) {
    const entry = assetMap.get(trade.asset) || { trades: 0, wins: 0 };
    entry.trades++;
    if ((trade.pnl_absolute || 0) > 0) entry.wins++;
    assetMap.set(trade.asset, entry);
  }
  const topAssets = [...assetMap.entries()]
    .map(([asset, data]) => ({
      asset,
      trades: data.trades,
      win_rate: data.trades > 0 ? (data.wins / data.trades) * 100 : 0,
    }))
    .sort((a, b) => b.trades - a.trades)
    .slice(0, 5);

  const portfolio = await getPortfolioSummary();

  return {
    date: today.toISOString().split("T")[0],
    portfolio,
    closed_today: trades,
    win_rate: winRate,
    avg_return: avgReturn,
    best_trade: bestTrade,
    worst_trade: worstTrade,
    engine_performance: enginePerf,
    top_assets: topAssets,
  };
}

export async function generateMarkdownReport(data: DailyReportData): Promise<string> {
  const engineLines = (Object.entries(data.engine_performance) as [EngineName, any][])
    .map(([name, perf]) => {
      const total = perf.wins + perf.losses;
      const wr = total > 0 ? ((perf.wins / total) * 100).toFixed(1) : "—";
      return `| ${name.padEnd(12)} | ${total.toString().padStart(4)} | ${wr.padStart(7)}% | ${perf.avg_score.toFixed(0).padStart(9)} |`;
    })
    .join("\n");

  const tradeLines = data.closed_today
    .map((t) => {
      const pnl = t.pnl_absolute || 0;
      const pct = t.pnl_percent || 0;
      const sign = pnl >= 0 ? "+" : "";
      return `| ${t.asset.padEnd(6)} | ${t.direction.padEnd(5)} | ${t.entry_price?.toFixed(2).padStart(10)} | ${(t.exit_price || 0).toFixed(2).padStart(10)} | ${(sign + pnl.toFixed(2) + "€").padStart(10)} | ${(sign + pct.toFixed(2) + "%").padStart(8)} |`;
    })
    .join("\n");

  const totalPnl = data.portfolio.total_pnl;
  const totalPct = data.portfolio.total_pnl_percent;

  return `# 📊 Nostrad Daily Report — ${data.date}

## Portfolio
| Metric | Value |
|--------|-------|
| Total Equity | **${data.portfolio.total_equity.toFixed(2)}€** |
| Cash Balance | ${data.portfolio.cash_balance.toFixed(2)}€ |
| Open Positions | ${data.portfolio.trade_count_open} (${data.portfolio.open_positions_value.toFixed(2)}€) |
| Total PnL | ${totalPnl >= 0 ? "+" : ""}${totalPnl.toFixed(2)}€ (${totalPnl >= 0 ? "+" : ""}${totalPct.toFixed(2)}%) |

## Heute (${data.date})
| Metric | Value |
|--------|-------|
| Geschlossene Trades | ${data.closed_today.length} |
| Win Rate | **${data.win_rate.toFixed(1)}%** |
| Avg Return | ${data.avg_return >= 0 ? "+" : ""}${data.avg_return.toFixed(2)}% |
| Bester Trade | ${data.best_trade ? `${data.best_trade.asset} +${(data.best_trade.pnl_absolute || 0).toFixed(2)}€` : "—"} |
| Schlechtester Trade | ${data.worst_trade ? `${data.worst_trade.asset} ${(data.worst_trade.pnl_absolute || 0).toFixed(2)}€` : "—"} |

## Trade History (Heute)
| Asset  | Dir   | Entry      | Exit       | PnL       | Return  |
|--------|-------|------------|------------|-----------|---------|
${tradeLines || "| — | — | — | — | — | — |"}

## Engine Performance (All-Time)
| Engine       | Pred |  Win Rate | Avg Score |
|--------------|------|-----------|-----------|
${engineLines}

## Top Assets
${data.top_assets.map((a) => `- **${a.asset}**: ${a.trades} Trades, ${a.win_rate.toFixed(1)}% Win Rate`).join("\n") || "— Noch keine Daten"}

---
*Generiert: ${new Date().toISOString()} | Nostrad Paper Trading Research System*
`;
}

// CLI-Mode: Report generieren und speichern
if (require.main === module) {
  (async () => {
    const data = await generateDailyReport();
    const markdown = await generateMarkdownReport(data);

    const reportsDir = path.join(process.cwd(), "reports");
    await fs.mkdir(reportsDir, { recursive: true });

    const filename = path.join(reportsDir, `report-${data.date}.md`);
    await fs.writeFile(filename, markdown, "utf-8");

    console.log(markdown);
    console.log(`\n✅ Report gespeichert: ${filename}`);
  })().catch(console.error);
}
