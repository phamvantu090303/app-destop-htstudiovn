// ─── fetch wrapper dùng chung cho các service gọi backend ───────────────────

/** Phải kết thúc bằng `/api` — các service gọi path dạng `/gemini/analyze`, `/tts/synthesize`... */
export const API_BASE = import.meta.env.VITE_API_URL || 'http://localhost:4000/api';

function connectionErrorMessage(): string {
  const base = `Không kết nối được backend (${API_BASE}).`;
  if (process.env.NODE_ENV === 'development') {
    return `${base} Hãy chạy backend (npm run dev:be trong dự án web-video) hoặc kiểm tra VITE_API_URL trong .env.`;
  }
  return `${base} Kiểm tra backend đang chạy và VITE_API_URL (đặt trong .env lúc build).`;
}

/** `fetch` tới backend — báo lỗi thân thiện khi backend chưa chạy / mất kết nối / bị CORS chặn. */
export async function fetchApi(path: string, options?: RequestInit): Promise<Response> {
  try {
    return await fetch(`${API_BASE}${path}`, options);
  } catch {
    throw new Error(connectionErrorMessage());
  }
}
