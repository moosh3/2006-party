import { createClient } from '@supabase/supabase-js';

// A syntactically valid local endpoint keeps static builds and the UI preview
// working before credentials exist. API routes already detect missing env vars
// and return development data; real deployments still use the supplied values.
const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL || 'http://127.0.0.1:54321';
const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || 'local-preview-anon-key';

// Client-side Supabase client (safe for browser use)
export const supabase = createClient(supabaseUrl, supabaseAnonKey);
