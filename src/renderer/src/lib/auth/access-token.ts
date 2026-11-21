// ─── Access token dạng module state ──────────────────────────────────────────
// Theo đúng pattern của api-keys-store.ts: các service (admin, payment...) nằm ngoài cây
// React nên không đọc được context. AuthProvider đẩy token vào đây mỗi khi phiên đổi, service
// đọc ra khi cần đính header Authorization.
//
// Không persist: token sống ngắn và Supabase tự quản lý phiên qua cookie — lưu thêm ở
// localStorage chỉ tăng bề mặt rò rỉ mà không giải quyết vấn đề gì.

let accessToken: string | null = null;

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** AuthProvider gọi mỗi khi session thay đổi (kể cả khi đăng xuất — truyền null) */
export function setAccessToken(token: string | null): void {
  accessToken = token;
}

export function getAccessToken(): string | null {
  return accessToken;
}

/** Chờ token có sẵn sau OAuth redirect — tránh gọi API trước khi session kịp sync. */
export async function waitForAccessToken(maxWaitMs = 3000): Promise<string | null> {
  if (accessToken) return accessToken;
  const deadline = Date.now() + maxWaitMs;
  while (Date.now() < deadline) {
    await sleep(80);
    if (accessToken) return accessToken;
  }
  return accessToken;
}

/** Header Authorization nếu đã đăng nhập, object rỗng nếu chưa — tiện spread vào fetch */
export function authHeader(): Record<string, string> {
  return accessToken ? { Authorization: `Bearer ${accessToken}` } : {};
}

/** Giống authHeader nhưng chờ token tối đa vài giây (OAuth / mobile). */
export async function authHeaderAsync(maxWaitMs = 3000): Promise<Record<string, string>> {
  const token = await waitForAccessToken(maxWaitMs);
  return token ? { Authorization: `Bearer ${token}` } : {};
}
