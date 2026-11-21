'use client';

import * as React from 'react';
import { Toast } from '@base-ui/react/toast';
import { CheckCircle2, AlertCircle, AlertTriangle, Info, X } from 'lucide-react';
import { cn } from '@/lib/utils';
import { mapAppError, type AppError } from '@/lib/error-messages';

type ToastVariant = 'success' | 'error' | 'warning' | 'info';

const VARIANT_ICON: Record<ToastVariant, React.ComponentType<{ className?: string }>> = {
  success: CheckCircle2,
  error: AlertCircle,
  warning: AlertTriangle,
  info: Info,
};

const VARIANT_ICON_CLASS: Record<ToastVariant, string> = {
  success: 'text-green-400',
  error: 'text-destructive',
  warning: 'text-amber-400',
  info: 'text-primary',
};

function ToastList() {
  const { toasts } = Toast.useToastManager();

  return toasts.map((toast) => {
    const variant = (toast.type as ToastVariant) ?? 'info';
    const Icon = VARIANT_ICON[variant] ?? Info;
    return (
      <Toast.Root
        key={toast.id}
        toast={toast}
        className={cn(
          'relative flex w-full max-w-sm gap-2.5 rounded-xl border bg-card p-3.5 pr-8 shadow-2xl',
          'transition-all duration-200 ease-out',
          'data-[starting-style]:opacity-0 data-[starting-style]:translate-y-2',
          'data-[ending-style]:opacity-0 data-[ending-style]:translate-x-6',
          variant === 'error' && 'border-destructive/40',
          variant === 'success' && 'border-green-500/40',
          variant === 'warning' && 'border-amber-500/40',
          variant === 'info' && 'border-primary/30',
        )}
      >
        <Icon className={cn('w-4 h-4 shrink-0 mt-0.5', VARIANT_ICON_CLASS[variant])} />
        <div className="min-w-0 flex-1">
          {toast.title && <Toast.Title className="text-sm font-bold text-foreground leading-snug" />}
          {toast.description && (
            <Toast.Description className="mt-0.5 text-xs text-muted-foreground leading-relaxed" />
          )}
          {toast.actionProps && (
            <Toast.Action className="mt-2 inline-block text-xs font-semibold text-primary hover:underline underline-offset-2 cursor-pointer" />
          )}
        </div>
        <Toast.Close
          aria-label="Đóng thông báo"
          className="absolute right-2.5 top-2.5 text-muted-foreground hover:text-foreground transition-colors cursor-pointer"
        >
          <X className="w-3.5 h-3.5" />
        </Toast.Close>
      </Toast.Root>
    );
  });
}

/** Provider toast toàn app — mount 1 lần ở root layout. Dựng trên `@base-ui/react/toast` (đã có sẵn
 *  trong dependencies, chưa từng được dùng) thay vì thêm sonner/react-hot-toast — tránh dependency mới. */
export function AppToastProvider({ children }: { children: React.ReactNode }) {
  return (
    <Toast.Provider limit={4}>
      {children}
      <Toast.Portal>
        <Toast.Viewport className="fixed bottom-4 right-4 z-(--z-toast) flex w-full max-w-sm flex-col gap-2 outline-none sm:bottom-6 sm:right-6">
          <ToastList />
        </Toast.Viewport>
      </Toast.Portal>
    </Toast.Provider>
  );
}

interface AppErrorToastOptions {
  status?: number;
  provider?: string;
  retryAfterSeconds?: number;
  /** Gọi khi user bấm nút hành động (Thử lại/Đi tới API Keys...) — nếu không truyền, toast vẫn hiện
   *  actionLabel nhưng không làm gì khi bấm (fallback: chỉ đóng toast). */
  onAction?: () => void;
}

/** Hook tiện dụng bọc `Toast.useToastManager()` — dùng cho phản hồi cấp "toast" (hành động nền,
 *  không chặn luồng). Lỗi luôn đi qua `mapAppError()` nên không bao giờ lộ message backend thô. */
export function useAppToast() {
  const manager = Toast.useToastManager();

  const success = React.useCallback((title: string, description?: string) => {
    manager.add({ title, description, type: 'success', timeout: 4000 });
  }, [manager]);

  const info = React.useCallback((title: string, description?: string) => {
    manager.add({ title, description, type: 'info', timeout: 4000 });
  }, [manager]);

  const warning = React.useCallback((title: string, description?: string) => {
    manager.add({ title, description, type: 'warning', timeout: 5000 });
  }, [manager]);

  const error = React.useCallback((err: unknown, options: AppErrorToastOptions = {}) => {
    const mapped: AppError = mapAppError(err, options);
    manager.add({
      title: mapped.title,
      description: mapped.description,
      type: 'error',
      timeout: mapped.actionLabel ? 8000 : 5000,
      actionProps: mapped.actionLabel
        ? { children: mapped.actionLabel, onClick: options.onAction }
        : undefined,
    });
  }, [manager]);

  return { success, error, warning, info, manager };
}
