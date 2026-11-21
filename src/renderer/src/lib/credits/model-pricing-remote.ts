// ─── Giá credit theo model (bảng model_pricing) — đọc trực tiếp qua Supabase client ───────────
// RLS `model_pricing_select_active` (migration 0015) đã cho phép public đọc các model đang bán,
// nên không cần route backend riêng cho việc chỉ đọc giá này (khớp cách fetchUserCredit ở
// user-credits-remote.ts đọc thẳng profiles.system_credit).

import type { SupabaseClient } from '@supabase/supabase-js';

/** 3 model id THẬT của kie.ai (provider 'veo') — khớp VEO_GENERATE_MODELS ở
 *  backend/src/lib/veo-config.ts. 'veo-gemini' (Google trực tiếp) BYOK, chưa seed giá. */
const KIE_VEO_MODEL_IDS = new Set(['veo3', 'veo3_fast', 'veo3_lite']);

/** Mirror resolveVeoModel() ở backend/src/lib/veo-config.ts — id lạ/rỗng rơi về 'veo3_fast' để
 *  luôn ước tính được 1 con số hợp lý thay vì chặn hiển thị vì thiếu model. */
export function resolveKieModelId(veoModel: string | undefined): string {
  const picked = veoModel?.trim();
  return picked && KIE_VEO_MODEL_IDS.has(picked) ? picked : 'veo3_fast';
}

/** Giá credit thu của user cho 1 cảnh dùng `model` của `provider` này — `null` nếu chưa có giá. */
export async function fetchModelSystemCredit(
  supabase: SupabaseClient,
  provider: string,
  model: string,
): Promise<number | null> {
  const { data, error } = await supabase
    .from('model_pricing')
    .select('system_credit')
    .eq('provider', provider)
    .eq('model', model)
    .eq('status', true)
    .maybeSingle();

  if (error) throw error;
  return data?.system_credit ?? null;
}
