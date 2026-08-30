-- Server-managed tables must never be reachable through the public Data API.
-- All application access to these tables uses the server-only Supabase key,
-- which bypasses RLS.

ALTER TABLE public.mux_items ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.admin_actions ENABLE ROW LEVEL SECURITY;

COMMENT ON TABLE public.mux_items IS
  'Server-managed media catalog. Public access is blocked by RLS.';

COMMENT ON TABLE public.admin_actions IS
  'Server-managed audit log. Public access is blocked by RLS.';
