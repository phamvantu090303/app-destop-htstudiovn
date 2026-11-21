// ─── Kiểu dữ liệu + helper cho gói tín dụng (System Credits) ────────────────
// Danh sách gói giờ lấy từ API (GET /api/payment/packages → bảng credit_packages), KHÔNG
// còn hardcode ở đây nữa — xem payment.service.ts.

export interface CreditPackage {
  id: string;
  name: string;
  priceVnd: number;
  credit: number;
  /** Credit trừ mỗi cảnh khi dùng gói này — vd Lite 30 credit/cảnh */
  sceneCredit: number;
  description: string | null;
  /** Checklist quyền lợi hiển thị trên thẻ gói — cột credit_packages.features (jsonb),
   * mỗi gói tự có danh sách riêng, sửa trực tiếp trong Supabase là hiện ra ngay. */
  features: string[];
}

export function formatVnd(amount: number): string {
  return amount.toLocaleString('vi-VN') + 'đ';
}

export function pricePerCredit(pkg: CreditPackage): number {
  return pkg.credit > 0 ? pkg.priceVnd / pkg.credit : 0;
}

/** Ước lượng số cảnh tạo được nếu dùng hết credit gói này, theo đúng scene_credit của
 * CHÍNH gói đó (mỗi gói có thể gắn 1 tier/model khác nhau, không dùng chung 1 con số cố định). */
export function scenesEstimate(pkg: CreditPackage): number {
  return pkg.sceneCredit > 0 ? Math.floor(pkg.credit / pkg.sceneCredit) : 0;
}

/** % rẻ hơn so với gói có tỷ giá đ/credit TỆ NHẤT trong danh sách (thường là gói nhỏ nhất) —
 * tính động theo toàn bộ danh sách đang có, không neo cứng vào 1 gói cụ thể như trước. */
export function bonusPercent(pkg: CreditPackage, allPackages: CreditPackage[]): number {
  const rates = allPackages.map(pricePerCredit).filter((r) => r > 0);
  if (rates.length === 0) return 0;
  const worstRate = Math.max(...rates);
  const rate = pricePerCredit(pkg);
  if (worstRate <= 0) return 0;
  return Math.round((1 - rate / worstRate) * 100);
}
