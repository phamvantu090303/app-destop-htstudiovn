'use client';

// ─── Ước tính chi phí credit TRƯỚC khi bấm tạo — chỉ để disable nút + cảnh báo sớm (UX) ───────
// Chốt thật ở backend (gemini.route.ts /analyze, veo.route.ts /generate/start) — hook này CHỈ
// là tiện ích hiển thị, ai gọi thẳng API vẫn bị chặn đúng ở đó bất kể FE có hook này hay không.
// Giá LUÔN đọc trực tiếp từ model_pricing.system_credit (admin có thể đổi bất cứ lúc nào ở
// /admin/packages) — KHÔNG hard-code số credit theo model ở đây.

import { useEffect, useRef, useState } from 'react';
import { createClient } from '@/lib/supabase/client';
import { fetchModelSystemCredit, resolveKieModelId } from '@/lib/credits/model-pricing-remote';

export interface EstimatedVideoCost {
  loading: boolean;
  /** Giá 1 cảnh theo model đang chọn (system_credit) — null khi chưa tải xong, hoặc provider BYOK (không áp dụng) */
  unitCredit: number | null;
  /** sceneCount × unitCredit — số credit tối thiểu cần có để không bị chặn */
  requiredCredit: number | null;
}

/**
 * Chỉ tính chi phí cho provider 'veo' (kie.ai, dùng key hệ thống — nơi DUY NHẤT tốn
 * system_credit). 'veo-gemini' (BYOK, tự trả tiền Google) luôn trả về mọi field `null`.
 */
export function useEstimatedVideoCost(
  provider: string,
  veoModel: string | undefined,
  sceneCount: number,
): EstimatedVideoCost {
  const supabaseRef = useRef(createClient());
  const [unitCredit, setUnitCredit] = useState<number | null>(null);
  const [loading, setLoading] = useState(provider === 'veo');

  useEffect(() => {
    const supabase = supabaseRef.current;
    if (provider !== 'veo' || !supabase) {
      setUnitCredit(null);
      setLoading(false);
      return;
    }
    let cancelled = false;
    setLoading(true);
    const model = resolveKieModelId(veoModel);
    fetchModelSystemCredit(supabase, 'veo', model)
      .then((credit) => {
        if (!cancelled) setUnitCredit(credit);
      })
      .catch((err) => {
        console.error('[use-estimated-video-cost] Tải giá model thất bại:', err);
        if (!cancelled) setUnitCredit(null);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [provider, veoModel]);

  const requiredCredit =
    provider === 'veo' && unitCredit !== null && sceneCount > 0 ? sceneCount * unitCredit : null;

  return { loading, unitCredit, requiredCredit };
}
