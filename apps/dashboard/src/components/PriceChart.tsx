import { useEffect, useRef, useState } from "react";
import { createChart, ColorType, CrosshairMode } from "lightweight-charts";

const ASSETS = ["BTC", "ETH", "SPY", "QQQ", "NVDA", "TSLA"];

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

        // Trade-Marker hinzufügen
        const markers = trades
          .filter((t) => t.asset === asset)
          .map((t) => ({
            time: t.entry_time?.split("T")[0],
            position: t.direction === "long" ? "belowBar" : "aboveBar",
            color: t.direction === "long" ? "#00d084" : "#ff4757",
            shape: t.direction === "long" ? "arrowUp" : "arrowDown",
            text: `${t.direction.toUpperCase()} ${t.position_size}€`,
          }))
          .filter((m) => m.time);

        if (markers.length > 0) {
          seriesRef.current.setMarkers(markers);
        }
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
          <span className={`text-[9px] uppercase tracking-widest ${dataState === "live" ? "text-terminal-green" : dataState === "demo" ? "text-terminal-yellow" : "text-terminal-muted"}`}>
            {dataState === "live" ? "LIVE" : dataState === "demo" ? "DEMO" : dataState === "loading" ? "LOADING" : dataState === "empty" ? "EMPTY" : "ERROR"}
          </span>
        </div>
        <div className="flex items-center gap-1">
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
          {ASSETS.map((a) => (
            <button
              key={a}
              onClick={() => onAssetChange(a)}
              className={`text-[10px] font-mono px-2 py-0.5 rounded transition-colors ${
                a === asset
                  ? "bg-terminal-blue/20 text-terminal-blue border border-terminal-blue/40"
                  : "text-terminal-muted hover:text-terminal-text"
              }`}
            >
              {a}
            </button>
          ))}
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
