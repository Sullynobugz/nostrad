-- Reset-Berechtigungen für service_role
-- Ausführen im Supabase SQL Editor
-- Erlaubt DELETE auf allen Paper-Trading-Tabellen

grant delete on table public.paper_trades        to service_role;
grant delete on table public.signals             to service_role;
grant delete on table public.events              to service_role;
grant delete on table public.portfolio_snapshots to service_role;
grant delete on table public.engine_performance  to service_role;
grant delete on table public.post_mortems        to service_role;
