// ─── Nhãn/màu cho trạng thái đơn hàng — bản dành cho phía user (studio) ───────────────────────
// Cố ý KHÔNG import từ lib/admin/format.ts dù cùng khái niệm (ORDER_STATUS_META) — thư mục
// lib/admin/* chỉ dành cho khu vực /admin (cùng ranh giới với services/admin/*), phía studio
// không import ngược vào đó. Giá trị label/tone giữ giống hệt để trải nghiệm nhất quán.

import type { BadgeProps } from '@/components/ui/badge';
import type { PaymentOrderStatus } from './transaction-history-remote';

type Tone = NonNullable<BadgeProps['tone']>;

export const PAYMENT_ORDER_STATUS_META: Record<PaymentOrderStatus, { label: string; tone: Tone }> = {
  PENDING: { label: 'Chờ xác nhận', tone: 'warning' },
  PAID: { label: 'Đã thanh toán', tone: 'success' },
  FAILED: { label: 'Thất bại', tone: 'danger' },
};

export const PAYMENT_ORDER_STATUS_OPTIONS: { value: PaymentOrderStatus | 'ALL'; label: string }[] = [
  { value: 'ALL', label: 'Tất cả trạng thái' },
  { value: 'PENDING', label: 'Chờ xác nhận' },
  { value: 'PAID', label: 'Đã thanh toán' },
  { value: 'FAILED', label: 'Thất bại' },
];
