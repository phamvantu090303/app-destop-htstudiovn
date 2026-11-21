import { fetchApi } from '@/services/http';
import { authHeader } from '@/lib/auth/access-token';
import type { CreditPackage } from '@/lib/credit-packages';

interface ApiResponse<T> {
  success: boolean;
  data?: T;
  error?: string;
  code?: string;
}

export interface BankInfo {
  configured: boolean;
  bankBin?: string;
  accountNumber?: string;
  accountName?: string;
}

export interface CreateOrderResult {
  orderId: string;
  amount: number;
  transferCode: string;
  /** ISO — đơn hết hạn sau 24h, dùng cho đồng hồ đếm ngược */
  expiresAt: string;
  /** URL ảnh VietQR đã nhúng sẵn số tiền + nội dung chuyển khoản */
  qrUrl: string;
  /** true khi trả lại đơn PENDING đã có (idempotent) thay vì tạo đơn mới */
  reused: boolean;
}

export interface OrderStatus {
  paymentStatus: 'PENDING' | 'PAID' | 'FAILED';
  /** Chỉ có giá trị khi paymentStatus === 'PAID' */
  creditAdded: number | null;
}

/** Lỗi có mã — cho UI phân biệt "chưa cấu hình thanh toán" với lỗi thật */
export class PaymentError extends Error {
  constructor(
    message: string,
    public code?: string,
    public status?: number,
  ) {
    super(message);
    this.name = 'PaymentError';
  }
}

class PaymentService {
  /** GET /api/payment/packages — danh sách gói đang bán (status = true), sắp theo display_order. */
  async getPackages(): Promise<CreditPackage[]> {
    const res = await fetchApi('/payment/packages');

    const json = (await res.json()) as ApiResponse<{ packages: CreditPackage[] }>;
    if (!res.ok || !json.success) {
      throw new PaymentError(
        json.error ?? `Không lấy được danh sách gói (${res.status}).`,
        json.code,
        res.status,
      );
    }

    return json.data?.packages ?? [];
  }

  /**
   * GET /api/payment/bank-info — public. Gọi TRƯỚC khi tạo đơn để biết nên hiện QR thật hay
   * trạng thái "kênh thanh toán đang được thiết lập".
   */
  async getBankInfo(): Promise<BankInfo> {
    const res = await fetchApi('/payment/bank-info');

    const json = (await res.json()) as ApiResponse<BankInfo>;
    if (!res.ok || !json.success) {
      throw new PaymentError(
        json.error ?? `Không lấy được thông tin thanh toán (${res.status}).`,
        json.code,
        res.status,
      );
    }

    return json.data ?? { configured: false };
  }

  /**
   * POST /api/payment/create-order — tạo đơn PENDING kèm mã chuyển khoản + QR động.
   * Credit CHƯA được cộng ở bước này: admin đối soát tiền về rồi xác nhận thì mới cộng.
   */
  async createOrder(packageId: string): Promise<CreateOrderResult> {
    const res = await fetchApi('/payment/create-order', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...authHeader() },
      body: JSON.stringify({ packageId }),
    });

    const json = (await res.json()) as ApiResponse<CreateOrderResult>;
    if (!res.ok || !json.success || !json.data) {
      throw new PaymentError(
        json.error ?? `Không tạo được đơn hàng (${res.status}).`,
        json.code,
        res.status,
      );
    }

    return json.data;
  }

  /** GET /api/payment/orders/:id/status — FE poll ở trang checkout để biết webhook đã cộng credit chưa. */
  async getOrderStatus(orderId: string): Promise<OrderStatus> {
    const res = await fetchApi(`/payment/orders/${orderId}/status`, {
      headers: { ...authHeader() },
    });

    const json = (await res.json()) as ApiResponse<OrderStatus>;
    if (!res.ok || !json.success || !json.data) {
      throw new PaymentError(
        json.error ?? `Không kiểm tra được trạng thái đơn hàng (${res.status}).`,
        json.code,
        res.status,
      );
    }

    return json.data;
  }
}

export const paymentService = new PaymentService();
