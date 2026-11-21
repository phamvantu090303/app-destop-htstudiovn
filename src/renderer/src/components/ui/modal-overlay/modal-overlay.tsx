'use client';

import { useEffect, useRef } from 'react';
import { cn } from '@/lib/utils';

interface ModalOverlayProps {
  onClose: () => void;
  children: React.ReactNode;
  /** Mặc định `bg-black/70 backdrop-blur-sm` — truyền khi cần opacity khác (VD: confirm dialog dùng /60) */
  backdropClassName?: string;
  onKeyDown?: (e: React.KeyboardEvent) => void;
}

const FOCUSABLE_SELECTOR =
  'a[href], button:not([disabled]), textarea:not([disabled]), input:not([disabled]), select:not([disabled]), [tabindex]:not([tabindex="-1"])';

/** Lớp phủ full-screen + backdrop click-để-đóng dùng chung cho các modal — bẫy phím Tab trong
 * nội dung modal (không cho bàn phím thoát ra nền phía sau), tự focus phần tử đầu tiên khi mở
 * và trả focus lại phần tử đã kích hoạt modal khi đóng. Escape mặc định đóng modal — các nơi gọi
 * cũ vẫn có thể truyền thêm `onKeyDown` riêng (chạy trước, không xung đột vì `onClose` ở các chỗ
 * đó cũng chính là handler Escape của họ). */
export function ModalOverlay({ onClose, children, backdropClassName = 'bg-black/70 backdrop-blur-sm', onKeyDown }: ModalOverlayProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const previouslyFocused = useRef<HTMLElement | null>(null);

  useEffect(() => {
    previouslyFocused.current = document.activeElement as HTMLElement | null;
    const container = containerRef.current;
    const first = container?.querySelector<HTMLElement>(FOCUSABLE_SELECTOR);
    (first ?? container)?.focus();

    return () => {
      previouslyFocused.current?.focus?.();
    };
  }, []);

  function handleKeyDown(e: React.KeyboardEvent) {
    onKeyDown?.(e);

    if (e.key === 'Escape' && !e.defaultPrevented) {
      onClose();
      return;
    }

    if (e.key === 'Tab') {
      const container = containerRef.current;
      if (!container) return;
      const focusable = Array.from(container.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR)).filter(
        (el) => el.offsetParent !== null,
      );
      if (focusable.length === 0) return;

      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (e.shiftKey && document.activeElement === first) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && document.activeElement === last) {
        e.preventDefault();
        first.focus();
      }
    }
  }

  return (
    <div
      ref={containerRef}
      className="fixed inset-0 z-(--z-modal) flex items-center justify-center p-4 outline-none"
      onKeyDown={handleKeyDown}
      tabIndex={-1}
    >
      <div className={cn('absolute inset-0', backdropClassName)} onClick={onClose} aria-hidden />
      {children}
    </div>
  );
}
