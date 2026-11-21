'use client';

import { useEffect, useRef } from 'react';
import { Sidebar, type AppView, type CreativeToolId } from './sidebar';
import type { PresetScript } from '@/lib/preset/preset-scripts';

interface MobileSidebarDrawerProps {
  open: boolean;
  onClose: () => void;
  activeView: AppView;
  activeMenuId: string;
  activeTool: CreativeToolId | null;
  onMenuClick: (menuId: string, view: AppView) => void;
  onToolClick: (toolId: CreativeToolId) => void;
  onPresetSelect: (preset: PresetScript) => void;
  disabledTools?: Partial<Record<CreativeToolId, string>>;
}

const SWIPE_CLOSE_THRESHOLD_PX = 60;

/**
 * Drawer sidebar cho mobile — thay cho khối `sidebarOpen && (...)` cũ trong page.tsx (không có
 * ESC, không khoá scroll nền, không trả focus, không animation). Đóng bằng ESC / click ra
 * ngoài overlay / vuốt trái trên panel; khoá scroll nền khi mở; trả focus về đúng phần tử đã
 * mở drawer (nút hamburger ở Header hoặc nút "Thêm" ở MobileNav — bất kể cái nào) khi đóng.
 */
export function MobileSidebarDrawer({ open, onClose, ...sidebarProps }: MobileSidebarDrawerProps) {
  const panelRef = useRef<HTMLDivElement>(null);
  const touchStartXRef = useRef<number | null>(null);

  useEffect(() => {
    if (!open) return;

    const previouslyFocused = document.activeElement as HTMLElement | null;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';

    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    document.addEventListener('keydown', onKeyDown);
    panelRef.current?.focus();

    return () => {
      document.body.style.overflow = previousOverflow;
      document.removeEventListener('keydown', onKeyDown);
      previouslyFocused?.focus();
    };
  }, [open, onClose]);

  if (!open) return null;

  const handleTouchStart = (e: React.TouchEvent) => {
    touchStartXRef.current = e.touches[0]?.clientX ?? null;
  };

  const handleTouchEnd = (e: React.TouchEvent) => {
    if (touchStartXRef.current === null) return;
    const deltaX = (e.changedTouches[0]?.clientX ?? 0) - touchStartXRef.current;
    // Panel nằm bên trái màn hình — vuốt trái (đẩy panel ra ngoài mép trái) để đóng
    if (deltaX < -SWIPE_CLOSE_THRESHOLD_PX) onClose();
    touchStartXRef.current = null;
  };

  return (
    <div className="fixed inset-0 z-(--z-drawer) md:hidden" role="presentation">
      <div
        className="absolute inset-0 bg-black/60 backdrop-blur-sm animate-in fade-in duration-200"
        onClick={onClose}
        aria-hidden
      />
      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-label="Menu điều hướng"
        tabIndex={-1}
        onClick={(e) => e.stopPropagation()}
        onTouchStart={handleTouchStart}
        onTouchEnd={handleTouchEnd}
        className="absolute left-0 top-0 h-full w-72 max-w-[85vw] bg-sidebar border-r border-sidebar-border shadow-2xl outline-none animate-in slide-in-from-left duration-200"
      >
        <Sidebar {...sidebarProps} collapsed={false} onToggleCollapse={onClose} />
      </div>
    </div>
  );
}
