import { apiService } from '@/services/api';
import { authHeaderAsync } from '@/lib/auth/access-token';

export type ClientErrorSource = 'scene' | 'project' | 'client';

const SKIP = [/^đã dừng theo yêu cầu\.?$/i, /^chưa tạo — đã dừng/i];

export interface ReportUserErrorPayload {
  source: ClientErrorSource;
  message: string;
  rawMessage?: string;
  projectId?: string;
  sceneId?: string;
  veoTaskId?: string;
  provider?: string;
}

/** Fire-and-forget — không chặn UI, không hiện toast nếu gửi nhật ký lỗi admin thất bại. */
export function reportUserError(payload: ReportUserErrorPayload): void {
  const message = payload.message.trim();
  if (!message || SKIP.some((re) => re.test(message))) return;

  void (async () => {
    try {
      await apiService.post('/user-errors', {
        source: payload.source,
        message,
        rawMessage: payload.rawMessage?.trim() || undefined,
        projectId: payload.projectId,
        sceneId: payload.sceneId,
        veoTaskId: payload.veoTaskId,
        provider: payload.provider,
      }, await authHeaderAsync());
    } catch (err) {
      console.error('[user-errors] Gửi nhật ký lỗi admin thất bại:', err);
    }
  })();
}
