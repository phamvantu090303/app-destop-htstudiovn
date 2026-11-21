import { fetchApi } from '@/services/http';
import { authHeader } from '@/lib/auth/access-token';

export type KieTaskState = 'waiting' | 'queuing' | 'generating' | 'success' | 'fail';

export interface KieTaskDetails {
  taskId: string;
  model?: string;
  state?: KieTaskState;
  resultUrls: string[];
  failMsg?: string;
  costTime?: number;
  creditsConsumed?: number;
  completeTime?: number;
  createTime?: number;
  progress?: number;
}

interface ApiResponse<T> {
  success: boolean;
  data?: T;
  error?: string;
}

class VideoLogService {
  /** POST /api/video-log/task-details — tra cứu trạng thái/kết quả 1 task Veo qua kie.ai.
   *  `videoApiKeyId` là id (không phải secret) của Video API Key hệ thống đã tạo ra task này. */
  async getTaskDetails(videoApiKeyId: string, taskId: string): Promise<KieTaskDetails> {
    const res = await fetchApi('/video-log/task-details', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...authHeader() },
      body: JSON.stringify({ videoApiKeyId, taskId }),
    });

    const json = (await res.json()) as ApiResponse<KieTaskDetails>;
    if (!res.ok || !json.success || !json.data) {
      throw new Error(json.error ?? `Không lấy được chi tiết task (${res.status}).`);
    }

    return json.data;
  }
}

export const videoLogService = new VideoLogService();
