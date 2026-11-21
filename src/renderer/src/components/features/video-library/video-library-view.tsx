'use client';

import { useMemo, useState } from 'react';
import {
  Plus, Search, Trash2, Pencil, Eye, Loader2, X, AlertCircle, FolderX,
  SlidersHorizontal, LayoutGrid, List as ListIcon,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { useVideoLibrary } from '@/contexts/video-library-context';
import { VideoItemModal } from '@/components/features/video-library/video-item-modal';
import { ConfirmDialog } from '@/components/ui/confirm-dialog';
import { ErrorBanner } from '@/components/ui/error-banner';
import { Tooltip } from '@/components/ui/tooltip';
import { Button } from '@/components/ui/button';
import { Select } from '@/components/ui/select';
import { useDebounce } from '@/hooks/use-debounce';
import { STATUS_META, isRunningStatus } from '@/lib/video-library/video-status';
import {
  videoItemProgressPercent,
  filterVideoItems,
  collectDistinctValues,
  formatVideoItemCardDate,
  ALL_FILTER_VALUE,
  type VideoLibrarySortOrder,
  type VideoLibraryStatusFilter,
  type VideoLibraryItem,
} from '@/lib/video-library/video-library';
import type { VideoProvider } from '@/contexts/project-settings-context';

type ViewMode = 'grid' | 'list';

/** Badge nhà cung cấp — tách riêng khỏi veoModelLabel để nhìn rõ khi chạy nhiều luồng song song */
function ProviderBadge({ provider }: { provider: VideoProvider }) {
  if (provider === 'veo-gemini') {
    return (
      <span className="text-[10px] font-medium px-2 py-0.5 rounded-full bg-emerald-500/15 text-emerald-300 border border-emerald-500/25">
        Veo3.1 Gemini
      </span>
    );
  }
  return (
    <span className="text-[10px] font-medium px-2 py-0.5 rounded-full bg-blue-500/15 text-blue-300 border border-blue-500/25">
      Veo 3
    </span>
  );
}

const STATUS_FILTER_OPTIONS: { value: VideoLibraryStatusFilter; label: string }[] = [
  { value: 'all', label: 'Tất cả trạng thái' },
  { value: 'running', label: 'Đang chạy' },
  { value: 'completed', label: 'Hoàn thành' },
  { value: 'draft', label: 'Nháp / Lỗi' },
];

/** "Tất cả {label chung}" + từng giá trị THẬT đang có trong danh sách video hiện tại —
 * dùng chung cho 3 dropdown Model/Tỷ lệ/Chất lượng, đều lấy option kiểu này. */
function buildValueFilterOptions(allLabel: string, values: string[]): { value: string; label: string }[] {
  return [{ value: ALL_FILTER_VALUE, label: allLabel }, ...values.map((v) => ({ value: v, label: v }))];
}

const QUALITY_LABELS: Record<string, string> = {
  '720p': '720p – Tiêu chuẩn',
  '1080p': '1080p – HD cao',
};

const SORT_OPTIONS: { value: VideoLibrarySortOrder; label: string }[] = [
  { value: 'newest', label: 'Mới nhất' },
  { value: 'oldest', label: 'Cũ nhất' },
];

function VideoLibraryCard({
  item,
  onOpenDetail,
  onEdit,
  onDelete,
  onDismissRegenerateError,
}: {
  item: VideoLibraryItem;
  onOpenDetail: () => void;
  onEdit: () => void;
  onDelete: () => void;
  onDismissRegenerateError: () => void;
}) {
  const running = isRunningStatus(item.status);
  const hasError = item.status === 'error';
  const percent = videoItemProgressPercent(item);
  const progressLabel = item.scenesTotal > 0
    ? `${item.scenesDone}/${item.scenesTotal}`
    : running ? '0/…' : '—';
  const statusMeta = STATUS_META[item.status];

  return (
    <div
      className="flex flex-col rounded-xl border border-border/80 bg-card/50 p-4 transition-all hover:border-orange-500/40 hover:bg-card cursor-pointer"
      onClick={onOpenDetail}
    >
      <div className="flex items-start justify-between gap-2 mb-2.5">
        <p title={item.title} className="text-sm font-semibold text-foreground truncate flex-1 min-w-0">
          {item.title}
        </p>
        {item.isRegenerating && (
          <span className="flex items-center gap-1 text-[10px] font-medium text-sky-400 shrink-0">
            <Loader2 className="w-3 h-3 animate-spin" />
            Đang tạo lại…
          </span>
        )}
      </div>

      <div className="flex flex-wrap gap-1.5 mb-3">
        <ProviderBadge provider={item.settings.videoProvider ?? 'veo'} />
        <span className="text-[10px] font-medium px-2 py-0.5 rounded-full bg-indigo-500/15 text-indigo-300 border border-indigo-500/25 truncate max-w-full">
          {item.veoModelLabel}
        </span>
        <span className="text-[10px] font-medium px-2 py-0.5 rounded-full bg-violet-500/15 text-violet-300 border border-violet-500/25">
          {item.aspectRatio}
        </span>
      </div>

      <p className={cn('text-[11px] font-semibold mb-1.5', statusMeta.text)}>
        {statusMeta.label}
      </p>

      <div className="flex items-center gap-2 mb-2">
        <div className="flex-1 h-1.5 bg-muted rounded-full overflow-hidden">
          <div
            className={cn('h-full rounded-full transition-all duration-500', statusMeta.bg)}
            style={{ width: `${percent}%` }}
          />
        </div>
        <span className={cn('text-[11px] font-semibold tabular-nums shrink-0', statusMeta.text)}>
          {progressLabel}
        </span>
        {running && (
          <Loader2 className="w-3.5 h-3.5 text-orange-400 animate-spin shrink-0" />
        )}
      </div>

      {hasError && item.errorMessage && (
        <p
          title={item.errorMessage}
          className="flex items-start gap-1 text-[11px] text-destructive leading-snug mb-2 line-clamp-2"
        >
          <AlertCircle className="w-3 h-3 shrink-0 mt-0.5" />
          <span>{item.errorMessage}</span>
        </p>
      )}

      {item.regenerateError && !item.isRegenerating && (
        <p className="flex items-start gap-1 text-[11px] text-destructive leading-snug mb-2">
          <AlertCircle className="w-3 h-3 shrink-0 mt-0.5" />
          <span className="flex-1">Tạo lại thất bại: {item.regenerateError}</span>
          <Button
            type="button"
            variant="icon-ghost"
            onClick={(e) => { e.stopPropagation(); onDismissRegenerateError(); }}
            aria-label="Đóng thông báo lỗi"
            className="shrink-0 p-0"
          >
            <X className="w-3 h-3" />
          </Button>
        </p>
      )}

      <p className="text-[10px] text-muted-foreground mb-3">
        {formatVideoItemCardDate(item.createdAt)}
      </p>

      <div className="mt-auto flex items-center gap-2 pt-3 border-t border-border/60">
        <Button
          variant="primary"
          size="sm"
          onClick={(e) => { e.stopPropagation(); onOpenDetail(); }}
          className="flex-1 focus-visible:ring-offset-card"
        >
          <Eye className="w-3.5 h-3.5" />
          Xem chi tiết
        </Button>
        <Tooltip content="Sửa video">
          <Button
            variant="icon-ghost"
            size="icon"
            onClick={(e) => { e.stopPropagation(); onEdit(); }}
            aria-label="Sửa video"
          >
            <Pencil className="w-3.5 h-3.5" />
          </Button>
        </Tooltip>
        <Tooltip content="Xoá video">
          <Button
            variant="icon-danger"
            size="icon"
            onClick={(e) => { e.stopPropagation(); onDelete(); }}
            aria-label="Xoá video"
          >
            <Trash2 className="w-3.5 h-3.5" />
          </Button>
        </Tooltip>
      </div>
    </div>
  );
}

/** Chế độ xem danh sách — cùng dữ liệu/hành động với VideoLibraryCard, chỉ khác bố cục
 *  1 hàng ngang gọn hơn (phù hợp khi có nhiều video, lướt nhanh theo tên). */
function VideoLibraryListRow({
  item,
  onOpenDetail,
  onEdit,
  onDelete,
}: {
  item: VideoLibraryItem;
  onOpenDetail: () => void;
  onEdit: () => void;
  onDelete: () => void;
}) {
  const running = isRunningStatus(item.status);
  const percent = videoItemProgressPercent(item);
  const progressLabel = item.scenesTotal > 0
    ? `${item.scenesDone}/${item.scenesTotal}`
    : running ? '0/…' : '—';
  const statusMeta = STATUS_META[item.status];

  return (
    <div
      className="flex items-center gap-3 rounded-xl border border-border/80 bg-card/50 px-4 py-3 transition-all hover:border-orange-500/40 hover:bg-card cursor-pointer"
      onClick={onOpenDetail}
    >
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2">
          <p title={item.title} className="text-sm font-semibold text-foreground truncate">
            {item.title}
          </p>
          {item.isRegenerating && (
            <Loader2 className="w-3 h-3 text-sky-400 animate-spin shrink-0" />
          )}
        </div>
        <div className="flex flex-wrap items-center gap-1.5 mt-1.5">
          <ProviderBadge provider={item.settings.videoProvider ?? 'veo'} />
          <span className="text-[10px] font-medium px-2 py-0.5 rounded-full bg-indigo-500/15 text-indigo-300 border border-indigo-500/25 truncate max-w-40">
            {item.veoModelLabel}
          </span>
          <span className="text-[10px] font-medium px-2 py-0.5 rounded-full bg-violet-500/15 text-violet-300 border border-violet-500/25">
            {item.aspectRatio}
          </span>
          <span className="text-[10px] text-muted-foreground">{formatVideoItemCardDate(item.createdAt)}</span>
        </div>
      </div>

      <div className="hidden sm:flex items-center gap-2 w-40 shrink-0">
        <div className="flex-1 h-1.5 bg-muted rounded-full overflow-hidden">
          <div
            className={cn('h-full rounded-full transition-all duration-500', statusMeta.bg)}
            style={{ width: `${percent}%` }}
          />
        </div>
        <span className={cn('text-[11px] font-semibold tabular-nums shrink-0', statusMeta.text)}>
          {progressLabel}
        </span>
      </div>

      <p className={cn('hidden md:block text-[11px] font-semibold w-20 shrink-0 text-right', statusMeta.text)}>
        {statusMeta.label}
      </p>

      <div className="flex items-center gap-1 shrink-0">
        <Tooltip content="Xem chi tiết">
          <Button variant="icon-ghost" size="icon" onClick={(e) => { e.stopPropagation(); onOpenDetail(); }} aria-label="Xem chi tiết">
            <Eye className="w-3.5 h-3.5" />
          </Button>
        </Tooltip>
        <Tooltip content="Sửa video">
          <Button variant="icon-ghost" size="icon" onClick={(e) => { e.stopPropagation(); onEdit(); }} aria-label="Sửa video">
            <Pencil className="w-3.5 h-3.5" />
          </Button>
        </Tooltip>
        <Tooltip content="Xoá video">
          <Button variant="icon-danger" size="icon" onClick={(e) => { e.stopPropagation(); onDelete(); }} aria-label="Xoá video">
            <Trash2 className="w-3.5 h-3.5" />
          </Button>
        </Tooltip>
      </div>
    </div>
  );
}

/** Skeleton đúng khung card thật (cùng bố cục tên/badge/trạng thái/progress/hành động) —
 *  tránh flash nội dung sai lúc đang đồng bộ Supabase lần đầu. */
function VideoLibraryCardSkeleton() {
  return (
    <div className="flex flex-col rounded-xl border border-border/80 bg-card/50 p-4 animate-pulse">
      <div className="h-4 w-2/3 rounded bg-muted mb-3" />
      <div className="flex gap-1.5 mb-3">
        <div className="h-4 w-16 rounded-full bg-muted" />
        <div className="h-4 w-14 rounded-full bg-muted" />
        <div className="h-4 w-10 rounded-full bg-muted" />
      </div>
      <div className="h-3 w-20 rounded bg-muted mb-2" />
      <div className="h-1.5 w-full rounded-full bg-muted mb-3" />
      <div className="h-3 w-24 rounded bg-muted mb-4" />
      <div className="flex gap-2 pt-3 border-t border-border/60">
        <div className="h-8 flex-1 rounded-lg bg-muted" />
        <div className="h-8 w-8 rounded-lg bg-muted" />
        <div className="h-8 w-8 rounded-lg bg-muted" />
      </div>
    </div>
  );
}

interface VideoLibraryViewProps {
  /** Chuyển sang trang chi tiết sau khi đã chọn video (selectItem) */
  onOpenDetail: () => void;
}

/** Trang Kho video — full-width, thay cho panel/drawer cũ */
export function VideoLibraryView({ onOpenDetail }: VideoLibraryViewProps) {
  const {
    items,
    libraryLoading,
    libraryError,
    retryLibrarySync,
    createItem,
    selectItem,
    deleteItem,
    deleteAllItems,
    updateItem,
  } = useVideoLibrary();

  const [search, setSearch] = useState('');
  const debouncedSearch = useDebounce(search, 300);
  const [statusFilter, setStatusFilter] = useState<VideoLibraryStatusFilter>('all');
  const [modelFilter, setModelFilter] = useState(ALL_FILTER_VALUE);
  const [aspectRatioFilter, setAspectRatioFilter] = useState(ALL_FILTER_VALUE);
  const [qualityFilter, setQualityFilter] = useState(ALL_FILTER_VALUE);
  const [sort, setSort] = useState<VideoLibrarySortOrder>('newest');
  const [filterPanelOpen, setFilterPanelOpen] = useState(true);
  const [viewMode, setViewMode] = useState<ViewMode>('grid');
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [editingItem, setEditingItem] = useState<VideoLibraryItem | null>(null);
  const [deletingItem, setDeletingItem] = useState<VideoLibraryItem | null>(null);
  const [confirmDeleteAll, setConfirmDeleteAll] = useState(false);

  // Option của 3 dropdown Model/Tỷ lệ/Chất lượng lấy ĐÚNG giá trị đang thật sự có trong kho
  // video hiện tại (collectDistinctValues) — không hiện sẵn model/tỷ lệ nào user chưa từng dùng.
  const modelOptions = useMemo(
    () => buildValueFilterOptions('Tất cả model', collectDistinctValues(items, (i) => i.veoModelLabel)),
    [items],
  );
  const aspectRatioOptions = useMemo(
    () => buildValueFilterOptions('Tất cả tỷ lệ', collectDistinctValues(items, (i) => i.aspectRatio)),
    [items],
  );
  const qualityOptions = useMemo(() => {
    const values = collectDistinctValues(items, (i) => i.settings.videoQuality);
    return buildValueFilterOptions('Tất cả chất lượng', values).map((o) =>
      o.value === ALL_FILTER_VALUE ? o : { ...o, label: QUALITY_LABELS[o.value] ?? o.label },
    );
  }, [items]);

  const filters = useMemo(
    () => ({
      query: debouncedSearch,
      status: statusFilter,
      model: modelFilter,
      aspectRatio: aspectRatioFilter,
      quality: qualityFilter,
      sort,
    }),
    [debouncedSearch, statusFilter, modelFilter, aspectRatioFilter, qualityFilter, sort],
  );

  const filtered = useMemo(() => filterVideoItems(items, filters), [items, filters]);

  const activeFilterCount = [
    debouncedSearch.trim() !== '',
    statusFilter !== 'all',
    modelFilter !== ALL_FILTER_VALUE,
    aspectRatioFilter !== ALL_FILTER_VALUE,
    qualityFilter !== ALL_FILTER_VALUE,
  ].filter(Boolean).length;
  const hasActiveFilter = activeFilterCount > 0;

  const handleDeleteAll = () => {
    if (items.length === 0) return;
    setConfirmDeleteAll(true);
  };

  const handleDelete = (item: VideoLibraryItem) => {
    setDeletingItem(item);
  };

  const handleOpenDetail = (id: string) => {
    selectItem(id);
    onOpenDetail();
  };

  const clearFilters = () => {
    setSearch('');
    setStatusFilter('all');
    setModelFilter(ALL_FILTER_VALUE);
    setAspectRatioFilter(ALL_FILTER_VALUE);
    setQualityFilter(ALL_FILTER_VALUE);
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
        <p className="text-xs text-muted-foreground">
          Quản lý và lưu trữ tất cả video của bạn
        </p>
        <div className="flex items-center gap-3 shrink-0">
          {/* Hành động phá huỷ — tách biệt thị giác khỏi CTA chính: chỉ chữ, không nền, nhỏ hơn,
              đứng riêng bên trái CTA thay vì cùng kiểu button nổi bật ngang hàng như trước */}
          {items.length > 0 && (
            <Button
              variant="ghost-danger"
              onClick={handleDeleteAll}
              className="px-1.5 py-1 rounded"
            >
              <Trash2 className="w-3.5 h-3.5" />
              Xóa toàn bộ ({items.length})
            </Button>
          )}
          <Button
            variant="primary"
            disabled={libraryLoading}
            onClick={() => setShowCreateModal(true)}
            className="px-3.5 py-2.5"
          >
            <Plus className="w-4 h-4" />
            Tạo video mới
          </Button>
        </div>
      </div>

      {libraryError && (
        <ErrorBanner error={libraryError} onAction={retryLibrarySync} />
      )}

      {/* Search + toggle bảng filter — thu gọn/mở rộng hàng filter bên dưới thay vì luôn
          chiếm chỗ, đỡ rối khi chỉ cần tìm theo tên */}
      <div className="flex flex-col sm:flex-row gap-2">
        <div className="relative flex-1">
          <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-muted-foreground pointer-events-none" />
          <input
            type="search"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Tìm video theo tên, mô tả, tag..."
            aria-label="Tìm video theo tên"
            className="w-full pl-8 pr-8 py-2 text-xs bg-muted/40 border border-border rounded-lg text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-primary/30"
          />
          {search && (
            <Button
              variant="ghost"
              size="icon"
              onClick={() => setSearch('')}
              aria-label="Xoá nội dung tìm kiếm"
              className="absolute right-2 top-1/2 -translate-y-1/2 p-0.5"
            >
              <X className="w-3.5 h-3.5" />
            </Button>
          )}
        </div>

        <Button
          variant="outline"
          size="sm"
          onClick={() => setFilterPanelOpen((v) => !v)}
          aria-pressed={filterPanelOpen}
          className={cn(
            'gap-1.5 shrink-0 font-medium',
            filterPanelOpen
              ? 'bg-primary/10 border-primary/30 text-primary hover:text-primary'
              : 'bg-muted/40 hover:border-primary/30',
          )}
        >
          <SlidersHorizontal className="w-3.5 h-3.5" />
          Bộ lọc
          {activeFilterCount > 0 && (
            <span className="flex items-center justify-center min-w-4 h-4 px-1 rounded-full bg-primary text-primary-foreground text-[10px] font-bold">
              {activeFilterCount}
            </span>
          )}
        </Button>
      </div>

      {filterPanelOpen && (
        <div className="flex flex-wrap items-center gap-2">
          <Select value={modelFilter} onChange={setModelFilter} options={modelOptions} aria-label="Lọc theo model" />
          <Select value={aspectRatioFilter} onChange={setAspectRatioFilter} options={aspectRatioOptions} aria-label="Lọc theo tỷ lệ" />
          <Select value={qualityFilter} onChange={setQualityFilter} options={qualityOptions} aria-label="Lọc theo chất lượng" />
          <Select value={statusFilter} onChange={setStatusFilter} options={STATUS_FILTER_OPTIONS} aria-label="Lọc theo trạng thái" />
          <Select value={sort} onChange={setSort} options={SORT_OPTIONS} aria-label="Sắp xếp" />

          {/* Chuyển lưới/danh sách — đẩy sát phải trên màn rộng */}
          <div className="flex items-center gap-0.5 ml-auto p-0.5 rounded-lg border border-border bg-muted/30">
            <Tooltip content="Xem dạng lưới">
              <button
                type="button"
                onClick={() => setViewMode('grid')}
                aria-pressed={viewMode === 'grid'}
                aria-label="Xem dạng lưới"
                className={cn(
                  'p-1.5 rounded-md transition-colors cursor-pointer',
                  viewMode === 'grid' ? 'bg-primary text-primary-foreground' : 'text-muted-foreground hover:text-foreground',
                )}
              >
                <LayoutGrid className="w-3.5 h-3.5" />
              </button>
            </Tooltip>
            <Tooltip content="Xem dạng danh sách">
              <button
                type="button"
                onClick={() => setViewMode('list')}
                aria-pressed={viewMode === 'list'}
                aria-label="Xem dạng danh sách"
                className={cn(
                  'p-1.5 rounded-md transition-colors cursor-pointer',
                  viewMode === 'list' ? 'bg-primary text-primary-foreground' : 'text-muted-foreground hover:text-foreground',
                )}
              >
                <ListIcon className="w-3.5 h-3.5" />
              </button>
            </Tooltip>
          </div>
        </div>
      )}

      {/* Số kết quả + chip filter đang áp dụng — bấm chip để gỡ đúng filter đó */}
      {!libraryLoading && (
        <div className="flex flex-wrap items-center gap-2 -mt-2">
          <span className="text-[11px] text-muted-foreground">
            {hasActiveFilter ? `${filtered.length}/${items.length} video` : `${items.length} video`}
          </span>
          {debouncedSearch.trim() && (
            <Button
              variant="ghost"
              size="sm"
              onClick={() => setSearch('')}
              className="gap-1 rounded-full border border-primary/25 bg-primary/10 px-2 py-0.5 text-[11px] text-primary hover:bg-primary/20 hover:text-primary"
            >
              &quot;{debouncedSearch.trim()}&quot;
              <X className="w-3 h-3" />
            </Button>
          )}
          {statusFilter !== 'all' && (
            <Button
              variant="ghost"
              size="sm"
              onClick={() => setStatusFilter('all')}
              className="gap-1 rounded-full border border-primary/25 bg-primary/10 px-2 py-0.5 text-[11px] text-primary hover:bg-primary/20 hover:text-primary"
            >
              {STATUS_FILTER_OPTIONS.find((o) => o.value === statusFilter)?.label}
              <X className="w-3 h-3" />
            </Button>
          )}
          {modelFilter !== ALL_FILTER_VALUE && (
            <Button
              variant="ghost"
              size="sm"
              onClick={() => setModelFilter(ALL_FILTER_VALUE)}
              className="gap-1 rounded-full border border-primary/25 bg-primary/10 px-2 py-0.5 text-[11px] text-primary hover:bg-primary/20 hover:text-primary"
            >
              {modelFilter}
              <X className="w-3 h-3" />
            </Button>
          )}
          {aspectRatioFilter !== ALL_FILTER_VALUE && (
            <Button
              variant="ghost"
              size="sm"
              onClick={() => setAspectRatioFilter(ALL_FILTER_VALUE)}
              className="gap-1 rounded-full border border-primary/25 bg-primary/10 px-2 py-0.5 text-[11px] text-primary hover:bg-primary/20 hover:text-primary"
            >
              {aspectRatioFilter}
              <X className="w-3 h-3" />
            </Button>
          )}
          {qualityFilter !== ALL_FILTER_VALUE && (
            <Button
              variant="ghost"
              size="sm"
              onClick={() => setQualityFilter(ALL_FILTER_VALUE)}
              className="gap-1 rounded-full border border-primary/25 bg-primary/10 px-2 py-0.5 text-[11px] text-primary hover:bg-primary/20 hover:text-primary"
            >
              {QUALITY_LABELS[qualityFilter] ?? qualityFilter}
              <X className="w-3 h-3" />
            </Button>
          )}
        </div>
      )}

      {libraryLoading ? (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
          {Array.from({ length: 8 }).map((_, i) => <VideoLibraryCardSkeleton key={i} />)}
        </div>
      ) : filtered.length === 0 ? (
        <div className="flex flex-col items-center justify-center gap-3 py-16 text-center">
          {hasActiveFilter ? (
            <>
              <FolderX className="w-8 h-8 text-muted-foreground/50" />
              <p className="text-sm text-muted-foreground">Không tìm thấy video phù hợp với bộ lọc hiện tại.</p>
              <Button variant="outline" onClick={clearFilters} className="px-4 py-2 text-xs hover:bg-muted/40 hover:border-border hover:text-foreground">
                <X className="w-3.5 h-3.5" />
                Xoá bộ lọc
              </Button>
            </>
          ) : (
            <>
              <p className="text-sm text-muted-foreground">Chưa có video nào — tạo video đầu tiên để bắt đầu.</p>
              <Button variant="primary" disabled={libraryLoading} onClick={() => setShowCreateModal(true)} className="px-4 py-2 text-xs">
                <Plus className="w-4 h-4" />
                Tạo video đầu tiên
              </Button>
            </>
          )}
        </div>
      ) : viewMode === 'grid' ? (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
          {filtered.map((item) => (
            <VideoLibraryCard
              key={item.id}
              item={item}
              onOpenDetail={() => handleOpenDetail(item.id)}
              onEdit={() => setEditingItem(item)}
              onDelete={() => handleDelete(item)}
              onDismissRegenerateError={() => updateItem(item.id, { regenerateError: undefined })}
            />
          ))}
        </div>
      ) : (
        <div className="flex flex-col gap-2">
          {filtered.map((item) => (
            <VideoLibraryListRow
              key={item.id}
              item={item}
              onOpenDetail={() => handleOpenDetail(item.id)}
              onEdit={() => setEditingItem(item)}
              onDelete={() => handleDelete(item)}
            />
          ))}
        </div>
      )}

      <VideoItemModal
        mode="create"
        open={showCreateModal}
        onClose={() => setShowCreateModal(false)}
        onCreate={(options) => {
          createItem(options);
          setShowCreateModal(false);
          // Đã chọn Nguồn nội dung — vào thẳng Mục 2 để hiện đúng giao diện, khỏi bấm "Xem chi tiết" lại
          onOpenDetail();
        }}
      />

      <VideoItemModal
        mode="edit"
        open={editingItem !== null}
        initialItem={editingItem}
        onClose={() => setEditingItem(null)}
      />

      <ConfirmDialog
        open={deletingItem !== null}
        title="Xoá video này?"
        message={deletingItem ? <>Video &quot;{deletingItem.title}&quot; sẽ bị xoá vĩnh viễn, không thể khôi phục.</> : ''}
        confirmLabel="Xoá video"
        onCancel={() => setDeletingItem(null)}
        onConfirm={() => {
          if (deletingItem) deleteItem(deletingItem.id);
          setDeletingItem(null);
        }}
      />

      <ConfirmDialog
        open={confirmDeleteAll}
        title={`Xoá toàn bộ ${items.length} video?`}
        message="Tất cả video và dữ liệu liên quan sẽ bị xoá vĩnh viễn, không thể khôi phục."
        confirmLabel="Xoá tất cả"
        onCancel={() => setConfirmDeleteAll(false)}
        onConfirm={() => {
          deleteAllItems();
          setConfirmDeleteAll(false);
        }}
      />
    </div>
  );
}
