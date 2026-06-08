import { useEffect, useRef } from "react";
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

    const resizeObserver = new ResizeObserver(() => {
      if (containerRef.current) {
        chart.applyOptions({ width: containerRef.current.clientWidth });
      }
    });
    resizeObserver.observe(containerRef.current);

    return () => {
      resizeObserver.disconnect();
      chart.remove();
    };
  }, []);

  // Asset-Daten laden
  useEffect(() => {
    if (!seriesRef.current) return;

    fetch(`/api/ingest/candles?asset=${asset}`)
      .then((r) => r.json())
      .then((candles: any[]) => {
        if (!Array.isArray(candles) || candles.length === 0) return;

        const data = candles.map((c: any) => ({
          time: c.date,
          open: c.open,
          high: c.high,
          low: c.low,
          close: c.close,
        }));

        seriesRef.current.setData(data);
        chartRef.current?.timeScale().fitContent();

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
      .catch(() => {
        // Platzhalter-Daten wenn API nicht antwortet
        const mockData = generateMockCandles(30, asset === "BTC" ? 60000 : asset === "ETH" ? 3000 : 500);
        seriesRef.current?.setData(mockData);
        chartRef.current?.timeScale().fitContent();
      });
  }, [asset, trades]);

  return (
    <div className="bg-terminal-card border border-terminal-border rounded-lg flex flex-col">
      <div className="px-4 py-3 border-b border-terminal-border flex items-center justify-between">
        <span className="text-[10px] uppercase tracking-widest text-terminal-muted">Price Chart</span>
        <div className="flex items-center gap-1">
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
      <div ref={containerRef} className="h-64 w-full" />
    </div>
  );
}

function generateMockCandles(days: number, basePrice: number) {
  const today = new Date();
  const data = [];
  let price = basePrice;

  for (let i = days; i >= 0; i--) {
    const date = new Date(today);
    date.setDate(date.getDate() - i);
    const dateStr = date.toISOString().split("T")[0];

    const change = (Math.random() - 0.48) * price * 0.03;
    const open = price;
    const close = Math.max(price + change, price * 0.9);
    const high = Math.max(open, close) * (1 + Math.random() * 0.01);
    const low = Math.min(open, close) * (1 - Math.random() * 0.01);
    price = close;

    data.push({ time: dateStr, open, high, low, close });
  }
  return data;
}
