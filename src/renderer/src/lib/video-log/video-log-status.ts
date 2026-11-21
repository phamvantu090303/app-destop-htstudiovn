// ─── Nguồn sự thật duy nhất cho nhãn + màu trạng thái dòng Nhật Ký ──────────────
// Gồm 5 state thật của kie.ai (waiting/queuing/generating/success/fail) + 2 pseudo-state
// riêng của UI (loading = đang tải chi tiết, error = tải chi tiết thất bại) — tách biệt
// với STATUS_META của video-library (khác domain: đó là trạng thái project/scene nội bộ,
// đây là trạng thái TASK kie.ai trả về qua Get Task Details).

export type VideoLogRowStatus = 'loading' | 'waiting' | 'queuing' | 'generating' | 'success' | 'fail' | 'error';

export interface VideoLogStatusMeta {
  label: string;
  badge: string;
  /** Màu chấm tròn nhỏ đặt trước label trong badge — thêm 1 lớp phân biệt nhanh bằng mắt */
  dot: string;
}

export const VIDEO_LOG_STATUS_META: Record<VideoLogRowStatus, VideoLogStatusMeta> = {
  loading: {
    label: 'Đang tải...',
    badge: 'bg-muted/40 text-muted-foreground border-border',
    dot: 'bg-muted-foreground',
  },
  waiting: {
    label: 'Đang chờ',
    badge: 'bg-orange-500/15 text-orange-300 border-orange-500/25',
    dot: 'bg-orange-400',
  },
  queuing: {
    label: 'Trong hàng đợi',
    badge: 'bg-orange-500/15 text-orange-300 border-orange-500/25',
    dot: 'bg-orange-400',
  },
  generating: {
    label: 'Đang xử lý',
    badge: 'bg-orange-500/15 text-orange-300 border-orange-500/25',
    dot: 'bg-orange-400',
  },
  success: {
    label: 'Thành công',
    badge: 'bg-green-500/15 text-green-300 border-green-500/25',
    dot: 'bg-green-400',
  },
  fail: {
    label: 'Thất bại',
    badge: 'bg-destructive/15 text-destructive border-destructive/25',
    dot: 'bg-destructive',
  },
  error: {
    label: 'Không tải được',
    badge: 'bg-destructive/15 text-destructive border-destructive/25',
    dot: 'bg-destructive',
  },
};

/** Lọc trạng thái cho dropdown filter — gộp waiting/queuing/generating thành 1 lựa chọn "Đang xử lý" */
export type VideoLogStatusFilter = 'all' | 'processing' | 'success' | 'fail';

export const VIDEO_LOG_STATUS_FILTER_OPTIONS: { value: VideoLogStatusFilter; label: string }[] = [
  { value: 'all', label: 'Tất cả trạng thái' },
  { value: 'processing', label: 'Đang xử lý' },
  { value: 'success', label: 'Thành công' },
  { value: 'fail', label: 'Thất bại' },
];

export function matchesStatusFilter(status: VideoLogRowStatus | undefined, filter: VideoLogStatusFilter): boolean {
  if (filter === 'all') return true;
  if (!status) return false;
  if (filter === 'processing') return status === 'waiting' || status === 'queuing' || status === 'generating' || status === 'loading';
  return status === filter;
}
