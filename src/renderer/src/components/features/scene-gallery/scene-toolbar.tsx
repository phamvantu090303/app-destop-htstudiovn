'use client';

import { CheckSquare, SquareCheck } from 'lucide-react';
import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';

interface SceneToolbarProps {
  selectedCount: number;
  totalCount: number;
  errorCount: number;
  allSelected: boolean;
  onBulkAction: (action: string) => void;
  className?: string;
}

/**
 * Chỉ còn hàng nhãn + "Chọn tất cả" — 5 nút hành động (Chạy/Stop/Tạo lại/Xóa/Lưu video) đã
 * chuyển lên thanh tham số (VideoSettingsBar, xem scene-quick-actions.tsx), "Xóa toàn bộ bulk"/
 * "Thêm"/"Refresh" đã bỏ hẳn.
 */
export function SceneToolbar({
  selectedCount,
  totalCount,
  errorCount,
  allSelected,
  onBulkAction,
  className,
}: SceneToolbarProps) {
  return (
    <div className={cn('flex items-center justify-between gap-2 flex-wrap', className)}>
      <p className="text-xs text-muted-foreground">
        Công cụ cho từng cảnh
        {selectedCount > 0 && (
          <span className="text-primary ml-1">— đã chọn {selectedCount}/{totalCount}</span>
        )}
        {errorCount > 0 && (
          <span className="text-destructive ml-1">— {errorCount} cảnh lỗi</span>
        )}
      </p>
      <Button
        type="button"
        variant="outline"
        size="sm"
        onClick={() => onBulkAction(allSelected ? 'deselect-all' : 'select-all')}
        className={cn(
          'rounded-lg font-medium',
          allSelected && 'border-primary/40 text-primary bg-primary/10 hover:border-primary/40 hover:text-primary',
        )}
      >
        {allSelected ? <SquareCheck className="w-3.5 h-3.5" /> : <CheckSquare className="w-3.5 h-3.5" />}
        {allSelected ? 'Bỏ chọn tất cả' : 'Chọn tất cả'}
      </Button>
    </div>
  );
}
