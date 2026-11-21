// ─── Số dư credit THẬT của user (profiles.system_credit) — đọc trực tiếp qua Supabase client ──
// RLS `profiles_select_own` (migration 0002) đã cho phép user tự đọc đúng dòng profiles của
// mình — không cần route backend riêng cho việc chỉ đọc số dư này.

import type { SupabaseClient } from '@supabase/supabase-js';

/** Số dư credit hiện tại của user — trả 0 nếu vì lý do gì đó chưa có row profiles (không nên xảy ra) */
export async function fetchUserCredit(supabase: SupabaseClient, userId: string): Promise<number> {
  const { data, error } = await supabase
    .from('profiles')
    .select('system_credit')
    .eq('id', userId)
    .maybeSingle();

  if (error) throw error;
  return data?.system_credit ?? 0;
}
