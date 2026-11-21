'use client';

import { Play, Square, RefreshCw, Trash2, Save, Loader2 } from 'lucide-react';
import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';

export interface SceneToolbarState {
  selectedCount: number;
  totalCount: number;
  /** Cảnh status === 'error' — hiển thị "X cảnh lỗi" trên toolbar */
  errorCount: number;
  /** Cảnh lỗi hoặc đã sửa sau khi đã có video — bật nút "Tạo lại" khi không chọn cảnh */
  regeneratableCount: number;
  allSelected: boolean;
  isRegenerating: boolean;
  unsavedCount: number;
  isSaving: boolean;
}

interface SceneQuickActionsProps extends SceneToolbarState {
  onSceneAction: (action: string) => void;
  onBulkAction: (action: string) => void;
  className?: string;
}

/**
 * 5 nút hành động cho "3. DANH SÁCH CẢNH" — chuyển từ scene-toolbar.tsx lên thanh tham số
 * (VideoSettingsBar, xem video-settings-bar.tsx) để luôn thấy được dù đang cuộn xa xuống dưới.
 * Giao diện/hành vi từng nút giữ y nguyên như trước khi di chuyển — chỉ đổi vị trí render.
 * `onSceneAction`/`onBulkAction` được gọi qua `SceneGalleryHandle` (ref) vì component này
 * render ở nhánh cây khác (trong Header), không phải con trực tiếp của SceneGallery.
 */
export function SceneQuickActions({
  selectedCount,
  regeneratableCount,
  isRegenerating,
  unsavedCount,
  isSaving,
  onSceneAction,
  onBulkAction,
  className,
}: SceneQuickActionsProps) {
  return (
    <div className={cn('flex flex-wrap gap-2', className)}>
      <Button
        type="button"
        variant="accent"
        size="sm"
        onClick={() => onSceneAction('run')}
        disabled={selectedCount === 0}
        className="font-bold"
      >
        <Play className="w-3.5 h-3.5" />
        Chạy
      </Button>
      <Button
        type="button"
        variant="outline"
        size="sm"
        onClick={() => onSceneAction('stop')}
        disabled={selectedCount === 0}
      >
        <Square className="w-3.5 h-3.5" />
        Stop
      </Button>
      <Button
        type="button"
        variant="outline"
        size="sm"
        onClick={() => onSceneAction('regen-error')}
        disabled={selectedCount === 0 && regeneratableCount === 0}
        title={isRegenerating ? 'Đang xử lý hàng đợi — bấm để xếp thêm cảnh, vẫn xử lý tuần tự từng cảnh 1' : undefined}
        className="border-orange-500/30 text-orange-400 hover:bg-orange-500/10 hover:text-orange-400"
      >
        <RefreshCw className={cn('w-3.5 h-3.5', isRegenerating && 'animate-spin')} />
        {isRegenerating ? 'Đang tạo lại...' : 'Tạo lại cảnh đã sửa / lỗi'}
      </Button>
      <Button
        type="button"
        variant="outline"
        size="sm"
        onClick={() => onSceneAction('delete')}
        disabled={selectedCount === 0}
        className="border-destructive/30 text-destructive hover:bg-destructive/10 hover:text-destructive"
      >
        <Trash2 className="w-3.5 h-3.5" />
        Xóa
      </Button>
      <Button
        type="button"
        variant="outline"
        size="sm"
        onClick={() => onBulkAction('save-videos')}
        disabled={unsavedCount === 0 || isSaving}
        title="Thử lưu lại video/audio chưa upload lên cloud (thường tự lưu sau khi tạo xong)"
        className="border-green-500/30 text-green-500 hover:bg-green-500/10 hover:text-green-500"
      >
        {isSaving ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Save className="w-3.5 h-3.5" />}
        {isSaving ? 'Đang lưu...' : unsavedCount > 0 ? `Lưu video (${unsavedCount})` : 'Lưu video'}
      </Button>
    </div>
  );
}
