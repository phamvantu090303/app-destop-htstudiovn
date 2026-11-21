import type { VeoInput } from '@/lib/pipeline-payload';
import { fetchApi } from '@/services/http';
import { authHeaderAsync } from '@/lib/auth/access-token';

export interface GenerateSceneVideoPayload {
  /** Chỉ cần cho provider 'veo-gemini' (BYOK) — 'veo'/kie.ai backend tự chọn key hệ thống. */
  apiKey?: string;
  prompt: string;
  veoInput: VeoInput;
  durationSeconds: number;
  operationName?: string;
  /** Khung đầu — ảnh nguồn cảnh (tab "Từ hình ảnh") HOẶC khung hình cuối cảnh trước (Scene Continuity) */
  image?: { base64: string; mimeType: string };
}

export interface PollOperationPayload {
  /** Chỉ 'veo-gemini' gửi (BYOK) */
  apiKey?: string;
  /** id (không phải secret) của Video API Key hệ thống đã start task này — 'veo'/kie.ai gửi cái này thay cho apiKey */
  videoApiKeyId?: string;
  operationName: string;
  /** '1080p' → backend tự gọi thêm get-1080p-video sau khi task xong (chỉ kie.ai) */
  quality?: string;
  /**
   * Nhà cung cấp — start đọc được từ veoInput, còn poll/download không có veoInput nên
   * phải gửi riêng để backend biết gọi kie.ai hay Google (xem veo.route.ts).
   */
  provider?: VeoInput['provider'];
}

export interface DownloadVideoPayload {
  /** Chỉ 'veo-gemini' gửi — kie.ai CDN không cần auth để tải video */
  apiKey?: string;
  videoUri: string;
  provider?: VeoInput['provider'];
}

interface ApiResponse<T> {
  success: boolean;
  data?: T;
  error?: string;
  fatal?: boolean;
}

class VeoService {
  private async parseError(res: Response): Promise<never> {
    let message = `Veo lỗi (${res.status})`;
    let fatal = false;
    try {
      const json = (await res.json()) as ApiResponse<unknown>;
      if (json.error) message = json.error;
      if (json.fatal) fatal = true;
    } catch {
      // ignore
    }
    const err = new Error(message);
    (err as Error & { fatal?: boolean }).fatal = fatal;
    throw err;
  }

  /** POST /api/veo/generate/start — đúng 1 lần /veo/generate (kèm image nếu có khung đầu/nối cảnh) */
  async startGeneration(
    payload: Omit<GenerateSceneVideoPayload, 'operationName'>,
  ): Promise<{ operationName: string; videoApiKeyId?: string }> {
    const auth = await authHeaderAsync();
    const res = await fetchApi('/veo/generate/start', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...auth },
      body: JSON.stringify(payload),
    });

    const json = (await res.json()) as ApiResponse<{ operationName: string; videoApiKeyId?: string }>;
    if (!res.ok || !json.success || !json.data?.operationName) {
      const err = new Error(json.error ?? `Veo lỗi (${res.status})`);
      (err as Error & { fatal?: boolean }).fatal = json.fatal;
      throw err;
    }

    return { operationName: json.data.operationName, videoApiKeyId: json.data.videoApiKeyId };
  }

  /** POST /api/veo/operations/poll — chỉ poll status */
  async pollOperation(payload: PollOperationPayload): Promise<{ done: boolean; videoUri?: string; error?: string }> {
    const auth = await authHeaderAsync();
    const res = await fetchApi('/veo/operations/poll', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...auth },
      body: JSON.stringify(payload),
    });

    const json = (await res.json()) as ApiResponse<{ done: boolean; videoUri?: string; error?: string }>;
    if (!res.ok || !json.success) {
      const err = new Error(json.error ?? `Veo poll lỗi (${res.status})`);
      (err as Error & { fatal?: boolean }).fatal = json.fatal;
      throw err;
    }

    return json.data ?? { done: false };
  }

  /** POST /api/veo/generate/download — tải MP4 khi operation DONE */
  async downloadVideo(payload: DownloadVideoPayload): Promise<Blob> {
    const auth = await authHeaderAsync();
    const res = await fetchApi('/veo/generate/download', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...auth },
      body: JSON.stringify(payload),
    });

    if (!res.ok) {
      await this.parseError(res);
    }

    return res.blob();
  }
}

export const veoService = new VeoService();
