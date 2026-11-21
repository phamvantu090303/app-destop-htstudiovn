// ─── Kế hoạch crossfade giữa các cảnh — dùng cho render FFmpeg (xfade/acrossfade) ──
//
// Crossfade thật giữa 2 clip làm timeline "co lại" đúng bằng phần chồng lấn (mỗi
// điểm nối tốn `duration` giây chung giữa 2 clip thay vì cắt cứng nối tiếp). Hàm
// này tính offset/khoảng chồng cho từng điểm nối + mốc bắt đầu "thực" của mỗi cảnh
// trên timeline đã co lại — mốc này dùng để đặt lại track lời thoại (adelay) cho
// khớp với video, tránh lệch tiếng dần về cuối video khi có nhiều điểm chuyển cảnh.

export interface TransitionPlanEntry {
  /** Mốc bắt đầu thật của cảnh trên timeline đã co lại vì crossfade (giây) */
  start: number;
  duration: number;
}

export interface TransitionPlan {
  entries: TransitionPlanEntry[];
  /** Độ dài crossfade thật giữa cảnh i và i+1 (đã kẹp an toàn) — length = entries.length - 1 */
  pairDurations: number[];
  /** Tổng thời lượng video sau khi co lại vì crossfade */
  totalDuration: number;
}

const MIN_TRANSITION_SEC = 0.05;
/** Đệm an toàn — không để crossfade ăn hết 1 clip cực ngắn */
const SAFETY_MARGIN_SEC = 0.05;

/** Tính kế hoạch crossfade — trả về hard-cut (pairDurations toàn 0) nếu transitionSec <= 0 hoặc chỉ 1 cảnh */
export function buildTransitionPlan(durations: number[], transitionSec: number): TransitionPlan {
  const n = durations.length;
  if (n === 0) return { entries: [], pairDurations: [], totalDuration: 0 };

  if (n === 1 || transitionSec <= 0) {
    let cursor = 0;
    const entries = durations.map((duration) => {
      const entry = { start: cursor, duration };
      cursor += duration;
      return entry;
    });
    return { entries, pairDurations: [], totalDuration: cursor };
  }

  const entries: TransitionPlanEntry[] = [{ start: 0, duration: durations[0] }];
  const pairDurations: number[] = [];
  let cursor = durations[0];

  for (let i = 1; i < n; i++) {
    const maxD = Math.min(durations[i - 1], durations[i]) - SAFETY_MARGIN_SEC;
    const d = maxD >= MIN_TRANSITION_SEC ? Math.max(0, Math.min(transitionSec, maxD)) : 0;
    pairDurations.push(d);

    const start = cursor - d;
    entries.push({ start, duration: durations[i] });
    cursor = cursor + durations[i] - d;
  }

  return { entries, pairDurations, totalDuration: cursor };
}
