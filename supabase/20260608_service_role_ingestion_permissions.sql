-- Allow the backend Supabase service key to validate ingestion and signal generation.
-- This is intentionally limited to the tables used by:
--   POST /api/ingest/run
--   POST /api/signals/process-queue
--   POST /api/signals/generate

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
