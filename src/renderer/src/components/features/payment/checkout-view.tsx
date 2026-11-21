'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import {
  ArrowLeft, Check, ClipboardCheck, Clock, Coins, CreditCard, Gem, Headphones, Info, Landmark,
  Loader2, Lock, RotateCcw, ShieldCheck, Wrench,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import { ErrorBanner } from '@/components/ui/error-banner';
import { useAppToast } from '@/components/ui/toast';
import { formatVnd, type CreditPackage } from '@/lib/credit-packages';
import { mapAppError } from '@/lib/error-messages';
import {
  paymentService, PaymentError, type BankInfo, type CreateOrderResult,
} from '@/services/payment/payment.service';

/** Tần suất FE hỏi lại trạng thái đơn khi đang chờ webhook SePay cộng credit */
const ORDER_STATUS_POLL_MS = 4_000;

/** Đếm ngược tới thời điểm hết hạn đơn (24h) — hiện dạng "23:45:12" hoặc "45:12" */
function useCountdown(expiresAt: string | undefined): string {
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    if (!expiresAt) return;
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, [expiresAt]);

  if (!expiresAt) return '—';

  const remaining = Math.max(0, new Date(expiresAt).getTime() - now);
  const totalSeconds = Math.floor(remaining / 1000);
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;
  const pad = (n: number) => String(n).padStart(2, '0');

  return hours > 0 ? `${hours}:${pad(minutes)}:${pad(seconds)}` : `${pad(minutes)}:${pad(seconds)}`;
}

function CopyRow({ label, value, bold }: { label: string; value: string; bold?: boolean }) {
  const [copied, setCopied] = useState(false);

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(value);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      // Clipboard có thể bị chặn (context không secure/thiếu quyền) — im lặng, user tự copy tay.
    }
  };

  return (
    <div className="flex items-center justify-between gap-2 py-1.5">
      <span className="text-xs text-muted-foreground">{label}</span>
      <div className="flex items-center gap-2 min-w-0">
        <span className={cn('text-xs text-foreground truncate', bold && 'font-bold text-sm text-primary')}>
          {value}
        </span>
        <Button
          type="button"
          variant="ghost"
          size="sm"
          onClick={() => void handleCopy()}
          className="p-0 h-auto hover:bg-transparent text-[11px] font-medium text-primary hover:underline shrink-0"
        >
          {copied ? <Check className="w-3 h-3" /> : 'Sao chép'}
        </Button>
      </div>
    </div>
  );
}

const TRUST_ITEMS = [
  { icon: RotateCcw, label: 'Đối soát thủ công', desc: 'Admin xác nhận trong vài giờ làm việc' },
  { icon: Lock, label: 'Bảo mật tuyệt đối', desc: 'Thông tin của bạn được mã hoá và bảo vệ' },
  { icon: ShieldCheck, label: 'Hỗ trợ khi có lỗi', desc: 'Liên hệ ngay nếu giao dịch gặp vấn đề' },
];

/** Chưa điền thông tin ngân hàng ở server — không hiện QR giả, không hiện nút không làm gì */
function PaymentSetupNotice({ onBack }: { onBack: () => void }) {
  return (
    <div className="rounded-2xl border border-border bg-card p-8 text-center space-y-4 max-w-md mx-auto">
      <div className="w-12 h-12 rounded-xl bg-amber-500/10 border border-amber-500/30 flex items-center justify-center mx-auto">
        <Wrench className="w-6 h-6 text-amber-400" />
      </div>
      <div>
        <p className="text-sm font-bold text-foreground">Kênh thanh toán đang được thiết lập</p>
        <p className="mt-1.5 text-xs text-muted-foreground leading-relaxed">
          Vui lòng quay lại sau ít ngày. Bạn vẫn dùng được credit dùng thử sẵn có trong tài khoản.
        </p>
      </div>
      <Button variant="outline" className="w-full" onClick={onBack}>
        Quay lại
      </Button>
    </div>
  );
}

interface CheckoutViewProps {
  pkg: CreditPackage;
  onBack: () => void;
}

type LoadState = 'loading' | 'ready' | 'not-configured' | 'error';

export function CheckoutView({ pkg, onBack }: CheckoutViewProps) {
  const [state, setState] = useState<LoadState>('loading');
  const [bankInfo, setBankInfo] = useState<BankInfo | null>(null);
  const [order, setOrder] = useState<CreateOrderResult | null>(null);
  const [loadError, setLoadError] = useState<ReturnType<typeof mapAppError> | null>(null);
  const [acknowledged, setAcknowledged] = useState(false);
  const [paidCredit, setPaidCredit] = useState<number | null>(null);
  const [checkingNow, setCheckingNow] = useState(false);
  const toast = useAppToast();

  const countdown = useCountdown(order?.expiresAt);

  /** true nếu đã phát hiện PAID — dùng chung cho cả poll nền lẫn bấm tay "Tôi đã chuyển khoản" */
  const checkOrderStatus = useCallback(async (orderId: string, opts: { notify: boolean }): Promise<boolean> => {
    try {
      const status = await paymentService.getOrderStatus(orderId);
      if (status.paymentStatus === 'PAID') {
        const credit = status.creditAdded ?? pkg.credit;
        setPaidCredit(credit);
        setAcknowledged(true);
        if (opts.notify) {
          toast.success('Thanh toán thành công!', `Đã cộng ${credit.toLocaleString('vi-VN')} credits vào tài khoản.`);
        }
        return true;
      }
      if (opts.notify) {
        toast.info('Chưa ghi nhận thanh toán', 'Hệ thống sẽ tự động kiểm tra lại sau ít phút — không cần chuyển lại.');
      }
      return false;
    } catch (err) {
      if (opts.notify) toast.error(err);
      return false;
    }
  }, [pkg.credit, toast]);

  // Poll trạng thái đơn trong lúc chờ — webhook SePay chạy ở backend, độc lập với trang này,
  // nên FE phải tự hỏi lại định kỳ mới biết được lúc nào credit đã được cộng xong.
  useEffect(() => {
    if (!order || paidCredit !== null) return;

    const orderId = order.orderId;
    const id = setInterval(() => {
      void checkOrderStatus(orderId, { notify: false });
    }, ORDER_STATUS_POLL_MS);

    return () => clearInterval(id);
  }, [order, paidCredit, checkOrderStatus]);

  const handleAcknowledge = useCallback(async () => {
    if (!order || checkingNow) return;
    setAcknowledged(true);
    setCheckingNow(true);
    try {
      await checkOrderStatus(order.orderId, { notify: true });
    } finally {
      setCheckingNow(false);
    }
  }, [order, checkingNow, checkOrderStatus]);

  // React StrictMode (dev) chạy effect mount 2 lần để phát hiện side-effect không an toàn —
  // không có guard này thì createOrder() bị gọi 2 lần gần như đồng thời, tạo 2 record orders
  // (xem migration 0027 — DB đã chặn ở tầng dưới, ref này chặn luôn từ đầu, đỡ tốn round-trip).
  const loadedForPkgIdRef = useRef<string | null>(null);

  const load = useCallback(() => {
    setState('loading');
    setLoadError(null);

    // Hỏi bank-info TRƯỚC: chưa cấu hình thì không gọi create-order (tránh sinh đơn rác).
    paymentService
      .getBankInfo()
      .then(async (info) => {
        setBankInfo(info);
        if (!info.configured) {
          setState('not-configured');
          return;
        }
        const created = await paymentService.createOrder(pkg.id);
        setOrder(created);
        setState('ready');
      })
      .catch((err) => {
        if (err instanceof PaymentError && err.code === 'PAYMENT_NOT_CONFIGURED') {
          setState('not-configured');
          return;
        }
        setLoadError(mapAppError(err, { status: err instanceof PaymentError ? err.status : undefined }));
        setState('error');
      });
  }, [pkg.id]);

  useEffect(() => {
    if (loadedForPkgIdRef.current === pkg.id) return;
    loadedForPkgIdRef.current = pkg.id;
    load();
  }, [pkg.id, load]);

  if (state === 'not-configured') {
    return (
      <section className="space-y-6">
        <Button
          type="button"
          variant="ghost"
          size="sm"
          onClick={onBack}
          className="p-0 h-auto gap-1.5 hover:bg-transparent text-xs font-medium text-primary hover:underline"
        >
          <ArrowLeft className="w-3.5 h-3.5" />
          Quay lại
        </Button>
        <PaymentSetupNotice onBack={onBack} />
      </section>
    );
  }

  if (paidCredit !== null) {
    return (
      <section className="space-y-6">
        <div className="rounded-2xl border border-emerald-500/30 bg-emerald-500/5 p-8 text-center space-y-4 max-w-md mx-auto">
          <div className="w-14 h-14 rounded-full bg-emerald-500/15 border border-emerald-500/30 flex items-center justify-center mx-auto">
            <Check className="w-7 h-7 text-emerald-400" />
          </div>
          <div>
            <p className="text-lg font-bold text-foreground">Thanh toán thành công!</p>
            <p className="mt-1.5 text-sm text-muted-foreground leading-relaxed">
              Bạn đã nhận được{' '}
              <span className="font-semibold text-emerald-400">
                {paidCredit.toLocaleString('vi-VN')} credits
              </span>{' '}
              vào tài khoản.
            </p>
          </div>
          <Button variant="accent" className="w-full" onClick={onBack}>
            Tiếp tục
          </Button>
        </div>
      </section>
    );
  }

  return (
    <section className="space-y-6">
      <div>
        <Button
          type="button"
          variant="ghost"
          size="sm"
          onClick={onBack}
          className="p-0 h-auto gap-1.5 hover:bg-transparent text-xs font-medium text-primary hover:underline"
        >
          <ArrowLeft className="w-3.5 h-3.5" />
          Quay lại
        </Button>

        <div className="mt-3 flex items-start justify-between gap-4 flex-wrap">
          <div>
            <h2 className="text-2xl font-bold text-foreground">
              Thanh toán gói{' '}
              <span className="bg-gradient-to-r from-primary to-fuchsia-400 bg-clip-text text-transparent">
                {pkg.name}
              </span>
            </h2>
            <p className="text-sm text-muted-foreground mt-1">
              Hoàn tất thanh toán để nhận{' '}
              <span className="font-semibold text-foreground">
                {pkg.credit.toLocaleString('vi-VN')} credits
              </span>
            </p>
          </div>
          <div className="flex items-center gap-4">
            <span className="flex items-center gap-2.5">
              <ShieldCheck className="w-4 h-4 text-primary shrink-0" />
              <span>
                <p className="text-xs font-semibold text-foreground">Thanh toán an toàn</p>
                <p className="text-[11px] text-muted-foreground">Mã hoá SSL 256-bit</p>
              </span>
            </span>
            <span className="flex items-center gap-2.5">
              <Headphones className="w-4 h-4 text-primary shrink-0" />
              <span>
                <p className="text-xs font-semibold text-foreground">Hỗ trợ 24/7</p>
                <p className="text-[11px] text-muted-foreground">Đội ngũ luôn sẵn sàng</p>
              </span>
            </span>
          </div>
        </div>
      </div>

      {state === 'error' && loadError && <ErrorBanner error={loadError} onAction={load} />}

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        {/* Cột trái — đơn hàng + phương thức thanh toán */}
        <div className="space-y-4">
          <div className="rounded-2xl border border-border bg-card p-5">
            <p className="text-sm font-semibold text-foreground mb-3">1. Thông tin đơn hàng</p>

            <div className="grid grid-cols-[minmax(0,1fr)_minmax(0,1.3fr)] gap-4">
              {/* Thẻ gói — minh hoạ, thuần icon/CSS (không phải ảnh thật) */}
              <div className="relative overflow-hidden rounded-xl border border-primary/25 bg-gradient-to-br from-primary/15 to-fuchsia-500/10 p-4 flex flex-col items-center text-center justify-center gap-3 min-h-[160px]">
                <span className="flex items-center justify-center w-14 h-14 rounded-2xl bg-gradient-to-br from-primary to-fuchsia-500 shadow-lg shadow-primary/30" aria-hidden>
                  <Gem className="w-7 h-7 text-white" />
                </span>
                <div>
                  <p className="text-sm font-bold text-foreground">Gói {pkg.name}</p>
                  {pkg.description && (
                    <p className="text-xs text-muted-foreground mt-1 leading-relaxed line-clamp-3">
                      {pkg.description}
                    </p>
                  )}
                </div>
              </div>

              {/* Chi tiết đơn hàng */}
              <div className="flex flex-col">
                <div className="space-y-2 text-sm flex-1">
                  <div className="flex items-center justify-between">
                    <span className="text-muted-foreground">Credits</span>
                    <span className="font-semibold text-foreground">
                      {pkg.credit.toLocaleString('vi-VN')} credits
                    </span>
                  </div>
                  <div className="flex items-center justify-between">
                    <span className="text-muted-foreground">Số tiền</span>
                    <span className="font-semibold text-foreground">{formatVnd(pkg.priceVnd)}</span>
                  </div>
                  <div className="flex items-center justify-between">
                    <span className="text-muted-foreground">Ưu đãi</span>
                    <span className="font-semibold text-foreground">-</span>
                  </div>
                  {order && (
                    <div className="flex items-center justify-between">
                      <span className="text-muted-foreground">Mã đơn hàng</span>
                      <span className="font-mono text-[11px] text-muted-foreground">
                        {order.orderId.slice(0, 8)}
                      </span>
                    </div>
                  )}
                </div>

                <div className="mt-3 pt-3 border-t border-border/60 flex items-center justify-between">
                  <span className="text-sm font-semibold text-foreground">Tổng thanh toán</span>
                  <span className="text-lg font-bold text-primary">{formatVnd(pkg.priceVnd)}</span>
                </div>
                <p className="mt-2 flex items-center gap-1.5 text-[11px] text-muted-foreground">
                  <Lock className="w-3.5 h-3.5 text-primary shrink-0" />
                  Giao dịch được bảo vệ và mã hoá an toàn
                </p>
              </div>
            </div>
          </div>

          <div className="rounded-2xl border border-border bg-card p-5">
            <p className="text-sm font-semibold text-foreground mb-3">2. Phương thức thanh toán</p>

            <div className="space-y-2">
              <div className="flex items-center gap-3 rounded-xl border border-primary/40 bg-primary/10 p-3">
                <span className="flex items-center justify-center w-8 h-8 rounded-lg bg-primary/15 text-primary shrink-0">
                  <Landmark className="w-4 h-4" />
                </span>
                <div className="min-w-0 flex-1">
                  <p className="text-xs font-semibold text-foreground">Chuyển khoản ngân hàng</p>
                  <p className="text-[11px] text-muted-foreground">Quét mã QR để thanh toán nhanh chóng</p>
                </div>
                <span className="flex items-center gap-1 text-[11px] font-semibold text-primary shrink-0">
                  <span className="flex items-center justify-center w-4 h-4 rounded-full bg-primary text-white">
                    <Check className="w-2.5 h-2.5" />
                  </span>
                  Đang chọn
                </span>
              </div>

              <div
                className="flex items-center gap-3 rounded-xl border border-border p-3 opacity-50 cursor-not-allowed"
                title="Chưa hỗ trợ — đang hoàn thiện"
              >
                <span className="flex items-center justify-center w-8 h-8 rounded-lg bg-muted text-muted-foreground shrink-0">
                  <CreditCard className="w-4 h-4" />
                </span>
                <div className="min-w-0 flex-1">
                  <p className="text-xs font-semibold text-foreground">Thẻ tín dụng / Thẻ ghi nợ</p>
                  <p className="text-[11px] text-muted-foreground">Sắp ra mắt</p>
                </div>
              </div>
            </div>

            <div className="mt-4 pt-4 border-t border-border/60 grid grid-cols-3 gap-3">
              {TRUST_ITEMS.map(({ icon: Icon, label, desc }) => (
                <div key={label} className="flex items-start gap-2">
                  <span className="flex items-center justify-center w-7 h-7 rounded-lg bg-primary/10 text-primary shrink-0">
                    <Icon className="w-3.5 h-3.5" />
                  </span>
                  <div className="min-w-0">
                    <p className="text-[11px] font-semibold text-foreground leading-tight">{label}</p>
                    <p className="text-[10px] text-muted-foreground leading-tight mt-0.5">{desc}</p>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>

        {/* Cột phải — QR chuyển khoản thật */}
        <div className="rounded-2xl border border-border bg-card p-5">
          <div className="flex items-center justify-between gap-2">
            <p className="text-sm font-semibold text-foreground">3. Quét mã để chuyển khoản</p>
            {order && (
              <span className="flex items-center gap-1 text-xs font-semibold text-rose-400 tabular-nums">
                <Clock className="w-3.5 h-3.5" />
                {countdown}
              </span>
            )}
          </div>
          <p className="text-xs text-muted-foreground mt-1">
            Quét mã QR bằng ứng dụng ngân hàng — số tiền và nội dung đã điền sẵn
          </p>

          <div className="mt-4 flex items-center justify-center rounded-xl bg-white p-4 min-h-[220px]">
            {state === 'loading' && <Loader2 className="w-8 h-8 animate-spin text-muted-foreground" />}
            {order && (
              // eslint-disable-next-line @next/next/no-img-element -- ảnh QR từ vietqr.io, domain ngoài
              <img
                src={order.qrUrl}
                alt={`Mã QR chuyển khoản ${order.transferCode}`}
                className="w-full max-w-[240px] h-auto"
              />
            )}
          </div>

          {order && bankInfo?.configured && (
            <div className="mt-4 rounded-xl border border-border bg-background/40 p-3 divide-y divide-border/60">
              <CopyRow label="Số tài khoản" value={bankInfo.accountNumber ?? ''} />
              <CopyRow label="Chủ tài khoản" value={bankInfo.accountName ?? ''} />
              <CopyRow label="Nội dung chuyển khoản" value={order.transferCode} bold />
              <CopyRow label="Số tiền" value={formatVnd(order.amount)} bold />
            </div>
          )}

          {order && (
            <div className="mt-4 flex items-start gap-2 rounded-xl border border-primary/20 bg-primary/5 p-3">
              <Info className="w-3.5 h-3.5 text-primary shrink-0 mt-0.5" />
              <p className="text-[11px] text-muted-foreground leading-relaxed">
                Vui lòng không ghi thêm nội dung khác — giữ nguyên nội dung chuyển khoản để hệ
                thống đối soát đúng đơn của bạn.
              </p>
            </div>
          )}
        </div>
      </div>

      {order && (
        <div className="rounded-2xl border border-primary/30 bg-gradient-to-br from-primary/15 to-fuchsia-500/10 p-4 flex flex-col sm:flex-row items-center gap-4">
          <div className="flex items-center gap-3 shrink-0">
            <span className="flex items-center justify-center w-10 h-10 rounded-full bg-primary/20 text-primary shrink-0">
              <Coins className="w-5 h-5" />
            </span>
            <div>
              <p className="text-xs text-muted-foreground">Bạn sẽ nhận được</p>
              <p className="text-sm font-bold text-primary">
                {pkg.credit.toLocaleString('vi-VN')} credits
              </p>
            </div>
          </div>

          {/* Tiến trình đơn hàng — bước 3 luôn ở trạng thái "đang chờ": FE không biết thời
              điểm admin đối soát xong, chỉ có thể xác nhận 2 bước đầu ngay tại đây. */}
          <div className="flex-1 flex items-center justify-center gap-1.5 min-w-0">
            {[
              { label: 'Tạo đơn hàng', icon: Check, done: true },
              { label: 'Chuyển khoản', icon: Landmark, done: acknowledged },
              { label: 'Xác nhận & cộng credits', icon: ClipboardCheck, done: false },
            ].map((step, i, arr) => {
              const StepIcon = step.icon;
              const isCurrent = !step.done && (i === 0 || arr[i - 1].done);
              return (
                <div key={step.label} className="flex items-center gap-1.5 min-w-0">
                  <div className="flex flex-col items-center gap-1 w-16 shrink-0">
                    <span
                      className={cn(
                        'flex items-center justify-center w-7 h-7 rounded-full border-2 shrink-0',
                        step.done && 'bg-primary border-primary text-white',
                        !step.done && isCurrent && 'border-primary text-primary bg-primary/10',
                        !step.done && !isCurrent && 'border-border text-muted-foreground bg-background/40',
                      )}
                    >
                      <StepIcon className="w-3.5 h-3.5" />
                    </span>
                    <p
                      className={cn(
                        'text-[9px] text-center leading-tight',
                        step.done || isCurrent ? 'font-semibold text-foreground' : 'text-muted-foreground',
                      )}
                    >
                      {step.label}
                    </p>
                  </div>
                  {i < arr.length - 1 && (
                    <span
                      className={cn('w-6 sm:w-10 h-0 border-t-2 border-dashed shrink-0 -mt-4', step.done ? 'border-primary' : 'border-border')}
                      aria-hidden
                    />
                  )}
                </div>
              );
            })}
          </div>

          <div className="text-center shrink-0">
            <Button variant="accent" onClick={() => void handleAcknowledge()} disabled={checkingNow} className="px-5">
              {checkingNow ? (
                <Loader2 className="w-4 h-4 animate-spin" />
              ) : (
                <Check className="w-4 h-4" />
              )}
              {checkingNow ? 'Đang kiểm tra...' : 'Tôi đã chuyển khoản'}
            </Button>
            <p className="mt-1.5 max-w-[180px] text-[10px] text-muted-foreground leading-tight">
              Bấm để kiểm tra ngay — hệ thống vẫn tự động kiểm tra định kỳ dù bạn không bấm.
            </p>
          </div>
        </div>
      )}
    </section>
  );
}
