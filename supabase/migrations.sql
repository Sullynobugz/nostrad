-- Nostrad Paper-Trading Research System
-- Schema Version 1.0

-- Extensions
create extension if not exists "uuid-ossp";

-- ─────────────────────────────────────────────
-- EVENTS
-- Rohe News-/Event-Datenpunkte aus RSS, Reddit, Polymarket
-- ─────────────────────────────────────────────
create table if not exists events (
  id              uuid primary key default uuid_generate_v4(),
  created_at      timestamptz not null default now(),
  source          text not null,             -- 'rss' | 'reddit' | 'polymarket' | 'finnhub'
  url             text,
  title           text not null,
  summary         text not null,
  raw_text        text,
  relevance_score integer not null default 0 check (relevance_score between 0 and 100),
  sentiment_score integer not null default 0 check (sentiment_score between -100 and 100),
  affected_assets jsonb not null default '[]'::jsonb,
  processed       boolean not null default false
);

create index if not exists events_created_at_idx  on events (created_at desc);
create index if not exists events_processed_idx   on events (processed) where processed = false;
create index if not exists events_source_idx      on events (source);

-- Deduplizierung per URL
create unique index if not exists events_url_unique on events (url) where url is not null;

-- ─────────────────────────────────────────────
-- SIGNALS
-- Kombinierte Scores aus allen vier Engines
-- ─────────────────────────────────────────────
create table if not exists signals (
  id                uuid primary key default uuid_generate_v4(),
  created_at        timestamptz not null default now(),
  event_id          uuid references events(id),
  asset             text not null,
  horizon           text not null default '24h',   -- '4h' | '24h' | '7d'
  -- Einzelne Engine-Scores (separat messbar)
  event_score       integer not null default 0 check (event_score between 0 and 100),
  sentiment_score   integer not null default 0 check (sentiment_score between -100 and 100),
  polymarket_score  integer not null default 0 check (polymarket_score between 0 and 100),
  kronos_score      integer not null default 0 check (kronos_score between 0 and 100),
  -- Finaler kombinierter Score
  final_score       integer not null default 0 check (final_score between 0 and 100),
  final_direction   text not null check (final_direction in ('long', 'short', 'neutral')),
  confidence        integer not null default 0 check (confidence between 0 and 100),
  reasoning         text not null default '',
  status            text not null default 'pending' check (status in ('pending', 'traded', 'skipped', 'expired'))
);

create index if not exists signals_created_at_idx on signals (created_at desc);
create index if not exists signals_status_idx     on signals (status) where status = 'pending';
create index if not exists signals_asset_idx      on signals (asset);

-- ─────────────────────────────────────────────
-- PAPER TRADES
-- Virtuelle Trades — kein Echtgeld
-- ─────────────────────────────────────────────
create table if not exists paper_trades (
  id              uuid primary key default uuid_generate_v4(),
  created_at      timestamptz not null default now(),
  signal_id       uuid references signals(id),
  asset           text not null,
  direction       text not null check (direction in ('long', 'short')),
  entry_price     numeric(18,6) not null,
  exit_price      numeric(18,6),
  position_size   numeric(18,2) not null,      -- EUR
  entry_time      timestamptz not null,
  exit_time       timestamptz,
  pnl_absolute    numeric(18,2),               -- EUR
  pnl_percent     numeric(10,4),               -- %
  status          text not null default 'open' check (status in ('open', 'closed'))
);

create index if not exists trades_status_idx      on paper_trades (status) where status = 'open';
create index if not exists trades_entry_time_idx  on paper_trades (entry_time desc);
create index if not exists trades_asset_idx       on paper_trades (asset);

-- ─────────────────────────────────────────────
-- PORTFOLIO SNAPSHOTS
-- Täglicher Snapshot des virtuellen Portfolios
-- ─────────────────────────────────────────────
create table if not exists portfolio_snapshots (
  id                    uuid primary key default uuid_generate_v4(),
  created_at            timestamptz not null default now(),
  cash_balance          numeric(18,2) not null,
  open_positions_value  numeric(18,2) not null default 0,
  total_equity          numeric(18,2) not null
);

create index if not exists snapshots_created_at_idx on portfolio_snapshots (created_at desc);

-- ─────────────────────────────────────────────
-- ENGINE PERFORMANCE
-- Aggregierte Performance je Engine
-- ─────────────────────────────────────────────
create table if not exists engine_performance (
  id               uuid primary key default uuid_generate_v4(),
  created_at       timestamptz not null default now(),
  engine_name      text not null,              -- 'event' | 'sentiment' | 'polymarket' | 'kronos' | 'final'
  period_start     timestamptz not null,
  period_end       timestamptz not null,
  prediction_count integer not null default 0,
  win_rate         numeric(5,2),               -- %
  avg_return       numeric(10,4),              -- %
  notes            text
);

create index if not exists engine_perf_engine_idx on engine_performance (engine_name);
create index if not exists engine_perf_period_idx on engine_performance (period_end desc);

-- ─────────────────────────────────────────────
-- POST MORTEMS
-- Manuelle oder automatische Trade-Analyse
-- ─────────────────────────────────────────────
create table if not exists post_mortems (
  id           uuid primary key default uuid_generate_v4(),
  created_at   timestamptz not null default now(),
  trade_id     uuid references paper_trades(id),
  was_correct  boolean not null,
  mistake_type text,                           -- null wenn korrekt, sonst: 'false_signal' | 'wrong_timing' | 'data_quality' | 'model_error'
  explanation  text not null,
  lesson       text not null
);

create index if not exists postmortems_trade_idx on post_mortems (trade_id);

-- ─────────────────────────────────────────────
-- PORTFOLIO STATE (Singleton-Tabelle)
-- Aktueller Kassenstand — nur eine Zeile
-- ─────────────────────────────────────────────
create table if not exists portfolio_state (
  id              integer primary key default 1 check (id = 1),  -- Singleton
  cash_balance    numeric(18,2) not null,
  updated_at      timestamptz not null default now()
);

-- Initialwert einfügen (1.000 € Startkapital)
insert into portfolio_state (id, cash_balance)
values (1, 1000.00)
on conflict (id) do nothing;

-- ─────────────────────────────────────────────
-- VIEW: offene Positionen mit Signal-Kontext
-- ─────────────────────────────────────────────
create or replace view open_trades_with_signal as
  select
    t.id,
    t.created_at,
    t.asset,
    t.direction,
    t.entry_price,
    t.position_size,
    t.entry_time,
    s.final_score,
    s.final_direction,
    s.confidence,
    s.reasoning,
    extract(epoch from (now() - t.entry_time))/3600 as hours_open
  from paper_trades t
  left join signals s on t.signal_id = s.id
  where t.status = 'open'
  order by t.entry_time desc;

-- ─────────────────────────────────────────────
-- FUNCTION: Portfolio-Snapshot erstellen
-- ─────────────────────────────────────────────
create or replace function take_portfolio_snapshot()
returns void as $$
declare
  v_cash numeric(18,2);
  v_positions numeric(18,2);
begin
  select cash_balance into v_cash from portfolio_state where id = 1;
  select coalesce(sum(position_size), 0) into v_positions from paper_trades where status = 'open';

  insert into portfolio_snapshots (cash_balance, open_positions_value, total_equity)
  values (v_cash, v_positions, v_cash + v_positions);
end;
$$ language plpgsql;

-- ─────────────────────────────────────────────
-- SERVICE ROLE PERMISSIONS
-- Backend ingestion and signal generation use SUPABASE_SERVICE_KEY.
-- ─────────────────────────────────────────────
grant usage on schema public to service_role;

grant select, insert, update on table public.events to service_role;
grant select, insert, update on table public.signals to service_role;

alter table public.events enable row level security;
alter table public.signals enable row level security;

drop policy if exists "service_role_events_all" on public.events;
create policy "service_role_events_all"
  on public.events
  for all
  to service_role
  using (true)
  with check (true);

drop policy if exists "service_role_signals_all" on public.signals;
create policy "service_role_signals_all"
  on public.signals
  for all
  to service_role
  using (true)
  with check (true);

grant select, insert, update on table public.paper_trades to service_role;
grant select, update on table public.portfolio_state to service_role;
grant select, insert on table public.portfolio_snapshots to service_role;
grant select on table public.open_trades_with_signal to service_role;
grant execute on function public.take_portfolio_snapshot() to service_role;

alter table public.paper_trades enable row level security;
alter table public.portfolio_state enable row level security;
alter table public.portfolio_snapshots enable row level security;

drop policy if exists "service_role_paper_trades_all" on public.paper_trades;
create policy "service_role_paper_trades_all"
  on public.paper_trades
  for all
  to service_role
  using (true)
  with check (true);

drop policy if exists "service_role_portfolio_state_all" on public.portfolio_state;
create policy "service_role_portfolio_state_all"
  on public.portfolio_state
  for all
  to service_role
  using (true)
  with check (true);

drop policy if exists "service_role_portfolio_snapshots_all" on public.portfolio_snapshots;
create policy "service_role_portfolio_snapshots_all"
  on public.portfolio_snapshots
  for all
  to service_role
  using (true)
  with check (true);
