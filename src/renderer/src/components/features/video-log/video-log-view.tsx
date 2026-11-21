'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import {
  RefreshCw, Search, X, Copy, Check, Film, Loader2, AlertCircle, Info, PlayCircle, Download,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { useAuth } from '@/contexts/auth-context';
import { createClient } from '@/lib/supabase/client';
import { fetchVideoLogPage, type VideoLogEntry } from '@/lib/video-log/video-log-remote';
import { downloadBlob } from '@/lib/video-library/video-composer';
import {
  VIDEO_LOG_STATUS_META, VIDEO_LOG_STATUS_FILTER_OPTIONS, matchesStatusFilter,
  type VideoLogRowStatus, type VideoLogStatusFilter,
} from '@/lib/video-log/video-log-status';
import { videoLogService } from '@/services/video-log/video-log.service';
import { withVideoLogConcurrency } from '@/lib/veo/veo-concurrency';
import { toUserMessage } from '@/lib/error-messages';
import { useDebounce } from '@/hooks/use-debounce';
import { useCopyToClipboard } from '@/hooks/use-copy-to-clipboard';
import { Button } from '@/components/ui/button';
import { Select } from '@/components/ui/select';
import { ErrorBanner } from '@/components/ui/error-banner';
import { VideoLogResultModal } from './video-log-result-modal';

const PAGE_SIZE = 20;
const BANNER_DISMISSED_KEY = 'web-video:video-log-banner-dismissed';
/** Từ ≥ ngưỡng này, gộp lỗi từng dòng thành 1 banner chung thay vì lặp lại N lần cùng 1 lỗi */
const BULK_ERROR_THRESHOLD = 3;
/** Grid dùng chung cho header + từng dòng — đảm bảo 2 hàng luôn khớp cột dù màn hình hẹp
 *  (cuộn ngang qua wrapper overflow-x-auto thay vì vỡ layout). */
const GRID_TEMPLATE = 'grid-cols-[180px_minmax(220px,1fr)_130px_80px_170px_120px_110px]';

interface RowDetails {
  status: VideoLogRowStatus;
  resultUrls?: string[];
  errorMessage?: string;
  creditsConsumed?: number;
  costTime?: number;
}

function formatDate(iso: string): string {
  const d = new Date(iso);
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${pad(d.getDate())}/${pad(d.getMonth() + 1)}/${d.getFullYear()} · ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

function formatTaskIdShort(taskId: string): string {
  if (taskId.length <= 14) return taskId;
  return `${taskId.slice(0, 8)}…${taskId.slice(-4)}`;
}

function InfoBanner({ onDismiss }: { onDismiss: () => void }) {
  return (
    <div className="flex items-start gap-3 rounded-xl border border-primary/40 bg-primary/10 p-4">
      <Info className="w-5 h-5 text-primary shrink-0 mt-0.5" />
      <div className="min-w-0 flex-1">
        <p className="text-xs text-muted-foreground leading-relaxed">
          Link kết quả video sẽ hết hạn sau <strong className="text-foreground">14 ngày</strong>. Dùng nút{' '}
          <strong className="text-foreground">&quot;Tải về&quot;</strong> để lưu video vào máy trước khi hết hạn — việc
          này không ảnh hưởng video đã lưu trong <strong className="text-foreground">Kho video</strong> của bạn.
        </p>
      </div>
      <Button
        type="button"
        variant="icon-ghost"
        onClick={onDismiss}
        className="p-1 shrink-0"
        aria-label="Đóng thông báo"
      >
        <X className="w-3.5 h-3.5" />
      </Button>
    </div>
  );
}

export function VideoLogView() {
  const { user, loading: authLoading } = useAuth();
  const supabaseRef = useRef(createClient());

  const [bannerDismissed, setBannerDismissed] = useState(true);
  useEffect(() => {
    try {
      setBannerDismissed(window.localStorage.getItem(BANNER_DISMISSED_KEY) === '1');
    } catch {
      // localStorage có thể bị chặn — giữ mặc định đã đóng, không chặn UI
    }
  }, []);
  const dismissBanner = useCallback(() => {
    setBannerDismissed(true);
    try {
      window.localStorage.setItem(BANNER_DISMISSED_KEY, '1');
    } catch {
      // ignore
    }
  }, []);

  const [items, setItems] = useState<VideoLogEntry[]>([]);
  const [listState, setListState] = useState<'idle' | 'loading' | 'loaded' | 'error'>('idle');
  const [listErrorMsg, setListErrorMsg] = useState('');
  const [hasMore, setHasMore] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const [rowDetails, setRowDetails] = useState<Record<string, RowDetails>>({});
  const [resultModalUrls, setResultModalUrls] = useState<string[] | null>(null);
  const [downloadingId, setDownloadingId] = useState<string | null>(null);
  const [downloadErrors, setDownloadErrors] = useState<Record<string, string>>({});
  /** Các dòng đang hiện đầy đủ prompt (mặc định rút gọn 2 dòng, bấm vào để xem hết) */
  const [expandedPromptIds, setExpandedPromptIds] = useState<Set<string>>(new Set());

  const [searchInput, setSearchInput] = useState('');
  const debouncedSearch = useDebounce(searchInput, 300);
  const [statusFilter, setStatusFilter] = useState<VideoLogStatusFilter>('all');

  const { copiedId, copy } = useCopyToClipboard();

  /** Tra cứu trạng thái sống 1 dòng qua kie.ai — độc lập, lỗi 1 dòng không ảnh hưởng dòng khác.
   *  Dòng thiếu `videoApiKeyId` (provider khác 'veo', hoặc dữ liệu cũ trước khi có cột này)
   *  không tra cứu được — báo lỗi rõ ràng thay vì gọi API với id rỗng. */
  const enrichRow = useCallback((entry: VideoLogEntry) => {
    if (!entry.videoApiKeyId) {
      setRowDetails((prev) => ({
        ...prev,
        [entry.id]: { status: 'error', errorMessage: 'Không tra được trạng thái task này (thiếu dữ liệu key).' },
      }));
      return;
    }
    setRowDetails((prev) => ({ ...prev, [entry.id]: { status: 'loading' } }));
    void withVideoLogConcurrency(() => videoLogService.getTaskDetails(entry.videoApiKeyId!, entry.veoTaskId))
      .then((details) => {
        if (!details.state) {
          // kie.ai trả thành công nhưng thiếu field state — hình dạng phản hồi không như kỳ
          // vọng (đúng rủi ro đã ghi ở kie-task-details.service.ts). Không đoán mò trạng thái.
          console.error('[video-log] Task details thiếu field "state":', entry.veoTaskId, details);
          setRowDetails((prev) => ({
            ...prev,
            [entry.id]: { status: 'error', errorMessage: 'kie.ai không trả về trạng thái hợp lệ cho task này.' },
          }));
          return;
        }
        setRowDetails((prev) => ({
          ...prev,
          [entry.id]: {
            status: details.state as VideoLogRowStatus,
            resultUrls: details.resultUrls,
            creditsConsumed: details.creditsConsumed,
            costTime: details.costTime,
            errorMessage: details.state === 'fail' ? details.failMsg : undefined,
          },
        }));
      })
      .catch((err) => {
        setRowDetails((prev) => ({
          ...prev,
          [entry.id]: { status: 'error', errorMessage: toUserMessage(err, 'Không tải được trạng thái — thử lại.') },
        }));
      });
  }, []);

  const loadPage = useCallback((offset: number, search: string, append: boolean) => {
    const supabase = supabaseRef.current;
    if (!user || !supabase) return;

    if (append) setLoadingMore(true);
    else { setListState('loading'); setListErrorMsg(''); }

    fetchVideoLogPage(supabase, user.id, { offset, limit: PAGE_SIZE, search })
      .then((result) => {
        setItems((prev) => (append ? [...prev, ...result.items] : result.items));
        setHasMore(result.hasMore);
        setListState('loaded');
        for (const entry of result.items) enrichRow(entry);
      })
      .catch((err) => {
        setListErrorMsg(toUserMessage(err, 'Không tải được nhật ký — thử lại.'));
        setListState('error');
      })
      .finally(() => setLoadingMore(false));
  }, [user, enrichRow]);

  // Tải lần đầu + tải lại khi đổi search (debounced) — reset về trang đầu
  useEffect(() => {
    if (authLoading || !user) return;
    setRowDetails({});
    loadPage(0, debouncedSearch, false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [authLoading, user, debouncedSearch]);

  const handleLoadMore = () => {
    loadPage(items.length, debouncedSearch, true);
  };

  const handleRefreshAll = () => {
    for (const entry of items) enrichRow(entry);
  };

  const handleRefreshRow = (entry: VideoLogEntry) => {
    enrichRow(entry);
  };

  /** Tải video kết quả về máy — fetch thành blob rồi trigger download (giống render-history-
   *  settings.tsx), không mở tab mới trỏ thẳng URL kie.ai (dễ bị chặn popup, và URL sẽ hết hạn). */
  const handleDownload = async (entry: VideoLogEntry, resultUrl: string) => {
    setDownloadErrors((prev) => {
      const next = { ...prev };
      delete next[entry.id];
      return next;
    });
    setDownloadingId(entry.id);
    try {
      const res = await fetch(resultUrl);
      if (!res.ok) throw new Error(`Tải video lỗi (${res.status})`);
      const blob = await res.blob();
      const safeName = (entry.projectTitle ?? 'video').replace(/[\\/:*?"<>|]/g, '').trim() || 'video';
      const sceneLabel = typeof entry.sceneIndex === 'number' ? `-canh-${entry.sceneIndex + 1}` : '';
      downloadBlob(blob, `${safeName}${sceneLabel}-${formatTaskIdShort(entry.veoTaskId)}.mp4`);
    } catch (err) {
      setDownloadErrors((prev) => ({
        ...prev,
        [entry.id]: toUserMessage(err, 'Tải video thất bại — có thể link đã hết hạn.'),
      }));
    } finally {
      setDownloadingId(null);
    }
  };

  const togglePromptExpanded = (entryId: string) => {
    setExpandedPromptIds((prev) => {
      const next = new Set(prev);
      if (next.has(entryId)) next.delete(entryId);
      else next.add(entryId);
      return next;
    });
  };

  const clearSearch = () => setSearchInput('');

  // ─── Render states ─────────────────────────────────────────────────────────

  if (authLoading) {
    return <div className="h-24 rounded-xl bg-muted/20 animate-pulse" />;
  }

  if (!user) {
    return (
      <div className="bg-card border border-dashed border-border rounded-2xl p-10 flex flex-col items-center text-center gap-3">
        <div className="w-12 h-12 rounded-xl bg-orange-500/10 border border-orange-500/30 flex items-center justify-center">
          <AlertCircle className="w-6 h-6 text-orange-400" />
        </div>
        <div>
          <p className="text-sm font-semibold text-foreground">Cần đăng nhập để xem Nhật Ký</p>
          <p className="text-xs text-muted-foreground mt-1 max-w-sm">
            Nhật Ký được lưu riêng theo tài khoản — đăng nhập để xem lịch sử video đã tạo.
          </p>
        </div>
      </div>
    );
  }

  const filteredItems = items.filter((entry) => matchesStatusFilter(rowDetails[entry.id]?.status, statusFilter));
  const errorRowCount = items.filter((entry) => rowDetails[entry.id]?.status === 'error').length;
  const showBulkErrorBanner = errorRowCount >= BULK_ERROR_THRESHOLD;
  const isLoadingFirstPage = listState === 'loading';

  return (
    <section className="space-y-6">
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <h2 className="section-label">NHẬT KÝ</h2>
        <Button
          type="button"
          variant="outline"
          size="sm"
          onClick={handleRefreshAll}
          disabled={isLoadingFirstPage || items.length === 0}
        >
          <RefreshCw className="w-3.5 h-3.5" />
          Làm mới trang
        </Button>
      </div>

      {!bannerDismissed && <InfoBanner onDismiss={dismissBanner} />}

      {/* Filter row */}
      <div className="flex items-center gap-2 flex-wrap">
        <div className="relative flex-1 min-w-[180px]">
          <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-muted-foreground pointer-events-none" />
          <input
            type="text"
            value={searchInput}
            onChange={(e) => setSearchInput(e.target.value)}
            placeholder="Tìm theo Task ID, tiêu đề hoặc prompt..."
            className="w-full pl-8 pr-8 py-2 text-xs bg-muted/40 border border-border rounded-lg text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-primary/30"
          />
          {searchInput && (
            <Button
              type="button"
              variant="icon-ghost"
              size="icon"
              onClick={clearSearch}
              className="absolute right-1 top-1/2 -translate-y-1/2 p-1"
              aria-label="Xoá tìm kiếm"
            >
              <X className="w-3.5 h-3.5" />
            </Button>
          )}
        </div>
        <Select
          value={statusFilter}
          onChange={setStatusFilter}
          options={VIDEO_LOG_STATUS_FILTER_OPTIONS}
          aria-label="Lọc theo trạng thái"
          className="w-44"
        />
      </div>

      {listState === 'error' && (
        <ErrorBanner
          error={{ title: listErrorMsg, actionLabel: 'Thử lại' }}
          onAction={() => loadPage(0, debouncedSearch, false)}
        />
      )}

      {showBulkErrorBanner && (
        <ErrorBanner
          error={{
            title: 'Không lấy được trạng thái chi tiết từ key cho nhiều video.',
            description: 'API có thể chưa hỗ trợ tra cứu này cho Veo. Vẫn hiển thị được prompt/ngày tạo (dữ liệu nội bộ).',
          }}
        />
      )}

      {isLoadingFirstPage ? (
        <div className="space-y-1.5">
          {[0, 1, 2].map((i) => (
            <div key={i} className="h-16 rounded-xl border border-border bg-muted/20 animate-pulse" />
          ))}
        </div>
      ) : items.length === 0 ? (
        <div className="py-10 text-center space-y-2">
          <Film className="w-10 h-10 text-muted-foreground/30 mx-auto" />
          <p className="text-sm text-muted-foreground">Chưa có video nào trong nhật ký</p>
        </div>
      ) : filteredItems.length === 0 ? (
        <div className="py-10 text-center space-y-3">
          <Search className="w-10 h-10 text-muted-foreground/30 mx-auto" />
          <p className="text-sm text-muted-foreground">Không có kết quả khớp bộ lọc</p>
          <Button variant="ghost" size="sm" onClick={() => { clearSearch(); setStatusFilter('all'); }}>
            Xoá bộ lọc
          </Button>
        </div>
      ) : (
        <div className="overflow-x-auto">
          <div className="min-w-270">
            {/* Header cột — cùng GRID_TEMPLATE với từng dòng bên dưới để luôn khớp */}
            <div className={cn('grid gap-3 px-3 pb-2 text-[10px] font-semibold uppercase tracking-wide text-muted-foreground/70 border-b border-border', GRID_TEMPLATE)}>
              <span>Mô hình & Ngày tạo</span>
              <span>Cảnh / Prompt</span>
              <span>Trạng thái</span>
              <span>Credits</span>
              <span>ID Tác vụ</span>
              <span>Kết quả</span>
              <span>Tải về</span>
            </div>

            <div className="space-y-1.5 mt-2">
              {filteredItems.map((entry) => {
                const details = rowDetails[entry.id];
                const status = details?.status ?? 'loading';
                const meta = VIDEO_LOG_STATUS_META[status];
                const canViewResult = status === 'success' && Boolean(details?.resultUrls?.length);
                const showInlineError = status === 'error' && !showBulkErrorBanner;
                const downloadError = downloadErrors[entry.id];
                const isDownloading = downloadingId === entry.id;

                return (
                  <div
                    key={entry.id}
                    className={cn('grid gap-3 items-center px-3 py-3 rounded-xl border border-border bg-background/30 hover:bg-background/60 transition-colors duration-150', GRID_TEMPLATE)}
                  >
                    {/* Mô hình & Ngày tạo */}
                    <div className="min-w-0">
                      <span className="text-[10px] font-medium px-1.5 py-0.5 rounded-full bg-indigo-500/15 text-indigo-300 border border-indigo-500/25 inline-block">
                        Veo 3.1
                      </span>
                      <p className="text-[11px] text-muted-foreground mt-1">{formatDate(entry.createdAt)}</p>
                      {typeof details?.costTime === 'number' && (
                        <p className="text-[11px] text-muted-foreground/70">Xử lý: {Math.round(details.costTime / 1000)}s</p>
                      )}
                    </div>

                    {/* Cảnh / Prompt */}
                    <div className="min-w-0">
                      <p className="text-sm font-medium text-foreground truncate">{entry.projectTitle ?? 'Project đã xoá'}</p>
                      {entry.scenePrompt && (
                        <p className="text-[11px] text-muted-foreground line-clamp-2 mt-0.5">{entry.scenePrompt}</p>
                      )}
                    </div>

                    {/* Trạng thái */}
                    <div className="min-w-0">
                      <span className={cn('inline-flex items-center gap-1.5 text-[10px] font-semibold px-2 py-0.5 rounded-full border', meta.badge)}>
                        {status === 'loading'
                          ? <Loader2 className="w-2.5 h-2.5 animate-spin shrink-0" />
                          : <span className={cn('w-1.5 h-1.5 rounded-full shrink-0', meta.dot)} aria-hidden />}
                        {meta.label}
                      </span>
                      {showInlineError && (
                        <p className="text-[11px] text-destructive mt-1 leading-snug">
                          {details?.errorMessage ?? 'Không tải được trạng thái'} —{' '}
                          <Button type="button" variant="ghost" size="sm" onClick={() => handleRefreshRow(entry)} className="h-auto p-0 text-destructive hover:text-destructive hover:bg-transparent underline whitespace-nowrap">
                            Thử lại
                          </Button>
                        </p>
                      )}
                      {status === 'fail' && details?.errorMessage && (
                        <p className="text-[11px] text-destructive mt-1 line-clamp-2">{details.errorMessage}</p>
                      )}
                    </div>

                    {/* Credits — số ĐÃ TRỪ thật (đúng giá "Thu của user" ở GIÁ THEO MODEL lúc
                        tạo), không phải creditsConsumed thô từ kie.ai (số đó là chi phí kie.ai
                        tính cho server, không phải số user bị trừ). */}
                    <div className="min-w-0">
                      {entry.creditAmount === null ? (
                        <span className="text-xs text-muted-foreground">—</span>
                      ) : entry.creditRefunded ? (
                        <span className="text-xs text-muted-foreground line-through" title="Video tạo thất bại — đã hoàn lại credit">
                          {entry.creditAmount}
                        </span>
                      ) : (
                        <span className="text-xs font-semibold text-foreground tabular-nums">{entry.creditAmount}</span>
                      )}
                    </div>

                    {/* ID Tác vụ */}
                    <div className="min-w-0">
                      <Button
                        type="button"
                        variant="ghost"
                        onClick={() => copy(entry.id, entry.veoTaskId)}
                        className="h-auto p-0 gap-1 text-[11px] font-mono text-muted-foreground hover:text-foreground hover:bg-transparent"
                        title="Sao chép Task ID"
                      >
                        <span className="truncate">{formatTaskIdShort(entry.veoTaskId)}</span>
                        {copiedId === entry.id
                          ? <Check className="w-3 h-3 text-green-400 shrink-0" />
                          : <Copy className="w-3 h-3 shrink-0" />}
                      </Button>
                    </div>

                    {/* Kết quả */}
                    <div>
                      <Button
                        type="button"
                        variant="ghost"
                        onClick={() => canViewResult && setResultModalUrls(details!.resultUrls!)}
                        disabled={!canViewResult}
                        className="px-15 py-1.5 text-primary hover:text-primary hover:bg-primary/10 whitespace-nowrap"
                      >
                        <PlayCircle className="w-3.5 h-3.5 shrink-0" />
                        Xem
                      </Button>
                    </div>

                    {/* Tải về */}
                    <div className="min-w-0">
                      <Button
                        type="button"
                        variant="ghost"
                        onClick={() => canViewResult && void handleDownload(entry, details!.resultUrls![0])}
                        disabled={!canViewResult || isDownloading}
                        className="px-2.5 py-1.5 whitespace-nowrap"
                      >
                        {isDownloading ? <Loader2 className="w-3.5 h-3.5 shrink-0 animate-spin" /> : <Download className="w-3.5 h-3.5 shrink-0" />}
                        Tải về
                      </Button>
                      {downloadError && <p className="text-[10px] text-destructive mt-1 line-clamp-2">{downloadError}</p>}
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        </div>
      )}

      {hasMore && items.length > 0 && filteredItems.length > 0 && (
        <div className="flex justify-center pt-2">
          <Button variant="outline" size="sm" onClick={handleLoadMore} loading={loadingMore}>
            Tải thêm
          </Button>
        </div>
      )}

      <VideoLogResultModal resultUrls={resultModalUrls} onClose={() => setResultModalUrls(null)} />
    </section>
  );
}
