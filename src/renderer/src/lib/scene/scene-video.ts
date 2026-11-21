// ─── Tạo clip video cảnh qua Veo API (hoặc placeholder) ──────────────────────

import type { VideoScene } from '@/lib/scene/scenes';
import type { VeoInput } from '@/lib/pipeline-payload';
import { generateSceneVideoAsset, type SceneVideoCallbacks } from '@/lib/veo/veo-generation';
import { createScenePlaceholderVideo, revokeSceneVideoUrl } from '@/lib/scene/scene-video-placeholder';

/**
 * Tạo clip video cảnh — Veo 3.1 (qua kie.ai hoặc gọi thẳng Google, xem veoInput.provider):
 * start 1 lần → poll → lấy video.
 *
 * 'veo' (mặc định, kie.ai) dùng key hệ thống do admin quản lý — LUÔN thử tạo thật, không còn
 * fallback placeholder (lỗi "chưa cấu hình" từ backend sẽ nổi lên qua đường xử lý lỗi có sẵn
 * của scene-generation-queue.ts). 'veo-gemini' (BYOK) vẫn fallback placeholder khi user chưa
 * nhập "Gemini Key Veo 3.1".
 */
export async function createSceneVideo(
  scene: VideoScene,
  veoInput: VeoInput,
  callbacks?: SceneVideoCallbacks,
  /** Scene Continuity — videoUrl cảnh liền trước (trích khung hình cuối làm khung đầu) */
  previousSceneVideoUrl?: string,
): Promise<string> {
  const quality = veoInput.videoQuality ?? '720p';
  const isGemini = veoInput.provider === 'veo-gemini';

  if (!isGemini || veoInput.apiKey?.trim()) {
    const { videoUrl } = await generateSceneVideoAsset(scene, veoInput, callbacks, previousSceneVideoUrl);
    return videoUrl;
  }

  return createScenePlaceholderVideo(scene, quality, veoInput.aspectRatio);
}

export { revokeSceneVideoUrl };
