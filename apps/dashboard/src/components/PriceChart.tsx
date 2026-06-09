import { useEffect, useRef, useState } from "react";
import { createChart, ColorType, CrosshairMode } from "lightweight-charts";

const MARKETS = [
  { symbol: "BTC", label: "Bitcoin", group: "Crypto" },
  { symbol: "ETH", label: "Ethereum", group: "Crypto" },
  { symbol: "SOL", label: "Solana", group: "Crypto" },
  { symbol: "BNB", label: "BNB", group: "Crypto" },
  { symbol: "XRP", label: "XRP", group: "Crypto" },
  { symbol: "ADA", label: "Cardano", group: "Crypto" },
  { symbol: "DOGE", label: "Dogecoin", group: "Crypto" },
  { symbol: "AVAX", label: "Avalanche", group: "Crypto" },
  { symbol: "SPY", label: "S&P 500 ETF", group: "ETFs" },
  { symbol: "QQQ", label: "Nasdaq 100 ETF", group: "ETFs" },
  { symbol: "IWM", label: "Russell 2000 ETF", group: "ETFs" },
  { symbol: "DIA", label: "Dow Jones ETF", group: "ETFs" },
  { symbol: "GLD", label: "Gold ETF", group: "ETFs" },
  { symbol: "SLV", label: "Silver ETF", group: "ETFs" },
  { symbol: "USO", label: "Oil ETF", group: "ETFs" },
  { symbol: "TLT", label: "20Y Treasury ETF", group: "ETFs" },
  { symbol: "AAPL", label: "Apple", group: "Stocks" },
  { symbol: "MSFT", label: "Microsoft", group: "Stocks" },
  { symbol: "NVDA", label: "NVIDIA", group: "Stocks" },
  { symbol: "AMZN", label: "Amazon", group: "Stocks" },
  { symbol: "GOOGL", label: "Alphabet", group: "Stocks" },
  { symbol: "META", label: "Meta", group: "Stocks" },
  { symbol: "TSLA", label: "Tesla", group: "Stocks" },
  { symbol: "AMD", label: "AMD", group: "Stocks" },
  { symbol: "NFLX", label: "Netflix", group: "Stocks" },
  { symbol: "COIN", label: "Coinbase", group: "Stocks" },
  { symbol: "MSTR", label: "MicroStrategy", group: "Stocks" },
] as const;

interface Props {
  asset: string;
  onAssetChange: (asset: string) => void;
  trades?: any[];
}

export function PriceChart({ asset, onAssetChange, trades = [] }: Props) {
  const containerRef = useRef<HTMLDivElement>(null);
  const chartRef = useRef<any>(null);
  const seriesRef = useRef<any>(null);
  const [dataMode, setDataMode] = useState<"live" | "demo">("live");
  const [dataState, setDataState] = useState<"loading" | "live" | "demo" | "empty" | "error">("loading");
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  useEffect(() => {
    if (!containerRef.current) return;

    const chart = createChart(containerRef.current, {
      layout: {
        background: { type: ColorType.Solid, color: "#0f1117" },
        textColor: "#636e7b",
      },
      grid: {
        vertLines: { color: "#1e2030" },
        horzLines: { color: "#1e2030" },
      },
      crosshair: { mode: CrosshairMode.Normal },
      rightPriceScale: { borderColor: "#1e2030" },
      timeScale: { borderColor: "#1e2030", timeVisible: true },
      handleScroll: true,
      handleScale: true,
    });

    const candleSeries = chart.addCandlestickSeries({
      upColor: "#00d084",
      downColor: "#ff4757",
      borderUpColor: "#00d084",
      borderDownColor: "#ff4757",
      wickUpColor: "#00d084",
      wickDownColor: "#ff4757",
    });

    chartRef.current = chart;
    seriesRef.current = candleSeries;

    const syncSize = () => {
      if (!containerRef.current) return;
      const { width, height } = containerRef.current.getBoundingClientRect();
      if (width > 0 && height > 0) {
        chart.applyOptions({ width, height });
      }
    };

    const resizeObserver = new ResizeObserver(() => {
      syncSize();
    });
    resizeObserver.observe(containerRef.current);
    syncSize();

    return () => {
      resizeObserver.disconnect();
      chart.remove();
    };
  }, []);

  // Asset-Daten laden
  useEffect(() => {
    if (!seriesRef.current) return;

    setDataState("loading");
    setErrorMessage(null);

    fetch(`/api/ingest/candles?asset=${asset}&mode=${dataMode}`)
      .then((r) => r.json())
      .then((candles: any[]) => {
        if (!Array.isArray(candles) || candles.length === 0) {
          setDataState("empty");
          seriesRef.current?.setData([]);
          return;
        }

        const data = candles.map((c: any) => ({
          time: c.date,
          open: c.open,
          high: c.high,
          low: c.low,
          close: c.close,
        }));

        seriesRef.current.setData(data);
        requestAnimationFrame(() => chartRef.current?.timeScale().fitContent());
        setDataState(dataMode);

        const entryMarkers = trades
          .filter((t) => t.asset === asset)
          .map((t) => ({
            time: t.entry_time?.split("T")[0],
            position: t.direction === "long" ? "belowBar" : "aboveBar",
            color: t.direction === "long" ? "#00d084" : "#ff4757",
            shape: t.direction === "long" ? "arrowUp" : "arrowDown",
            text: `ENTRY ${t.direction.toUpperCase()} ${t.position_size}€`,
          }))
          .filter((m) => m.time);

        const exitMarkers = trades
          .filter((t) => t.asset === asset && t.exit_time)
          .map((t) => {
            const pnl = Number(t.pnl_absolute || 0);
            const pct = Number(t.pnl_percent || 0);
            const sign = pnl >= 0 ? "+" : "";
            return {
              time: t.exit_time?.split("T")[0],
              position: t.direction === "long" ? "aboveBar" : "belowBar",
              color: pnl >= 0 ? "#00d084" : "#ff4757",
              shape: "circle",
              text: `EXIT ${sign}${pnl.toFixed(2)}€ ${sign}${pct.toFixed(2)}%`,
            };
          })
          .filter((m) => m.time);

        seriesRef.current.setMarkers([...entryMarkers, ...exitMarkers]);
      })
      .catch((err) => {
        setErrorMessage((err as Error).message);
        setDataState("error");
        seriesRef.current?.setData([]);
      });
  }, [asset, trades, dataMode]);

  return (
    <div className="bg-terminal-card border border-terminal-border rounded-lg flex flex-col h-full overflow-hidden min-h-[34rem]">
      <div className="px-4 py-3 border-b border-terminal-border flex items-center justify-between">
        <div className="flex items-center gap-3">
          <span className="text-[10px] uppercase tracking-widest text-terminal-muted">Price Chart</span>
          <span className="text-[10px] text-terminal-text font-mono">
            {asset} <span className="text-terminal-muted">{MARKETS.find((m) => m.symbol === asset)?.label}</span>
          </span>
          <span className={`text-[9px] uppercase tracking-widest ${dataState === "live" ? "text-terminal-green" : dataState === "demo" ? "text-terminal-yellow" : "text-terminal-muted"}`}>
            {dataState === "live" ? "LIVE" : dataState === "demo" ? "DEMO" : dataState === "loading" ? "LOADING" : dataState === "empty" ? "EMPTY" : "ERROR"}
          </span>
        </div>
        <div className="flex items-center gap-2">
          <select
            value={asset}
            onChange={(e) => onAssetChange(e.target.value)}
            className="bg-terminal-bg border border-terminal-border text-terminal-text text-[10px] font-mono rounded px-2 py-1 outline-none"
          >
            {["Crypto", "ETFs", "Stocks"].map((group) => (
              <optgroup key={group} label={group}>
                {MARKETS.filter((m) => m.group === group).map((m) => (
                  <option key={m.symbol} value={m.symbol}>
                    {m.symbol} - {m.label}
                  </option>
                ))}
              </optgroup>
            ))}
          </select>
          <button
            onClick={() => setDataMode("live")}
            className={`text-[10px] font-mono px-2 py-0.5 rounded transition-colors ${
              dataMode === "live"
                ? "bg-terminal-green/20 text-terminal-green border border-terminal-green/40"
                : "text-terminal-muted hover:text-terminal-text"
            }`}
          >
            Live
          </button>
          <button
            onClick={() => setDataMode("demo")}
            className={`text-[10px] font-mono px-2 py-0.5 rounded transition-colors ${
              dataMode === "demo"
                ? "bg-terminal-yellow/20 text-terminal-yellow border border-terminal-yellow/40"
                : "text-terminal-muted hover:text-terminal-text"
            }`}
          >
            Demo
          </button>
        </div>
      </div>
      <div className="relative flex-1 min-h-0">
        <div ref={containerRef} className="absolute inset-0" />
        {(dataState === "empty" || dataState === "error") && (
          <div className="absolute inset-0 flex items-center justify-center bg-terminal-bg/80 backdrop-blur-[1px] px-6">
            <div className="max-w-md text-center border border-terminal-border rounded-lg bg-terminal-card px-4 py-3">
              <div className="text-[10px] uppercase tracking-widest text-terminal-muted mb-2">
                {dataState === "empty" ? "No live candles" : "Live candle fetch failed"}
              </div>
              <p className="text-[11px] leading-5 text-terminal-muted">
                {dataState === "empty"
                  ? "Switch to Demo to inspect the chart with clearly marked demo data."
                  : `Live market data is unavailable for ${asset}.${errorMessage ? ` ${errorMessage}` : ""} Use Demo only for UI testing.`}
              </p>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
