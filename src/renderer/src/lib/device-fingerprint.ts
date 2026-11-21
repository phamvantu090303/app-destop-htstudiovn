// ─── Device fingerprint — chống farm credit dùng thử qua nhiều tài khoản ────────────────────
// Dùng @fingerprintjs/fingerprintjs bản community (miễn phí, chạy thuần client-side). Đánh
// đổi đã biết: user rành công nghệ vẫn qua được bằng chế độ ẩn danh/xoá storage/VPN — đây là
// lớp chặn phổ thông (chặn số đông), không phải giải pháp chống farm tuyệt đối (muốn vậy cần
// dịch vụ trả phí như FingerprintJS Pro).

import FingerprintJS from '@fingerprintjs/fingerprintjs';

let cached: Promise<string> | null = null;

/** Sinh + cache device fingerprint (visitorId) — chỉ tính toán 1 lần/tab, các lần gọi sau
 * dùng lại promise đã cache (kể cả khi đang tính dở). */
export function getDeviceFingerprint(): Promise<string> {
  if (!cached) {
    cached = FingerprintJS.load()
      .then((fp) => fp.get())
      .then((result) => result.visitorId);
  }
  return cached;
} 
