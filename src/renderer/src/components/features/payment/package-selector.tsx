'use client';

import { useCallback, useEffect, useState } from 'react';
import { AlertCircle, CheckCircle2, Crown, Gem, Loader2, Star, Zap } from 'lucide-react';
import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import {
  bonusPercent,
  formatVnd,
  scenesEstimate,
  type CreditPackage,
} from '@/lib/credit-packages';
import { paymentService } from '@/services/payment/payment.service';
import { toUserMessage } from '@/lib/error-messages';

/** Icon riêng cho từng vị trí gói (1st→4th) — chỉ để phân biệt trực quan, không mang nghĩa
 * tier/quyền lợi thật. Checklist quyền lợi giờ lấy từ `pkg.features` (cột credit_packages.
 * features, migration 0020) — mỗi gói tự có danh sách riêng, không còn hardcode chung. */
const TIER_ICONS = [Gem, Star, Crown, Zap];

function PackageCard({
  pkg,
  icon: Icon,
  bonus,
  highlighted,
  onBuy,
}: {
  pkg: CreditPackage;
  icon: typeof Gem;
  bonus: number;
  highlighted: boolean;
  onBuy: (pkg: CreditPackage) => void;
}) {
  return (
    // Viền gradient hồng→tím cho gói nổi bật — wrapper ngoài tô gradient, padding 1.5px hở
    // ra đúng bằng độ dày viền, card thật nằm trong với bg-card che phần giữa.
    <div
      className={cn(
        'relative rounded-2xl',
        highlighted && 'bg-gradient-to-br from-pink-500 via-fuchsia-500 to-primary p-[1.5px] shadow-[0_0_24px_rgba(217,70,239,0.35)]',
      )}
    >
      <div
        className={cn(
          'relative flex flex-col h-full rounded-2xl bg-card p-5',
          !highlighted && 'border border-border',
        )}
      >
        {highlighted && (
          <span className="absolute -top-3 left-1/2 -translate-x-1/2 inline-flex items-center gap-1 rounded-full bg-gradient-to-r from-pink-500 to-fuchsia-500 px-3 py-0.5 text-[11px] font-bold text-white shadow-md">
            <Star className="w-3 h-3 fill-white" />
            PHỔ BIẾN NHẤT
          </span>
        )}

        <div className="flex items-center gap-1.5">
          <Icon className={cn('w-4 h-4 shrink-0', highlighted ? 'text-amber-400 fill-amber-400' : 'text-muted-foreground')} />
          <p className="text-sm font-bold text-foreground">{pkg.name}</p>
        </div>

        {pkg.description && (
          <p className="mt-2 text-xs text-muted-foreground leading-relaxed line-clamp-2">{pkg.description}</p>
        )}

        <p className="mt-3 text-3xl font-bold text-foreground tabular-nums">{formatVnd(pkg.priceVnd)}</p>

        <div className="mt-2.5 flex items-center gap-1.5">
          <span className="inline-flex items-center rounded-full bg-primary px-2.5 py-1 text-xs font-bold text-primary-foreground tabular-nums">
            {pkg.credit.toLocaleString('vi-VN')} credits
          </span>
        </div>

        {/* <p className="mt-1 text-xs text-muted-foreground">≈ {scenesEstimate(pkg)} cảnh video</p> */}

        <ul className="mt-4 space-y-1.5">
          {pkg.features.map((perk) => (
            <li key={perk} className="flex items-center gap-2 text-xs text-foreground/85">
              <CheckCircle2 className="w-3.5 h-3.5 text-emerald-500 shrink-0" />
              {perk}
            </li>
          ))}
        </ul>

        <Button
          type="button"
          variant={highlighted ? 'accent' : 'outline'}
          size="md"
          className={cn('mt-4 w-full', highlighted && 'bg-gradient-to-r from-pink-500 to-primary border-0 text-white hover:opacity-90')}
          onClick={() => onBuy(pkg)}
        >
          Mua ngay
        </Button>
      </div>
    </div>
  );
}

type LoadState = 'loading' | 'loaded' | 'error';

interface PackageSelectorProps {
  /** Chuyển sang trang checkout (CheckoutView) cho ĐÚNG gói vừa chọn — thay vì gọi thẳng
   * API tạo đơn ở đây, việc đó giờ nằm trong CheckoutView (sau khi user xem kỹ thông tin
   * đơn hàng + chọn phương thức thanh toán). */
  onSelectPackage: (pkg: CreditPackage) => void;
}

export function PackageSelector({ onSelectPackage }: PackageSelectorProps) {
  const [packages, setPackages] = useState<CreditPackage[]>([]);
  const [state, setState] = useState<LoadState>('loading');
  const [loadError, setLoadError] = useState('');

  const loadPackages = useCallback(async () => {
    setState('loading');
    setLoadError('');
    try {
      const list = await paymentService.getPackages();
      setPackages(list);
      setState('loaded');
    } catch (err) {
      setLoadError(toUserMessage(err, 'Không lấy được danh sách gói — thử lại.'));
      setState('error');
    }
  }, []);

  useEffect(() => {
    void loadPackages();
  }, [loadPackages]);

  if (state === 'loading') {
    return (
      <div className="flex items-center gap-2 text-sm text-muted-foreground py-8 justify-center">
        <Loader2 className="w-4 h-4 animate-spin" />
        Đang tải danh sách gói...
      </div>
    );
  }

  if (state === 'error') {
    return (
      <div className="flex items-start gap-2 rounded-xl border border-destructive/40 bg-destructive/10 p-3 text-sm text-destructive">
        <AlertCircle className="w-4 h-4 shrink-0 mt-0.5" />
        <span>{loadError}</span>
      </div>
    );
  }

  if (packages.length === 0) {
    return (
      <p className="text-sm text-muted-foreground py-8 text-center">Hiện chưa có gói nào đang bán.</p>
    );
  }

  // Gói nổi bật — vị trí thứ 2 (khớp quy ước "gói phổ biến ở giữa" thường thấy), chỉ áp dụng
  // khi có từ 2 gói trở lên.
  const highlightIndex = packages.length >= 2 ? 1 : -1;

  return (
    <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4 pt-3">
      {packages.map((pkg, i) => (
        <PackageCard
          key={pkg.id}
          pkg={pkg}
          icon={TIER_ICONS[i % TIER_ICONS.length]}
          bonus={bonusPercent(pkg, packages)}
          highlighted={i === highlightIndex}
          onBuy={onSelectPackage}
        />
      ))}
    </div>
  );
}
