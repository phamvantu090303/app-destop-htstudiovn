import { AlertCircle } from 'lucide-react';
import { cn } from '@/lib/utils';
import type { AppError } from '@/lib/error-messages';

interface ErrorBannerProps {
  error: AppError;
  onAction?: () => void;
  className?: string;
}

/** Banner lỗi cấp toàn trang — đủ 3 phần (chuyện gì/vì sao/làm gì tiếp theo) từ `mapAppError()`.
 *  Dùng khi 1 danh sách/khu vực chính không tải được (khác với FieldError — lỗi 1 field cụ thể). */
export function ErrorBanner({ error, onAction, className }: ErrorBannerProps) {
  return (
    <div
      role="alert"
      className={cn('flex items-start gap-3 rounded-xl border border-destructive/40 bg-destructive/10 p-4', className)}
    >
      <AlertCircle className="w-5 h-5 text-destructive shrink-0 mt-0.5" />
      <div className="min-w-0 flex-1">
        <p className="text-sm font-bold text-foreground">{error.title}</p>
        {error.description && (
          <p className="mt-1 text-xs text-muted-foreground leading-relaxed">{error.description}</p>
        )}
        {error.actionLabel && onAction && (
          <button
            type="button"
            onClick={onAction}
            className="mt-3 inline-flex items-center gap-1.5 rounded-lg bg-destructive/15 hover:bg-destructive/25 px-3 py-1.5 text-xs font-semibold text-destructive transition-colors cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-destructive/60 focus-visible:ring-offset-2 focus-visible:ring-offset-background"
          >
            {error.actionLabel}
          </button>
        )}
      </div>
    </div>
  );
}
