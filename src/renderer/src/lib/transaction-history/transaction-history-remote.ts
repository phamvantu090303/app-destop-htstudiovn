// ─── Đọc bảng orders CỦA CHÍNH user đang đăng nhập cho "Lịch sử thanh toán" ──────────────────
// RLS `orders_select_own` (auth.uid() = user_id, xem supabase-data/migrations/0017_orders.sql)
// tự giới hạn đúng user hiện tại — cùng kiến trúc video-log-remote.ts (query thẳng Supabase từ
// frontend, không qua backend admin).
//
// CỐ Ý KHÔNG đọc payment_logs dù tên nghe hợp: bảng đó lưu RAW payload webhook cổng thanh toán
// (có thể chứa chữ ký/mã giao dịch nội bộ), RLS bật nhưng KHÔNG có policy nào — chỉ backend
// (service role) đọc được, xem comment ở supabase-data/migrations/0018_payment_logs.sql. Và
// cũng KHÔNG đọc credit_transactions (sổ cái credit nội bộ — mua/tiêu/tặng/admin điều chỉnh,
// khác khái niệm "đơn hàng đã thanh toán"). `orders` là bảng ĐÚNG: có RLS cho user tự xem, và
// đúng là lịch sử các lần user tạo đơn mua gói (PENDING/PAID/FAILED).

import type { SupabaseClient } from '@supabase/supabase-js';

export type PaymentOrderStatus = 'PENDING' | 'PAID' | 'FAILED';

export interface PaymentOrderEntry {
  id: string;
  packageId: string | null;
  packageName: string | null;
  packageCredit: number | null;
  /** Số tiền VND phải trả — snapshot lúc tạo order */
  amount: number;
  paymentMethod: string | null;
  paymentStatus: PaymentOrderStatus;
  transferCode: string | null;
  transactionId: string | null;
  paidAt: string | null;
  createdAt: string;
}

interface OrderRow {
  id: string;
  package_id: string | null;
  amount: number;
  payment_method: string | null;
  payment_status: string;
  transfer_code: string | null;
  transaction_id: string | null;
  paid_at: string | null;
  created_at: string;
  credit_packages: { name: string; credit: number } | null;
}

function fromRow(row: OrderRow): PaymentOrderEntry {
  return {
    id: row.id,
    packageId: row.package_id,
    packageName: row.credit_packages?.name ?? null,
    packageCredit: row.credit_packages?.credit ?? null,
    amount: row.amount,
    paymentMethod: row.payment_method,
    paymentStatus: row.payment_status as PaymentOrderStatus,
    transferCode: row.transfer_code,
    transactionId: row.transaction_id,
    paidAt: row.paid_at,
    createdAt: row.created_at,
  };
}

export interface PaymentHistoryFilters {
  status?: PaymentOrderStatus | 'ALL';
  /** ISO date (yyyy-mm-dd) — inclusive */
  from?: string;
  /** ISO date (yyyy-mm-dd) — inclusive */
  to?: string;
  /** Tìm theo mã CK, mã giao dịch, hoặc tên gói — chưa cần trim/escape, hàm tự xử lý */
  search?: string;
}

/** Escape `\`, `%`, `_` trước khi đưa vào ILIKE — tránh wildcard injection ngoài ý muốn. */
function escapeIlikePattern(value: string): string {
  return value.replace(/\\/g, '\\\\').replace(/[%_]/g, (c) => `\\${c}`);
}

/**
 * Gom id các `orders` khớp search theo mã CK, mã giao dịch, HOẶC tên gói — hợp lại làm 1 tập
 * `id` rồi lọc bằng `.in('id', ...)` ở query chính. CHỦ Ý không dùng `.or('col.ilike.%x%,...')`
 * dạng chuỗi DSL (khác admin-orders.route.ts đang làm) — giá trị search do người dùng gõ có thể
 * chứa dấu phẩy/ngoặc, là ký tự có nghĩa cú pháp trong `.or()` của PostgREST, gõ đúng ký tự đó
 * sẽ làm gãy filter hoặc lọc sai âm thầm. `.ilike()`/`.in()` qua phương thức để supabase-js tự
 * escape an toàn — id thu được từ DB (UUID) không có ký tự đặc biệt nên ghép vào `.in()` sau đó
 * luôn an toàn.
 */
async function findMatchingOrderIds(
  supabase: SupabaseClient,
  userId: string,
  pattern: string,
): Promise<string[]> {
  const [transferRes, transactionRes, packageRes] = await Promise.all([
    supabase.from('orders').select('id').eq('user_id', userId).ilike('transfer_code', pattern),
    supabase.from('orders').select('id').eq('user_id', userId).ilike('transaction_id', pattern),
    supabase.from('credit_packages').select('id').ilike('name', pattern),
  ]);

  const ids = new Set<string>();
  for (const row of (transferRes.data ?? []) as { id: string }[]) ids.add(row.id);
  for (const row of (transactionRes.data ?? []) as { id: string }[]) ids.add(row.id);

  const packageIds = (packageRes.data ?? []).map((row) => (row as { id: string }).id);
  if (packageIds.length > 0) {
    const byPackage = await supabase.from('orders').select('id').eq('user_id', userId).in('package_id', packageIds);
    for (const row of (byPackage.data ?? []) as { id: string }[]) ids.add(row.id);
  }

  return [...ids];
}

/**
 * `to` là ngày thuần (yyyy-mm-dd, từ `<input type="date">`) nhưng `created_at` là timestamp —
 * `.lte('created_at', '2026-08-02')` so với '2026-08-02T00:00:00Z', chỉ khớp đúng giao dịch lúc
 * 0h, loại hết phần còn lại trong ngày. Dùng `.lt(created_at, ngày+1)` để "đến hết ngày to".
 */
function dayAfter(dateStr: string): string {
  const d = new Date(`${dateStr}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + 1);
  return d.toISOString().slice(0, 10);
}

export interface FetchPaymentHistoryPageParams extends PaymentHistoryFilters {
  offset: number;
  limit: number;
}

export interface FetchPaymentHistoryPageResult {
  items: PaymentOrderEntry[];
  hasMore: boolean;
}

/** Tải 1 trang — pattern "Tải thêm" giống Nhật Ký (list cá nhân, không phải phân trang số như
 * trang admin — xem comment trong component Pagination). Fetch dư 1 dòng để biết `hasMore`. */
export async function fetchPaymentHistoryPage(
  supabase: SupabaseClient,
  userId: string,
  { offset, limit, status, from, to, search }: FetchPaymentHistoryPageParams,
): Promise<FetchPaymentHistoryPageResult> {
  let query = supabase
    .from('orders')
    .select('id, package_id, amount, payment_method, payment_status, transfer_code, transaction_id, paid_at, created_at, credit_packages(name, credit)')
    .eq('user_id', userId)
    .order('created_at', { ascending: false })
    .range(offset, offset + limit);

  if (status && status !== 'ALL') query = query.eq('payment_status', status);
  if (from) query = query.gte('created_at', from);
  if (to) query = query.lt('created_at', dayAfter(to));

  const trimmedSearch = search?.trim();
  if (trimmedSearch) {
    const pattern = `%${escapeIlikePattern(trimmedSearch)}%`;
    const matchingIds = await findMatchingOrderIds(supabase, userId, pattern);
    if (matchingIds.length === 0) return { items: [], hasMore: false };
    query = query.in('id', matchingIds);
  }

  const { data, error } = await query;
  if (error) throw error;

  const rows = (data ?? []) as unknown as OrderRow[];
  const hasMore = rows.length > limit;
  const items = rows.slice(0, limit).map(fromRow);

  return { items, hasMore };
}
