import type { Session, SupabaseClient } from '@supabase/supabase-js';

/** Lấy phiên Supabase hiện tại; thử refresh 1 lần nếu hết hạn. */
export async function ensureSupabaseSession(supabase: SupabaseClient): Promise<Session | null> {
  const { data: { session } } = await supabase.auth.getSession();
  if (session) return session;

  const { data: { session: refreshed } } = await supabase.auth.refreshSession();
  return refreshed;
}

export function isSupabaseAuthError(err: unknown): boolean {
  if (!err || typeof err !== 'object') return false;
  const e = err as { code?: string; message?: string; status?: number };
  if (e.status === 401 || e.status === 403) return true;
  if (e.code === 'PGRST301' || e.code === '42501') return true;
  return /jwt|session|row-level security|not authenticated/i.test(e.message ?? '');
}
