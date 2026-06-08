-- Allow the backend Supabase service key to run the paper-trading MVP loop.
-- This extends the ingestion/signal permissions to the tables and objects used by:
--   POST /api/trades/execute
--   POST /api/trades/close-expired
--   GET /api/trades/portfolio
--   GET /api/trades/open
--   GET /api/trades/history
--   GET /api/reports/snapshots

grant usage on schema public to service_role;

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
