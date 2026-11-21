'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { ChevronsUpDown, Search, Check, Loader2, AlertCircle, Clapperboard, Plus } from 'lucide-react';
import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import { useVideoLibrary } from '@/contexts/video-library-context';
import { VideoItemModal } from '@/components/features/video-library/video-item-modal';
import {
  formatVideoItemCardDate,
  type VideoLibraryItem,
  type VideoLibraryStatus,
} from '@/lib/video-library/video-library';

/** Chỉ 2 trạng thái cần "báo động" mới hiện badge màu trong danh sách — draft/completed
 * coi là bình thường, hiện badge cho mọi dòng sẽ rối mắt (giữ đúng tinh thần thiết kế tham
 * chiếu: chỉ dự án khác thường — "PAUSED" — mới có badge, dự án đang chọn chỉ có dấu ✓). */
const STATUS_BADGE: Partial<Record<VideoLibraryStatus, { label: string; className: string }>> = {
  analyzing: { label: 'Đang phân tích', className: 'bg-orange-500/15 text-orange-300 border-orange-500/25' },
  generating: { label: 'Đang tạo video', className: 'bg-orange-500/15 text-orange-300 border-orange-500/25' },
  error: { label: 'Lỗi', className: 'bg-destructive/15 text-destructive border-destructive/25' },
};

function StatusBadge({ status }: { status: VideoLibraryStatus }) {
  const cfg = STATUS_BADGE[status];
  if (!cfg) return null;
  const running = status === 'analyzing' || status === 'generating';
  return (
    <span className={cn('flex items-center gap-1 text-[10px] font-semibold px-1.5 py-0.5 rounded-full border shrink-0', cfg.className)}>
      {running ? <Loader2 className="w-2.5 h-2.5 animate-spin" /> : <AlertCircle className="w-2.5 h-2.5" />}
      {cfg.label}
    </span>
  );
}

/**
 * Dropdown đổi nhanh giữa các video — kiểu "project switcher" (tham khảo Vercel): icon +
 * tên dự án trong 1 nút bo viền, bấm mở panel có ô tìm kiếm + danh sách + hành động "Tạo
 * video mới" cố định cuối panel. Thay cho việc phải quay lại "Kho video" rồi bấm "Xem chi
 * tiết" mỗi lần muốn đổi/tạo video. Tự lấy dữ liệu qua useVideoLibrary(), không cần prop.
 */
export function VideoSwitcher() {
  const { items, activeItem, selectItem, createItem } = useVideoLibrary();
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState('');
  const [showCreateModal, setShowCreateModal] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onPointerDown = (e: MouseEvent) => {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) setOpen(false);
    };
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false);
    };
    document.addEventListener('mousedown', onPointerDown);
    document.addEventListener('keydown', onKeyDown);
    return () => {
      document.removeEventListener('mousedown', onPointerDown);
      document.removeEventListener('keydown', onKeyDown);
    };
  }, [open]);

  useEffect(() => {
    if (!open) setSearch('');
  }, [open]);

  const filteredItems = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return items;
    return items.filter((it) => it.title.toLowerCase().includes(q));
  }, [items, search]);

  return (
    <>
      <div ref={rootRef} className="relative">
        <Button
          type="button"
          variant="outline"
          onClick={() => setOpen((v) => !v)}
          aria-expanded={open}
          aria-haspopup="listbox"
          title="Đổi video khác"
          className={cn(
            'pl-2 pr-2.5 py-1.5 group',
            open ? 'border-primary/50 bg-card' : 'bg-card/60 hover:border-primary/40 hover:bg-card',
          )}
        >
          <Clapperboard className="w-3.5 h-3.5 text-orange-400 shrink-0" />
          <h2 className="text-sm font-bold text-foreground whitespace-nowrap">
            {activeItem.title}
          </h2>
          <ChevronsUpDown
            className={cn(
              'w-3.5 h-3.5 text-muted-foreground shrink-0 transition-colors',
              open ? 'text-primary' : 'group-hover:text-foreground',
            )}
          />
        </Button>

        {open && (
          <div
            role="listbox"
            aria-label="Chọn video khác"
            className="absolute left-0 top-full mt-2 z-(--z-elevated) w-80 max-w-[calc(100vw-2rem)] bg-popover border border-border rounded-xl shadow-lg overflow-hidden flex flex-col"
          >
            <div className="p-2 border-b border-border shrink-0">
              <div className="relative">
                <Search className="w-3.5 h-3.5 text-muted-foreground absolute left-2.5 top-1/2 -translate-y-1/2 pointer-events-none" />
                {/* eslint-disable-next-line jsx-a11y/no-autofocus */}
                <input
                  autoFocus
                  type="text"
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  placeholder="Tìm video..."
                  className="w-full pl-8 pr-2 py-1.5 text-xs bg-background border border-border rounded-lg text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-primary/30"
                />
              </div>
            </div>

            <div className="max-h-72 overflow-y-auto py-1">
              {filteredItems.length === 0 ? (
                <p className="px-3 py-4 text-xs text-muted-foreground text-center">
                  Không tìm thấy video nào khớp &quot;{search.trim()}&quot;.
                </p>
              ) : (
                filteredItems.map((item: VideoLibraryItem) => {
                  const isActive = item.id === activeItem.id;
                  return (
                    <button
                      key={item.id}
                      type="button"
                      role="option"
                      aria-selected={isActive}
                      onClick={() => { selectItem(item.id); setOpen(false); }}
                      className={cn(
                        'w-full flex items-center gap-2 px-3 py-2 text-left transition-colors cursor-pointer',
                        isActive ? 'bg-primary/10' : 'hover:bg-muted/40',
                      )}
                    >
                      <span className="flex-1 min-w-0">
                        <span className={cn('block text-xs font-medium truncate', isActive ? 'text-primary' : 'text-foreground')}>
                          {item.title}
                        </span>
                        <span className="block text-[10px] text-muted-foreground/70 mt-0.5">
                          {formatVideoItemCardDate(item.updatedAt)}
                        </span>
                      </span>
                      <StatusBadge status={item.status} />
                      {isActive && <Check className="w-3.5 h-3.5 text-primary shrink-0" />}
                    </button>
                  );
                })
              )}
            </div>

            <div className="border-t border-border shrink-0 p-1">
              <Button
                type="button"
                variant="ghost"
                onClick={() => { setOpen(false); setShowCreateModal(true); }}
                className="w-full justify-start px-2 py-2 font-semibold text-foreground hover:text-foreground hover:bg-muted/40"
              >
                <Plus className="w-3.5 h-3.5 text-primary" />
                Tạo video mới
              </Button>
            </div>
          </div>
        )}
      </div>

      <VideoItemModal
        mode="create"
        open={showCreateModal}
        onClose={() => setShowCreateModal(false)}
        onCreate={(options) => {
          createItem(options);
          setShowCreateModal(false);
        }}
      />
    </>
  );
}
