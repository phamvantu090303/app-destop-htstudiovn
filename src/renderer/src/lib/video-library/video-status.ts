// ─── Nguồn sự thật duy nhất cho nhãn + màu trạng thái video — trước đây rải  ───
// ─── rác ở video-library-view.tsx, page.tsx với 3 hệ màu hơi khác nhau      ───

import type { VideoLibraryStatus } from './video-library';

export interface StatusMeta {
  label: string;
  /** Màu chữ dùng cho text trạng thái, số tiến độ... */
  text: string;
  /** Màu nền dùng cho progress-bar fill, dot... */
  bg: string;
  /** class đầy đủ cho 1 badge dạng pill (nền nhạt + chữ + viền) */
  badge: string;
}

/** Giữ nguyên đúng các màu đã dùng trong code cũ (orange/green/destructive) — chỉ gom về 1 nơi. */
export const STATUS_META: Record<VideoLibraryStatus, StatusMeta> = {
  draft: {
    label: 'Nháp',
    text: 'text-muted-foreground',
    bg: 'bg-muted-foreground',
    badge: 'bg-muted/40 text-muted-foreground border-border',
  },
  analyzing: {
    label: 'Đang phân tích',
    text: 'text-orange-400',
    bg: 'bg-orange-500',
    badge: 'bg-orange-500/15 text-orange-300 border-orange-500/25',
  },
  generating: {
    label: 'Đang tạo video',
    text: 'text-orange-400',
    bg: 'bg-orange-500',
    badge: 'bg-orange-500/15 text-orange-300 border-orange-500/25',
  },
  completed: {
    label: 'Hoàn thành',
    text: 'text-green-400',
    bg: 'bg-green-500',
    badge: 'bg-green-500/15 text-green-300 border-green-500/25',
  },
  error: {
    label: 'Lỗi',
    text: 'text-destructive',
    bg: 'bg-destructive',
    badge: 'bg-destructive/15 text-destructive border-destructive/25',
  },
};

export function isRunningStatus(status: VideoLibraryStatus): boolean {
  return status === 'analyzing' || status === 'generating';
}
