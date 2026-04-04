// src/lib/supabase.js
import { createClient } from '@supabase/supabase-js';

const {
  SUPABASE_URL,
  SUPABASE_SERVICE_ROLE_KEY,
  SUPABASE_ANON_KEY,
} = process.env;

if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
  console.error('\n❌  MISSING ENV VARS — check api/.env\n');
  console.error('   SUPABASE_URL:              ', SUPABASE_URL        ? '✓ set' : '✗ missing');
  console.error('   SUPABASE_SERVICE_ROLE_KEY: ', SUPABASE_SERVICE_ROLE_KEY ? '✓ set' : '✗ missing');
  console.error('   SUPABASE_ANON_KEY:         ', SUPABASE_ANON_KEY   ? '✓ set' : '✗ missing');
  console.error('\n   Get them from: Supabase Dashboard → Settings → API\n');
  process.exit(1);
}

// Service-role client — bypasses RLS, server-side only
export const sb = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
  auth: { autoRefreshToken: false, persistSession: false },
});

// Anon client — for public reads
export const sbAnon = createClient(SUPABASE_URL, SUPABASE_ANON_KEY || SUPABASE_SERVICE_ROLE_KEY);

