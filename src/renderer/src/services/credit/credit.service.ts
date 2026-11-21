import { fetchApi } from '@/services/http';
import { authHeaderAsync } from '@/lib/auth/access-token';

interface ApiResponse<T> {
  success: boolean;
  data?: T;
  error?: string;
  code?: string;
}

export interface ClaimFreeCreditResult {
  granted: boolean;
  blockReason: 'fingerprint_reused' | 'ip_limit_exceeded' | null;
  balanceAfter: number;
}

class CreditService {
  /**
   * POST /api/credit/claim-free — gọi sau lần đăng nhập đầu, kèm device fingerprint. An toàn
   * gọi lại nhiều lần (mỗi user chỉ được đánh giá đúng 1 lần ở backend, các lần sau trả lại
   * y kết quả cũ, không đánh giá lại).
   */
  async claimFree(fingerprint: string): Promise<ClaimFreeCreditResult> {
    const res = await fetchApi('/credit/claim-free', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...(await authHeaderAsync()) },
      body: JSON.stringify({ fingerprint }),
    });

    const json = (await res.json()) as ApiResponse<ClaimFreeCreditResult>;
    if (!res.ok || !json.success || !json.data) {
      throw new Error(json.error ?? `Không cấp được credit dùng thử (${res.status}).`);
    }

    return json.data;
  }
}

export const creditService = new CreditService();
