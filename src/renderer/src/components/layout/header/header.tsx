'use client';

import { ChevronLeft, Menu } from 'lucide-react';
import { VideoSettingsBar } from '@/components/features/video-settings';
import { Button } from '@/components/ui/button';

interface HeaderProps {
  title: string;
  onBackClick?: () => void;
  onMenuOpen?: () => void;
  showVideoSettings?: boolean;
  /** Nội dung đặt ngay cạnh title (vd VideoSwitcher) — cùng hàng, không đổi title */
  titleExtra?: React.ReactNode;
  /** Nội dung thêm 1 hàng mới bên trong VideoSettingsBar (vd SceneQuickActions) — chỉ có
   *  tác dụng khi showVideoSettings=true */
  videoSettingsExtra?: React.ReactNode;
}

export function Header({
  title,
  onBackClick,
  onMenuOpen,
  showVideoSettings = false,
  titleExtra,
  videoSettingsExtra,
}: HeaderProps) {
  return (
    <header className="bg-background/95 backdrop-blur-sm border-b border-border px-4 sm:px-6 py-3 flex flex-col gap-2 sticky top-0 z-(--z-header) shrink-0">
      <div className="flex items-center justify-between gap-3">
        <div className="flex items-center gap-2 sm:gap-3 min-w-0 flex-wrap">
          {!onBackClick && onMenuOpen && (
            <Button
              type="button"
              variant="icon-ghost"
              onClick={onMenuOpen}
              className="relative p-1.5 md:hidden flex-shrink-0 before:absolute before:-inset-2 before:content-['']"
              aria-label="Mở menu"
            >
              <Menu className="w-5 h-5" />
            </Button>
          )}

          {onBackClick && (
            <Button
              type="button"
              variant="icon-ghost"
              onClick={onBackClick}
              className="relative p-1.5 flex-shrink-0 before:absolute before:-inset-2 before:content-['']"
              aria-label="Quay lại"
            >
              <ChevronLeft className="w-5 h-5" />
            </Button>
          )}

          <h1 className="text-sm sm:text-base font-bold text-foreground shrink-0 leading-none">
            {title}
          </h1>

          {titleExtra}
        </div>
      </div>

      {showVideoSettings && <VideoSettingsBar extra={videoSettingsExtra} />}
    </header>
  );
}
