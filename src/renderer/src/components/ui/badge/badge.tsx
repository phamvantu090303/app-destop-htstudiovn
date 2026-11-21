import * as React from 'react';
import { cva, type VariantProps } from 'class-variance-authority';
import { cn } from '@/lib/utils';

/**
 * Trích xuất từ tổ hợp className badge đang lặp tay ở nhiều nơi (video-log-view, scene-gallery,
 * video-library) — giữ nguyên kích thước/bo góc đã dùng, chỉ gom màu về 1 nguồn.
 *
 * Lưu ý: các trạng thái ĐÃ có bảng màu riêng (`lib/video-library/video-status.ts`,
 * `lib/video-log/video-log-status.ts`) thì dùng thẳng `badge` của bảng đó, KHÔNG map lại
 * sang tone ở đây — tránh tạo hệ màu thứ ba cho cùng một khái niệm.
 */
const badgeVariants = cva(
  'inline-flex items-center gap-1.5 text-[10px] font-semibold px-2 py-0.5 rounded-full border whitespace-nowrap',
  {
    variants: {
      tone: {
        neutral: 'bg-muted/40 text-muted-foreground border-border',
        success: 'bg-emerald-500/10 text-emerald-400 border-emerald-500/30',
        warning: 'bg-amber-500/10 text-amber-400 border-amber-500/30',
        danger: 'bg-destructive/10 text-destructive border-destructive/30',
        info: 'bg-sky-500/10 text-sky-400 border-sky-500/30',
        purple: 'bg-indigo-500/15 text-indigo-300 border-indigo-500/25',
      },
    },
    defaultVariants: { tone: 'neutral' },
  },
);

const DOT_CLASS: Record<NonNullable<BadgeProps['tone']>, string> = {
  neutral: 'bg-muted-foreground',
  success: 'bg-emerald-400',
  warning: 'bg-amber-400',
  danger: 'bg-destructive',
  info: 'bg-sky-400',
  purple: 'bg-indigo-400',
};

export interface BadgeProps
  extends React.HTMLAttributes<HTMLSpanElement>,
    VariantProps<typeof badgeVariants> {
  /** Chấm tròn nhỏ trước label — thêm 1 lớp phân biệt nhanh bằng mắt ngoài màu chữ */
  dot?: boolean;
  /** Chấm nhấp nháy — chỉ dùng cho cảnh báo cần hành động ngay (vd đơn tồn quá hạn) */
  pulse?: boolean;
}

export function Badge({ tone, dot, pulse, className, children, ...rest }: BadgeProps) {
  return (
    <span {...rest} className={cn(badgeVariants({ tone }), className)}>
      {dot && (
        <span
          className={cn('w-1.5 h-1.5 rounded-full shrink-0', DOT_CLASS[tone ?? 'neutral'], pulse && 'animate-pulse')}
          aria-hidden
        />
      )}
      {children}
    </span>
  );
}
