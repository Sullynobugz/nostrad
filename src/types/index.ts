// ─────────────────────────────────────────────────────────────
// Nostrad — Zentrale Typdefinitionen
// ─────────────────────────────────────────────────────────────

export type Direction = "long" | "short" | "neutral";
export type SignalStatus = "pending" | "traded" | "skipped" | "expired";
export type TradeStatus = "open" | "closed";
export type EngineName = "event" | "sentiment" | "polymarket" | "kronos" | "final";
export type KronosMode = "mock" | "native" | "python";

// ── Supabase DB-Typen ──────────────────────────────────────────

export interface DbEvent {
  id: string;
  created_at: string;
  source: string;
  url: string | null;
  title: string;
  summary: string;
  raw_text?: string | null;
  relevance_score: number;
  sentiment_score: number;
  affected_assets: string[];
  processed: boolean;
}

export interface DbSignal {
  id: string;
  created_at: string;
  event_id: string | null;
  asset: string;
  horizon: string;
  event_score: number;
  sentiment_score: number;
  polymarket_score: number;
  kronos_score: number;
  final_score: number;
  final_direction: Direction;
  confidence: number;
  reasoning: string;
  status: SignalStatus;
}

export interface DbPaperTrade {
  id: string;
  created_at: string;
  signal_id: string;
  asset: string;
  direction: Direction;
  entry_price: number;
  exit_price: number | null;
  position_size: number;
  entry_time: string;
  exit_time: string | null;
  pnl_absolute: number | null;
  pnl_percent: number | null;
  status: TradeStatus;
}

export interface DbPortfolioState {
  id: number;
  cash_balance: number;
  updated_at: string;
}

// ── Engine Outputs ────────────────────────────────────────────

export interface EventEngineOutput {
  relevance_score: number;      // 0-100
  affected_assets: string[];
  direction: "bullish" | "bearish" | "neutral";
  confidence: number;           // 0-100
  reasoning: string;
}

export interface SentimentEngineOutput {
  sentiment_score: number;      // -100 bis +100
  confidence: number;           // 0-100
  sources: string[];
  reasoning: string;
}

export interface PolymarketEngineOutput {
  market_title: string;
  current_probability: number;  // 0-100
  probability_change: number;   // Veränderung in letzten 24h
  implied_direction: "bullish" | "bearish" | "neutral";
  confidence: number;           // 0-100
  relevant_markets: PolymarketMarket[];
}

export interface PolymarketMarket {
  id: string;
  title: string;
  probability: number;
  change_24h: number;
}

export interface KronosEngineOutput {
  kronos_direction: "bullish" | "bearish" | "neutral";
  kronos_score: number;         // 0-100
  confidence: number;           // 0-100
  horizon: string;
  reasoning: string;
  mode: KronosMode;
}

export interface FinalSignalOutput {
  asset: string;
  horizon: string;
  event_score: number;
  sentiment_score: number;
  polymarket_score: number;
  kronos_score: number;
  final_score: number;
  final_direction: Direction;
  confidence: number;
  reasoning: string;
}

// ── Engine Input ─────────────────────────────────────────────

export interface EventEngineInput {
  title: string;
  summary: string;
  source: string;
  url?: string;
}

export interface SentimentInput {
  items: Array<{
    text: string;
    source: string;
    created_at?: string;
  }>;
  asset?: string;
}

export interface KronosInput {
  symbol: string;
  candles: OHLCV[];
}

export interface OHLCV {
  date: string;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
}

export interface FinalSignalInput {
  event: EventEngineOutput;
  sentiment: SentimentEngineOutput;
  polymarket: PolymarketEngineOutput | null;
  kronos: KronosEngineOutput;
  asset: string;
  eventContext: string;
}

// ── Portfolio ─────────────────────────────────────────────────

export interface PortfolioSummary {
  cash_balance: number;
  open_positions: DbPaperTrade[];
  open_positions_value: number;
  total_equity: number;
  total_pnl: number;
  total_pnl_percent: number;
  trade_count_open: number;
  trade_count_closed: number;
}

// ── Daily Report ──────────────────────────────────────────────

export interface DailyReportData {
  date: string;
  portfolio: PortfolioSummary;
  closed_today: DbPaperTrade[];
  win_rate: number;
  avg_return: number;
  best_trade: DbPaperTrade | null;
  worst_trade: DbPaperTrade | null;
  engine_performance: Record<EngineName, { wins: number; losses: number; avg_score: number }>;
  top_assets: Array<{ asset: string; trades: number; win_rate: number }>;
}

// ── RSS / Reddit Raw ──────────────────────────────────────────

export interface RawNewsItem {
  title: string;
  summary: string;
  url: string;
  source: string;
  published_at?: string;
}

export interface RawRedditPost {
  title: string;
  selftext: string;
  url: string;
  subreddit: string;
  score: number;
  num_comments: number;
  created_utc: number;
}
