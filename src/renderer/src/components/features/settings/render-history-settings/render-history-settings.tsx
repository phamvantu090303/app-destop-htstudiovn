'use client';

import { useEffect, useRef, useState } from 'react';
import { Trash2, CheckCircle2, AlertCircle, Film, Loader2, Download } from 'lucide-react';
import { cn } from '@/lib/utils';
import { FieldError } from '@/components/ui/field-error';
import { ConfirmDialog } from '@/components/ui/confirm-dialog';
import { Button } from '@/components/ui/button';
import { useAuth } from '@/contexts/auth-context';
import { createClient } from '@/lib/supabase/client';
import {
  fetchRenderHistory,
  deleteRenderHistoryEntry,
  clearRenderHistory,
  type RenderHistoryEntry,
} from '@/lib/render-history/render-history-remote';
import { getRenderVideoSignedUrl } from '@/lib/video-library/video-library-storage';
import { downloadBlob } from '@/lib/video-library/video-composer';
import { toUserMessage } from '@/lib/error-messages';

function formatDate(iso: string): string {
  const d = new Date(iso);
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${pad(d.getDate())}/${pad(d.getMonth() + 1)}/${d.getFullYear()} · ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

function formatDuration(seconds: number | null): string | undefined {
  if (!seconds || seconds <= 0) return undefined;
  const m = Math.floor(seconds / 60);
  const s = Math.round(seconds % 60);
  return `${m}:${String(s).padStart(2, '0')}`;
}

function formatSize(bytes: number | null): string {
  if (!bytes || bytes <= 0) return '—';
  const mb = bytes / (1024 * 1024);
  return mb >= 1024 ? `${(mb / 1024).toFixed(2)} GB` : `${mb.toFixed(1)} MB`;
}

export function RenderHistorySettings() {
  const { user, loading: authLoading } = useAuth();
  const supabaseRef = useRef(createClient());
  const syncedForUserRef = useRef<string | null>(null);

  const [items, setItems] = useState<RenderHistoryEntry[]>([]);
  const [loading, setLoading] = useState(false);
  const [loadError, setLoadError] = useState('');
  // Xoá đơn lẻ và "Xoá tất cả" đều dùng chung ConfirmDialog (đồng bộ với video-library-view.tsx,
  // scene-gallery.tsx, character-master.tsx) thay vì pattern bấm-2-lần-trong-3s riêng trước đây.
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);
  const [confirmClearAll, setConfirmClearAll] = useState(false);
  const [downloadingId, setDownloadingId] = useState<string | null>(null);
  const [downloadError, setDownloadError] = useState<string | null>(null);

  useEffect(() => {
    if (authLoading || !user) return;
    if (syncedForUserRef.current === user.id) return;
    const supabase = supabaseRef.current;
    if (!supabase) return;

    syncedForUserRef.current = user.id;
    setLoading(true);
    setLoadError('');
    fetchRenderHistory(supabase, user.id)
      .then(setItems)
      .catch((err) => setLoadError(toUserMessage(err, 'Không tải được lịch sử render — thử lại.')))
      .finally(() => setLoading(false));
  }, [user, authLoading]);

  const deleteItem = async (id: string) => {
    setItems((prev) => prev.filter((i) => i.id !== id));
    setConfirmDeleteId(null);
    const supabase = supabaseRef.current;
    if (user && supabase) {
      try {
        await deleteRenderHistoryEntry(supabase, id);
      } catch (err) {
        console.error('[render-history] Xóa thất bại:', err);
      }
    }
  };

  /** Chỉ khả dụng với video đã bật "Lưu bản sao lên cloud" lúc render (có filePath) */
  const handleDownload = async (item: RenderHistoryEntry) => {
    const supabase = supabaseRef.current;
    if (!item.filePath || !supabase) return;
    setDownloadError(null);
    setDownloadingId(item.id);
    try {
      const url = await getRenderVideoSignedUrl(supabase, item.filePath);
      const blob = await (await fetch(url)).blob();
      downloadBlob(blob, item.fileName);
    } catch (err) {
      setDownloadError(toUserMessage(err, 'Tải lại video thất bại — thử lại.'));
    } finally {
      setDownloadingId(null);
    }
  };

  const clearAll = async () => {
    setConfirmClearAll(false);
    setItems([]);
    const supabase = supabaseRef.current;
    if (user && supabase) {
      try {
        await clearRenderHistory(supabase, user.id);
      } catch (err) {
        console.error('[render-history] Xóa tất cả thất bại:', err);
      }
    }
  };

  if (authLoading) {
    return (
      <div className="panel-card">
        <div className="h-24 rounded-lg bg-muted/20 animate-pulse" />
      </div>
    );
  }

  if (!user) {
    return (
      <div className="bg-card border border-dashed border-border rounded-2xl p-10 flex flex-col items-center text-center gap-3">
        <div className="w-12 h-12 rounded-xl bg-orange-500/10 border border-orange-500/30 flex items-center justify-center">
          <AlertCircle className="w-6 h-6 text-orange-400" />
        </div>
        <div>
          <p className="text-sm font-semibold text-foreground">Cần đăng nhập để xem lịch sử render</p>
          <p className="text-xs text-muted-foreground mt-1 max-w-sm">
            Lịch sử render được lưu riêng theo tài khoản Google — đăng nhập ở mục Cài đặt chung để xem video đã xuất.
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="panel-card space-y-5">
      {/* Header */}
      <div>
        <h4 className="text-sm font-bold text-foreground">Lịch sử render</h4>
        <p className="text-xs text-muted-foreground mt-0.5">{items.length} video · đã render</p>
      </div>

      {loadError && <FieldError>{loadError}</FieldError>}
      {downloadError && <FieldError>{downloadError}</FieldError>}

      {/* List */}
      {loading ? (
        <div className="py-10 flex justify-center">
          <Loader2 className="w-5 h-5 text-muted-foreground animate-spin" />
        </div>
      ) : items.length === 0 ? (
        <div className="py-10 text-center space-y-2">
          <Film className="w-10 h-10 text-muted-foreground/30 mx-auto" />
          <p className="text-sm text-muted-foreground">Chưa có video nào được render</p>
        </div>
      ) : (
        <div className="space-y-1.5">
          {items.map((item) => {
            const duration = formatDuration(item.durationSeconds);
            return (
              <div
                key={item.id}
                className="flex items-center gap-3 p-3 rounded-xl border border-border bg-background/30 hover:bg-background/60 transition-colors duration-150 group"
              >
                {/* Status icon */}
                <div className="shrink-0">
                  {item.status === 'completed'
                    ? <CheckCircle2 className="w-4 h-4 text-green-400" />
                    : <AlertCircle className="w-4 h-4 text-destructive" />
                  }
                </div>

                {/* Info */}
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-medium text-foreground truncate leading-none">{item.fileName}</p>
                  <div className="flex items-center gap-2 mt-1">
                    <span className="text-[11px] text-muted-foreground">{formatDate(item.createdAt)}</span>
                    {duration && (
                      <span className="text-[11px] text-muted-foreground">· {duration}</span>
                    )}
                    <span className="text-[11px] text-muted-foreground">· {formatSize(item.fileSizeBytes)}</span>
                  </div>
                  {item.status === 'failed' && item.errorMessage && (
                    <p className="text-[11px] text-destructive mt-1">{item.errorMessage}</p>
                  )}
                </div>

                {/* Status badge */}
                <span className={cn(
                  'text-[10px] font-semibold px-2 py-0.5 rounded-full shrink-0',
                  item.status === 'completed'
                    ? 'bg-green-500/15 text-green-400'
                    : 'bg-destructive/15 text-destructive',
                )}>
                  {item.status === 'completed' ? 'Hoàn tất' : 'Lỗi'}
                </span>

                {/* Actions — visible on hover */}
                <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity duration-150 shrink-0">
                  {item.filePath && (
                    <Button
                      type="button"
                      variant="icon-ghost"
                      size="icon"
                      onClick={() => handleDownload(item)}
                      disabled={downloadingId === item.id}
                      className="p-1.5"
                      title="Tải lại video"
                      aria-label={`Tải lại video ${item.fileName}`}
                    >
                      {downloadingId === item.id
                        ? <Loader2 className="w-3.5 h-3.5 animate-spin" />
                        : <Download className="w-3.5 h-3.5" />}
                    </Button>
                  )}
                  <Button
                    type="button"
                    variant="icon-danger"
                    size="icon"
                    onClick={() => setConfirmDeleteId(item.id)}
                    className="p-1.5"
                    title="Xóa"
                    aria-label={`Xoá video ${item.fileName}`}
                  >
                    <Trash2 className="w-3.5 h-3.5" />
                  </Button>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* Footer */}
      {items.length > 0 && (
        <div className="flex justify-end pt-2 border-t border-border">
          <Button
            type="button"
            variant="ghost-danger"
            size="sm"
            onClick={() => setConfirmClearAll(true)}
            className="hover:bg-destructive/10"
          >
            <Trash2 className="w-3.5 h-3.5" />
            Xóa tất cả
          </Button>
        </div>
      )}

      <ConfirmDialog
        open={confirmDeleteId !== null}
        title="Xoá video này?"
        message={
          confirmDeleteId
            ? <>&quot;{items.find((i) => i.id === confirmDeleteId)?.fileName}&quot; sẽ bị xoá khỏi lịch sử render, không thể khôi phục.</>
            : ''
        }
        confirmLabel="Xoá video"
        onCancel={() => setConfirmDeleteId(null)}
        onConfirm={() => { if (confirmDeleteId) void deleteItem(confirmDeleteId); }}
      />

      <ConfirmDialog
        open={confirmClearAll}
        title={`Xoá toàn bộ ${items.length} video?`}
        message="Toàn bộ lịch sử render sẽ bị xoá vĩnh viễn, không thể khôi phục."
        confirmLabel="Xoá tất cả"
        onCancel={() => setConfirmClearAll(false)}
        onConfirm={() => void clearAll()}
      />
    </div>
  );
}
