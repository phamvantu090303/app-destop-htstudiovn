import * as React from 'react';
import { Loader2 } from 'lucide-react';
import { cva, type VariantProps } from 'class-variance-authority';
import { cn } from '@/lib/utils';

/**
 * Trích xuất từ các tổ hợp className đang lặp lại tay ở nhiều nơi (CTA cam, nút phụ viền,
 * nút text, nút phá huỷ, icon-only) — không đổi màu/kích thước nào so với những gì đã dùng,
 * chỉ gom về 1 nguồn. `class-variance-authority` đã có sẵn trong dependencies từ trước,
 * chưa từng được dùng — đây là component đầu tiên dùng tới.
 */
export const buttonVariants = cva(
  [
    'inline-flex items-center justify-center gap-1.5 font-bold rounded-lg transition-colors',
    'cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed disabled:pointer-events-none',
    'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/60',
    'focus-visible:ring-offset-2 focus-visible:ring-offset-background',
  ].join(' '),
  {
    variants: {
      variant: {
        /** CTA chính — cam, dùng cho hành động chủ đích (Tạo video, Xem chi tiết...) */
        primary: 'bg-orange-500 hover:bg-orange-600 text-white',
        /** CTA phụ màu thương hiệu (tím) — dùng khi không phải luồng tạo video chính */
        accent: 'bg-primary hover:bg-primary/90 text-primary-foreground',
        /** Có viền, nền card — dùng cho hành động thứ 2 cạnh 1 CTA chính (vd "Lưu" cạnh "Lưu & tạo lại") */
        outline: 'bg-card border border-border text-foreground hover:border-primary/40 hover:text-primary font-semibold',
        /** Không nền/viền — hành động phụ nhẹ (Huỷ, đóng modal) */
        ghost: 'text-muted-foreground hover:text-foreground hover:bg-muted/50 font-semibold',
        /** Hành động phá huỷ rõ ràng — nền đỏ đặc, dùng khi cần nổi bật cảnh báo (nút xác nhận Xoá trong dialog) */
        danger: 'bg-destructive hover:bg-destructive/90 text-white',
        /** Hành động phá huỷ nhẹ — chỉ đổi màu chữ khi hover, KHÔNG đặt ngang hàng CTA chính (vd "Xóa toàn bộ" cạnh "Tạo video mới") */
        'ghost-danger': 'text-muted-foreground hover:text-destructive font-medium',
        /** Icon-only trung tính, hover ngả sang primary (vd nút Sửa trên card) */
        'icon-ghost': 'text-muted-foreground hover:text-primary hover:bg-primary/10',
        /** Icon-only trung tính, hover ngả sang đỏ (vd nút Xoá trên card) */
        'icon-danger': 'text-muted-foreground hover:text-destructive hover:bg-destructive/10',
      },
      size: {
        sm: 'px-3 py-1.5 text-xs',
        md: 'px-4 py-2 text-sm',
        lg: 'px-5 py-2.5 text-sm',
        icon: 'p-2',
      },
    },
    defaultVariants: {
      variant: 'primary',
      size: 'md',
    },
  },
);

export interface ButtonProps
  extends React.ButtonHTMLAttributes<HTMLButtonElement>,
    VariantProps<typeof buttonVariants> {
  /** Hiện spinner + tự disable — dùng khi đang submit async, tránh double-click */
  loading?: boolean;
}

export const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(
  ({ className, variant, size, loading, disabled, children, type = 'button', ...props }, ref) => {
    return (
      <button
        ref={ref}
        type={type}
        disabled={disabled || loading}
        className={cn(buttonVariants({ variant, size }), className)}
        {...props}
      >
        {loading && <Loader2 className="w-3.5 h-3.5 animate-spin" />}
        {children}
      </button>
    );
  },
);
Button.displayName = 'Button';
