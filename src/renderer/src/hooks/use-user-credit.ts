'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { useAuth } from '@/contexts/auth-context';
import { createClient } from '@/lib/supabase/client';
import { fetchUserCredit } from '@/lib/credits/user-credits-remote';

/** Bắn sự kiện này ngay sau khi biết chắc số dư credit của user vừa đổi (trừ lúc bắt đầu tạo
 *  video, hoàn khi tạo thất bại...) — SidebarCreditsCard và mọi nơi hiển thị số dư khác lắng
 *  nghe để tự tải lại, không cần truyền prop xuyên nhiều tầng component. */
export const CREDIT_CHANGED_EVENT = 'web-video-credit-changed';

export function notifyCreditChanged(): void {
  if (typeof window !== 'undefined') {
    window.dispatchEvent(new CustomEvent(CREDIT_CHANGED_EVENT));
  }
}

/** Poll dự phòng — phòng khi có chỗ nào đổi số dư mà quên bắn CREDIT_CHANGED_EVENT (vd hoàn
 *  credit xảy ra ở 1 lượt poll không đi qua đúng callback), không phải nguồn cập nhật chính. */
const FALLBACK_POLL_MS = 30_000;

/** Số dư credit hiện tại của user đăng nhập — `null` khi chưa đăng nhập/chưa tải xong. */
export function useUserCredit(): number | null {
  const { user } = useAuth();
  const supabaseRef = useRef(createClient());
  const [credit, setCredit] = useState<number | null>(null);

  const refresh = useCallback(() => {
    const supabase = supabaseRef.current;
    if (!user || !supabase) {
      setCredit(null);
      return;
    }
    fetchUserCredit(supabase, user.id)
      .then(setCredit)
      .catch((err) => console.error('[use-user-credit] Tải số dư credit thất bại:', err));
  }, [user]);

  useEffect(() => {
    refresh();
    window.addEventListener(CREDIT_CHANGED_EVENT, refresh);
    const intervalId = setInterval(refresh, FALLBACK_POLL_MS);
    return () => {
      window.removeEventListener(CREDIT_CHANGED_EVENT, refresh);
      clearInterval(intervalId);
    };
  }, [refresh]);

  return credit;
}
