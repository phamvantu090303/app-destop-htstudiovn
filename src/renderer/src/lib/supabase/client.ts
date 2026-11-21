// ─── Supabase client (desktop) ───────────────────────────────────────────────
//
// Differs from the web version on purpose:
//  - Plain `@supabase/supabase-js` instead of `@supabase/ssr`: the SSR helper stores the session in
//    cookies, which do not work for a custom-scheme origin (`htstudio://app`). localStorage does.
//  - Google sign-in runs in the system browser and returns through a deep link, so the URL is never
//    parsed by the client (`detectSessionInUrl: false`); the code is exchanged explicitly in
//    contexts/auth-context.tsx.
//  - Singleton: several modules call createClient(); two instances would fight over one session.

import { createClient as createSupabaseClient, type SupabaseClient } from '@supabase/supabase-js';

let instance: SupabaseClient | null | undefined;

/**
 * Returns `null` when Supabase is not configured (missing VITE_SUPABASE_* in .env) instead of
 * throwing, so the app can still render and explain what is missing.
 */
export function createClient(): SupabaseClient | null {
  if (instance !== undefined) return instance;

  const url = import.meta.env.VITE_SUPABASE_URL;
  const key = import.meta.env.VITE_SUPABASE_ANON_KEY;

  instance =
    url && key
      ? createSupabaseClient(url, key, {
          auth: {
            flowType: 'pkce',
            persistSession: true,
            autoRefreshToken: true,
            detectSessionInUrl: false,
          },
        })
      : null;

  return instance;
}
