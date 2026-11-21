'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { AlertCircle, Receipt, Search, X } from 'lucide-react';
import { cn } from '@/lib/utils';
import { useAuth } from '@/contexts/auth-context';
import { createClient } from '@/lib/supabase/client';
import { formatVnd } from '@/lib/credit-packages';
import { useDebounce } from '@/hooks/use-debounce';
import {
  fetchPaymentHistoryPage,
  type PaymentOrderEntry, type PaymentOrderStatus,
} from '@/lib/transaction-history/transaction-history-remote';
import { PAYMENT_ORDER_STATUS_META, PAYMENT_ORDER_STATUS_OPTIONS } from '@/lib/transaction-history/transaction-history-status';
import { toUserMessage } from '@/lib/error-messages';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Select } from '@/components/ui/select';
import { ErrorBanner } from '@/components/ui/error-banner';

const PAGE_SIZE = 20;
/** Grid dùng chung cho header + từng dòng — cùng kỹ thuật với video-log-view.tsx để 2 hàng
 * luôn khớp cột dù cuộn ngang trên màn hẹp. */
const GRID_TEMPLATE = 'grid-cols-[150px_minmax(160px,1fr)_120px_100px_150px_130px]';

function formatDateTime(iso: string): string {
  const d = new Date(iso);
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${pad(d.getDate())}/${pad(d.getMonth() + 1)}/${d.getFullYear()} · ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

export function TransactionHistoryView() {
  const { user, loading: authLoading } = useAuth();
  const supabaseRef = useRef(createClient());

  const [status, setStatus] = useState<PaymentOrderStatus | 'ALL'>('ALL');
  const [searchInput, setSearchInput] = useState('');
  const debouncedSearch = useDebounce(searchInput, 300);
  const [fromDate, setFromDate] = useState('');
  const [toDate, setToDate] = useState('');

  const [items, setItems] = useState<PaymentOrderEntry[]>([]);
  const [listState, setListState] = useState<'idle' | 'loading' | 'loaded' | 'error'>('idle');
  const [listErrorMsg, setListErrorMsg] = useState('');
  const [hasMore, setHasMore] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);

  const dateRangeInvalid = Boolean(fromDate && toDate && fromDate > toDate);

  const loadPage = useCallback((offset: number, append: boolean) => {
    const supabase = supabaseRef.current;
    if (!user || !supabase || dateRangeInvalid) return;

    if (append) setLoadingMore(true);
    else { setListState('loading'); setListErrorMsg(''); }

    fetchPaymentHistoryPage(supabase, user.id, {
      offset,
      limit: PAGE_SIZE,
      status,
      search: debouncedSearch,
      from: fromDate || undefined,
      to: toDate || undefined,
    })
      .then((result) => {
        setItems((prev) => (append ? [...prev, ...result.items] : result.items));
        setHasMore(result.hasMore);
        setListState('loaded');
      })
      .catch((err) => {
        setListErrorMsg(toUserMessage(err, 'Không tải được lịch sử thanh toán — thử lại.'));
        setListState('error');
      })
      .finally(() => setLoadingMore(false));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user, status, debouncedSearch, fromDate, toDate, dateRangeInvalid]);

  // Tải lần đầu + tải lại khi đổi bộ lọc — reset về trang đầu
  useEffect(() => {
    if (authLoading || !user) return;
    loadPage(0, false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [authLoading, user, status, debouncedSearch, fromDate, toDate]);

  const handleLoadMore = () => {
    loadPage(items.length, true);
  };

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
          <p className="text-sm font-semibold text-foreground">Cần đăng nhập để xem Lịch sử thanh toán</p>
          <p className="text-xs text-muted-foreground mt-1 max-w-sm">
            Lịch sử thanh toán được lưu riêng theo tài khoản — đăng nhập để xem các đơn mua credit của bạn.
          </p>
        </div>
      </div>
    );
  }

  const isLoadingFirstPage = listState === 'loading';

  return (
    <section className="space-y-6">
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <h2 className="section-label">LỊCH SỬ THANH TOÁN</h2>
      </div>

      {/* Filter row */}
      <div className="flex items-end gap-2 flex-wrap">
        <div className="relative flex-1 min-w-55">
          <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-muted-foreground pointer-events-none" />
          <input
            type="text"
            value={searchInput}
            onChange={(e) => setSearchInput(e.target.value.slice(0, 100))}
            placeholder="Tìm theo mã CK, mã giao dịch hoặc tên gói..."
            className="w-full pl-8 pr-8 py-2 text-xs bg-muted/40 border border-border rounded-lg text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-primary/30"
          />
          {searchInput && (
            <Button
              type="button"
              variant="icon-ghost"
              size="icon"
              onClick={() => setSearchInput('')}
              className="absolute right-1 top-1/2 -translate-y-1/2 p-1"
              aria-label="Xoá tìm kiếm"
            >
              <X className="w-3.5 h-3.5" />
            </Button>
          )}
        </div>
        <Select
          value={status}
          onChange={setStatus}
          options={PAYMENT_ORDER_STATUS_OPTIONS}
          aria-label="Lọc theo trạng thái"
          className="w-48"
        />
        <div className="flex items-center gap-1.5">
          <input
            type="date"
            value={fromDate}
            onChange={(e) => setFromDate(e.target.value)}
            aria-label="Từ ngày"
            className="px-2 py-2 text-xs bg-muted/40 border border-border rounded-lg text-foreground focus:outline-none focus:ring-1 focus:ring-primary/30"
          />
          <span className="text-xs text-muted-foreground">→</span>
          <input
            type="date"
            value={toDate}
            onChange={(e) => setToDate(e.target.value)}
            aria-label="Đến ngày"
            className="px-2 py-2 text-xs bg-muted/40 border border-border rounded-lg text-foreground focus:outline-none focus:ring-1 focus:ring-primary/30"
          />
        </div>
      </div>

      {dateRangeInvalid && (
        <p className="text-xs text-destructive">Ngày bắt đầu phải trước hoặc bằng ngày kết thúc.</p>
      )}

      {listState === 'error' && (
        <ErrorBanner
          error={{ title: listErrorMsg, actionLabel: 'Thử lại' }}
          onAction={() => loadPage(0, false)}
        />
      )}

      {isLoadingFirstPage ? (
        <div className="space-y-1.5">
          {[0, 1, 2].map((i) => (
            <div key={i} className="h-14 rounded-xl border border-border bg-muted/20 animate-pulse" />
          ))}
        </div>
      ) : items.length === 0 && listState === 'loaded' ? (
        <div className="py-10 text-center space-y-3">
          <Receipt className="w-10 h-10 text-muted-foreground/30 mx-auto" />
          <p className="text-sm text-muted-foreground">Chưa có đơn thanh toán nào khớp bộ lọc</p>
          {(searchInput || status !== 'ALL' || fromDate || toDate) && (
            <Button
              variant="ghost"
              size="sm"
              onClick={() => { setSearchInput(''); setStatus('ALL'); setFromDate(''); setToDate(''); }}
            >
              Xoá bộ lọc
            </Button>
          )}
        </div>
      ) : listState === 'loaded' ? (
        <div className="overflow-x-auto">
          <div className="min-w-220">
            <div className={cn('grid gap-3 px-3 pb-2 text-[10px] font-semibold uppercase tracking-wide text-muted-foreground/70 border-b border-border', GRID_TEMPLATE)}>
              <span>Thời gian</span>
              <span>Gói</span>
              <span>Số tiền</span>
              <span>Credit</span>
              <span>Mã CK</span>
              <span>Trạng thái</span>
            </div>

            <div className="space-y-1.5 mt-2">
              {items.map((entry) => {
                const meta = PAYMENT_ORDER_STATUS_META[entry.paymentStatus];
                return (
                  <div
                    key={entry.id}
                    className={cn('grid gap-3 items-center px-3 py-3 rounded-xl border border-border bg-background/30 hover:bg-background/60 transition-colors duration-150', GRID_TEMPLATE)}
                  >
                    <span className="text-[11px] text-muted-foreground">{formatDateTime(entry.createdAt)}</span>
                    <span className="text-xs text-foreground truncate">{entry.packageName ?? '—'}</span>
                    <span className="text-xs font-semibold text-foreground tabular-nums">{formatVnd(entry.amount)}</span>
                    <span className="text-xs text-emerald-400 font-medium tabular-nums">
                      {entry.packageCredit ? `+${entry.packageCredit.toLocaleString('vi-VN')}` : '—'}
                    </span>
                    <span className="text-[11px] font-mono text-muted-foreground truncate">{entry.transferCode ?? '—'}</span>
                    <div>
                      {meta ? (
                        <Badge tone={meta.tone}>{meta.label}</Badge>
                      ) : (
                        <span className="text-xs text-muted-foreground">{entry.paymentStatus}</span>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        </div>
      ) : null}

      {hasMore && items.length > 0 && (
        <div className="flex justify-center pt-2">
          <Button variant="outline" size="sm" onClick={handleLoadMore} loading={loadingMore}>
            Tải thêm
          </Button>
        </div>
      )}
    </section>
  );
}
