'use client';

import { useState } from 'react';
import { ChevronDown, CheckCircle2, Coins, Headphones, HelpCircle, Infinity as InfinityIcon, Play, ShieldCheck, Sparkle, Zap } from 'lucide-react';
import { cn } from '@/lib/utils';
import { PackageSelector } from '@/components/features/payment/package-selector';
import { CheckoutView } from '@/components/features/payment/checkout-view';
import type { CreditPackage } from '@/lib/credit-packages';

const FEATURE_BADGES = [
  { icon: InfinityIcon, title: 'Credits không hết hạn', desc: 'Sử dụng bất cứ khi nào bạn cần', color: 'text-primary bg-primary/10' },
  { icon: ShieldCheck, title: 'Thanh toán an toàn', desc: 'Mã hoá toàn bộ giao dịch', color: 'text-emerald-400 bg-emerald-500/10' },
  { icon: Zap, title: 'Tự động cộng credits', desc: 'Ngay sau khi thanh toán thành công', color: 'text-primary bg-primary/10' },
  { icon: Headphones, title: 'Hỗ trợ 24/7', desc: 'Đội ngũ hỗ trợ luôn sẵn sàng', color: 'text-primary bg-primary/10' },
];

/** Vị trí rải rác cố định (không random — tránh lệch giữa server/client render gây
 * hydration mismatch) cho các đốm sao trang trí phía sau tiêu đề. */
const SPARKLE_POSITIONS = [
  { top: '4%', left: '38%', size: 10, opacity: 0.5 },
  { top: '15%', left: '92%', size: 14, opacity: 0.6 },
  { top: '55%', left: '96%', size: 8, opacity: 0.4 },
  { top: '2%', left: '70%', size: 8, opacity: 0.35 },
  { top: '70%', left: '4%', size: 10, opacity: 0.4 },
];

/** Chỉ đưa vào câu hỏi có câu trả lời THẬT đã xác nhận trong hệ thống (giá/credit đã chốt,
 * chính sách hết hạn...) — KHÔNG bịa câu trả lời cho những gì chưa chốt (vd chính sách hoàn
 * tiền, cổng thanh toán cụ thể — 2 việc này chưa quyết định lúc viết component này). */
const FAQ_ITEMS = [
  {
    q: 'Credits có hết hạn không?',
    a: 'Không. Credits không hết hạn — mua 1 lần, dùng dần bất cứ khi nào bạn cần.',
  },
  {
    q: 'Mỗi video tốn bao nhiêu credits?',
    a: 'Số credits cần thiết sẽ phụ thuộc vào model, chất lượng và số cảnh bạn lựa chọn.',
  },
  {
    q: 'Credits dùng được cho model Veo nào?',
    a: 'Tất cả model Veo 3.1 hiện có trên nền tảng — không giới hạn theo gói bạn đã mua.',
  },
  {
    q: 'Thanh toán có an toàn không?',
    a: 'Có. Mọi giao dịch đều được mã hoá theo chuẩn bảo mật thanh toán.',
  },
];

function FaqSection() {
  const [openIndex, setOpenIndex] = useState<number | null>(0);

  return (
    <div className="rounded-2xl border border-border bg-card p-5">
      <div className="flex items-center gap-3">
        <span className="flex items-center justify-center w-10 h-10 rounded-xl bg-primary/10 text-primary shrink-0">
          <HelpCircle className="w-5 h-5" />
        </span>
        <div>
          <p className="text-sm font-semibold text-foreground">Câu hỏi thường gặp</p>
          <p className="text-xs text-muted-foreground mt-0.5">Giải đáp nhanh trước khi mua</p>
        </div>
      </div>

      <div className="mt-4 divide-y divide-border/60">
        {FAQ_ITEMS.map((item, i) => {
          const open = openIndex === i;
          return (
            <div key={item.q}>
              <button
                type="button"
                onClick={() => setOpenIndex(open ? null : i)}
                aria-expanded={open}
                className="w-full flex items-center justify-between gap-3 py-2.5 text-left cursor-pointer"
              >
                <span className="text-xs font-semibold text-foreground">{item.q}</span>
                <ChevronDown className={cn('w-3.5 h-3.5 text-muted-foreground shrink-0 transition-transform', open && 'rotate-180')} />
              </button>
              {open && (
                <p className="pb-3 text-xs text-muted-foreground leading-relaxed">{item.a}</p>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}

const WHY_BUY_REASONS = [
  'Tiết kiệm chi phí hơn — mua gói lớn có tỷ giá credit tốt hơn',
  'Chủ động trong việc sáng tạo, không phải chờ duyệt hay xin cấp thêm',
  'Không giới hạn thời gian sử dụng — mua 1 lần, dùng dần khi cần',
  'Sử dụng được toàn bộ tính năng tạo video của nền tảng',
];

export function PaymentView() {
  const [checkoutPkg, setCheckoutPkg] = useState<CreditPackage | null>(null);

  if (checkoutPkg) {
    return <CheckoutView pkg={checkoutPkg} onBack={() => setCheckoutPkg(null)} />;
  }

  return (
    <section className="relative overflow-hidden">
      {/* Ánh sáng nền trang trí — 2 quầng gradient mờ + sao rải rác, thuần CSS,
          overflow-hidden ở section cha chặn tràn layout/scroll ngang. */}
      <div className="pointer-events-none absolute -top-10 right-0 w-72 h-72 rounded-full bg-fuchsia-500/10 blur-3xl" aria-hidden />
      <div className="pointer-events-none absolute top-40 -left-10 w-72 h-72 rounded-full bg-primary/10 blur-3xl" aria-hidden />
      {SPARKLE_POSITIONS.map((s, i) => (
        <Sparkle
          key={i}
          className="pointer-events-none absolute text-primary fill-primary"
          style={{ top: s.top, left: s.left, width: s.size, height: s.size, opacity: s.opacity }}
          aria-hidden
        />
      ))}

      {/* Đồng xu trôi nổi góc phải trên — thuần icon/CSS (không phải ảnh thật), đặt cạnh
          badge "Thanh toán an toàn" cho có chiều sâu, giống khu vực góc trên ảnh mẫu. */}
      <div className="hidden md:block pointer-events-none absolute top-2 right-6 w-32 h-20" aria-hidden>
        <span className="absolute left-0 top-2 flex items-center justify-center w-8 h-8 rounded-full bg-gradient-to-br from-primary to-fuchsia-500 rotate-[-12deg] shadow-lg shadow-primary/30 opacity-80">
          <Coins className="w-4 h-4 text-white" />
        </span>
        <span className="absolute left-10 top-10 flex items-center justify-center w-5 h-5 rounded-full bg-gradient-to-br from-fuchsia-400 to-primary rotate-[10deg] shadow-md shadow-fuchsia-500/30 opacity-70">
          <Coins className="w-2.5 h-2.5 text-white" />
        </span>
        <span className="absolute left-24 top-0 flex items-center justify-center w-6 h-6 rounded-full bg-gradient-to-br from-primary to-fuchsia-500 rotate-[6deg] shadow-md shadow-primary/30 opacity-60">
          <Coins className="w-3 h-3 text-white" />
        </span>
      </div>

      <div className="relative space-y-6">
        <div className="flex items-start justify-between gap-4 flex-wrap">
          <div>
            <h2 className="text-2xl font-bold">
              <span className="text-foreground">Mua thêm </span>
              <span className="bg-gradient-to-r from-primary to-fuchsia-400 bg-clip-text text-transparent">Credits</span>
            </h2>
            <p className="text-sm text-muted-foreground mt-1">Nạp credits để tiếp tục tạo những video AI chất lượng cao</p>
          </div>

          <span className="inline-flex items-center gap-1.5 rounded-full border border-emerald-500/30 bg-emerald-500/10 px-3 py-1 text-[11px] font-medium text-emerald-400">
            <ShieldCheck className="w-3.5 h-3.5" />
            Thanh toán an toàn
          </span>
        </div>

        {/* Feature badges */}
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
          {FEATURE_BADGES.map(({ icon: Icon, title, desc, color }) => (
            <div key={title} className="flex items-center gap-3 rounded-xl border border-border bg-card p-3.5">
              <span className={cn('flex items-center justify-center w-9 h-9 rounded-lg shrink-0', color)}>
                <Icon className="w-4.5 h-4.5" />
              </span>
              <div className="min-w-0">
                <p className="text-xs font-semibold text-foreground truncate">{title}</p>
                <p className="text-[11px] text-muted-foreground truncate">{desc}</p>
              </div>
            </div>
          ))}
        </div>

        <PackageSelector onSelectPackage={setCheckoutPkg} />

        {/* FAQ + why buy */}
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
          <FaqSection />

          <div className="relative overflow-hidden rounded-2xl border border-border bg-card p-5">
            {/* Minh hoạ trang trí góc phải — Play (video) + Coins (credit), thuần icon/CSS,
                không phải ảnh thật. Ẩn trên màn hẹp để không đè lên chữ. */}
            <div className="hidden sm:block absolute -right-3 top-1/2 -translate-y-1/2 w-28 h-28 pointer-events-none" aria-hidden>
              <div className="absolute inset-0 rounded-full bg-primary/20 blur-2xl" />
              <span className="absolute left-1 top-2 flex items-center justify-center w-16 h-16 rounded-2xl bg-gradient-to-br from-primary to-fuchsia-500 -rotate-6 shadow-lg shadow-primary/30">
                <Play className="w-7 h-7 text-white fill-white" />
              </span>
              <span className="absolute right-1 bottom-1 flex items-center justify-center w-12 h-12 rounded-full bg-gradient-to-br from-fuchsia-400 to-primary shadow-lg shadow-fuchsia-500/30">
                <Coins className="w-6 h-6 text-white" />
              </span>
            </div>

            <p className="relative text-sm font-bold bg-gradient-to-r from-primary to-fuchsia-400 bg-clip-text text-transparent">
              Tại sao nên mua credits?
            </p>
            <ul className="relative mt-3 space-y-2.5 max-w-[75%] sm:max-w-[65%]">
              {WHY_BUY_REASONS.map((reason) => (
                <li key={reason} className="flex items-start gap-2 text-xs text-muted-foreground leading-relaxed">
                  <CheckCircle2 className="w-3.5 h-3.5 text-amber-400 shrink-0 mt-0.5" />
                  {reason}
                </li>
              ))}
            </ul>
          </div>
        </div>

        <p className="text-center text-xs text-muted-foreground">
          Nếu bạn gặp vấn đề khi thanh toán, vui lòng <span className="text-primary font-medium">liên hệ hỗ trợ</span>.
        </p>
      </div>
    </section>
  );
}
