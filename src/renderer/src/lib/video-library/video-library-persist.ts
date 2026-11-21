// ─── Chuẩn hoá item Kho video khi nạp từ Supabase — dọn trạng thái "treo" ────
// Không còn lưu localStorage — Supabase là nguồn dữ liệu duy nhất (xem video-library-context.tsx).

import type { VideoLibraryItem } from '@/lib/video-library/video-library';
import type { VideoScene } from '@/lib/scene/scenes';

/** Khớp VEO_MAX_POLL_MS (10 phút) + buffer — poll tab đã đóng thì không bao giờ kết luận. */
const STALE_GENERATING_MS = 15 * 60 * 1000;
const STALE_GENERATING_MESSAGE =
  'Tạo video đã dừng vì đóng trang hoặc mất kết nối quá lâu. Bấm Tạo lại để chạy lại cảnh này.';
const ORPHAN_GENERATING_MESSAGE =
  'Tạo video bị gián đoạn (không còn task đang chạy). Bấm Tạo lại để chạy lại cảnh này.';

function expireStaleGeneratingScene(s: VideoScene): VideoScene {
  if (s.status !== 'generating') return s;
  if (!s.veoTaskId?.trim()) {
    return { ...s, status: 'error', errorMessage: s.errorMessage || ORPHAN_GENERATING_MESSAGE };
  }
  const started = s.veoTaskStartedAt ? Date.parse(s.veoTaskStartedAt) : NaN;
  if (!Number.isNaN(started) && Date.now() - started > STALE_GENERATING_MS) {
    return { ...s, status: 'error', errorMessage: STALE_GENERATING_MESSAGE };
  }
  return s;
}

/** Dọn trạng thái "treo" (generating mồ côi, không operation, không video) khi nạp item từ Supabase */
export function normalizeItemOnLoad(item: VideoLibraryItem): VideoLibraryItem {
  const scenes = item.scenes.map((s) => {
    // CHỈ xử lý orphan khi status GỐC (từ DB) đã là 'generating' (app đóng/crash
    // giữa lúc đang chờ Veo). 'success'/'error'/'edited' giữ nguyên tuyệt đối —
    // KHÔNG được suy luận lại dựa vào videoUrl/veoTaskId ở đây:
    //  - videoUrl (blob:) KHÔNG BAO GIỜ sống sót qua reload, dù cảnh nào —
    //    dùng `!s.videoUrl` làm điều kiện sẽ đúng cho MỌI cảnh ngay sau khi tải
    //    từ Supabase, kể cả cảnh đã 'success' — sẽ vô tình lật cảnh đã xong
    //    thành 'generating' trở lại (bug đã xảy ra thực tế).
    //  - veoTaskId giờ là audit trail vĩnh viễn (không xoá khi success/error —
    //    xem scenes.ts), không còn là tín hiệu "đang chạy" đáng tin cậy một
    //    mình, càng không được dùng để ghi đè status đã có kết luận.
    //  - Task quá 15 phút mà vẫn 'generating' = poll đã chết (đóng tab 1–2 ngày)
    //    — hết hạn ngay, không để spinner quay mãi.
    return expireStaleGeneratingScene(s);
  });

  let status = item.status;
  if (status === 'analyzing') status = 'draft';
  // Dùng status ĐÃ chuẩn hoá ở trên ('generating' thật sự = chưa có kết luận), KHÔNG
  // dùng raw veoTaskId — vì veoTaskId giờ là audit trail vĩnh viễn (giữ lại cả khi cảnh
  // đã success/error), không còn là tín hiệu "còn đang chạy" đáng tin cậy một mình.
  if (status === 'generating' && !scenes.some((s) => s.status === 'generating')) {
    const done = scenes.filter((s) => s.status === 'success').length;
    status = done === scenes.length && scenes.length > 0 ? 'completed' : 'error';
  }

  return {
    ...item,
    status,
    scenes,
    scenesDone: scenes.filter((s) => s.status === 'success' || s.status === 'error').length,
    scenesTotal: scenes.length,
    timelineFocusSceneId: null,
    // Regenerate không bao giờ sống sót qua reload — luôn reset sạch khi load lại
    isRegenerating: false,
    pendingRegeneration: null,
    regenerateError: undefined,
  };
}
