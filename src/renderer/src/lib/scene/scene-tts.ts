// ─── ElevenLabs TTS cho từng cảnh — gắn audioUrl + duration ──────────────────

import type { VideoScene } from '@/lib/scene/scenes';
import type { TtsInput, VeoInput } from '@/lib/pipeline-payload';
import { ttsService } from '@/services/tts/tts.service';
import { revokeSceneVideoUrl } from '@/lib/scene/scene-video-placeholder';
import { createSceneVideo } from '@/lib/scene/scene-video';
import type { SceneVideoCallbacks } from '@/lib/veo/veo-generation';
import { toUserMessage } from '@/lib/error-messages';

/** Thu hồi blob URL audio TTS (tránh rò bộ nhớ) */
function revokeSceneAudioUrl(url?: string) {
  if (url?.startsWith('blob:')) URL.revokeObjectURL(url);
}

/** Đọc metadata audio blob → độ dài giây */
function getAudioDurationSeconds(blobUrl: string): Promise<number> {
  return new Promise((resolve, reject) => {
    const audio = document.createElement('audio');
    audio.preload = 'metadata';
    audio.onloadedmetadata = () => {
      const duration = audio.duration;
      audio.removeAttribute('src');
      audio.load();
      if (!Number.isFinite(duration) || duration <= 0) {
        reject(new Error('Không đọc được độ dài audio'));
        return;
      }
      resolve(duration);
    };
    audio.onerror = () => reject(new Error('Không load được metadata audio'));
    audio.src = blobUrl;
  });
}

/** Cập nhật durationSeconds cảnh theo độ dài audio (+ buffer 0.5s) */
function durationForAudio(baseSeconds: number, audioSeconds: number): number {
  const needed = Math.ceil((audioSeconds + 0.5) * 10) / 10;
  return Math.max(baseSeconds, needed);
}

/** Gọi ElevenLabs TTS → trả blob URL audio (undefined nếu voice rỗng). apiKey rỗng vẫn gọi
 *  bình thường — backend tự dùng pool key hệ thống nếu user chưa có key riêng (xem
 *  elevenlabs.service.ts synthesizeSpeech()). */
async function synthesizeSceneAudio(
  scene: Pick<VideoScene, 'voice'>,
  ttsInput: TtsInput,
  apiKey: string,
): Promise<string | undefined> {
  const text = scene.voice.trim();
  if (!text) return undefined;
  const blob = await ttsService.synthesize({ apiKey, text, ttsInput });
  return URL.createObjectURL(blob);
}

/** TTS một cảnh + cập nhật duration theo độ dài audio — LUÔN gọi kể cả chưa có key riêng
 *  (trước đây âm thầm bỏ qua TTS ở đây khi thiếu key, khiến pool key hệ thống không bao giờ
 *  được chạm tới; giờ để backend tự quyết định dùng key nào). */
export async function attachAudioToSingleScene(
  scene: VideoScene,
  ttsInput: TtsInput,
): Promise<VideoScene> {
  const apiKey = ttsInput.apiKey?.trim() ?? '';

  // KHÔNG revoke audio CŨ ở đây nữa — caller (regenerateSceneAssets) tự quyết định
  // lúc nào an toàn để thu hồi (chỉ sau khi chắc chắn có bản mới thay thế thành công).
  // Ở luồng hàng đợi chính (scene-generation-queue.ts), hàm này chỉ được gọi khi cảnh
  // CHƯA có audioUrl nên không có gì để revoke — bỏ dòng này không đổi hành vi ở đó.
  const audioUrl = await synthesizeSceneAudio(scene, ttsInput, apiKey);
  if (!audioUrl) return { ...scene, audioUrl: undefined, audioPath: undefined };

  // Audio mới sinh — audioPath cũ (nếu có) không còn đại diện đúng nội dung này.
  try {
    const audioLen = await getAudioDurationSeconds(audioUrl);
    return {
      ...scene,
      audioUrl,
      audioPath: undefined,
      audioDurationSeconds: audioLen,
      durationSeconds: durationForAudio(scene.durationSeconds, audioLen),
    };
  } catch {
    return { ...scene, audioUrl, audioPath: undefined };
  }
}

/**
 * TTS + video placeholder cho một cảnh (sau khi sửa prompt/voice).
 * CHỈ ghi đè video/audio cũ khi lượt tạo lại này THÀNH CÔNG. Nếu lỗi (TTS hoặc video)
 * và cảnh đã có video thành công từ trước, trả về nguyên cảnh CŨ (không mất) kèm
 * errorMessage để caller hiện toast báo lỗi — không tự ý xoá video đang dùng được.
 */
export async function regenerateSceneAssets(
  scene: VideoScene,
  ttsInput: TtsInput,
  veoInput: VeoInput,
  callbacks?: SceneVideoCallbacks,
  /** Scene Continuity — videoUrl cảnh liền trước (trích khung hình cuối làm khung đầu) */
  previousSceneVideoUrl?: string,
): Promise<VideoScene> {
  // KHÔNG revoke video/audio CŨ ở đây — chỉ thu hồi sau khi có bản MỚI thay thế
  // thành công (xem 2 nhánh bên dưới), để lỡ lượt tạo lại này lỗi thì cảnh cũ vẫn còn.
  let draft: VideoScene;
  try {
    draft = ttsInput.enabled === false
      ? { ...scene, audioUrl: undefined, audioPath: undefined }
      : await attachAudioToSingleScene(scene, ttsInput);
  } catch {
    draft = { ...scene, audioUrl: undefined, audioPath: undefined };
  }

  // forceNew:true → generateSceneVideoAsset LUÔN bỏ qua next.veoTaskId cũ và start task mới,
  // nên onOperationStarted chắc chắn bắn ra taskId mới trước khi poll — bắt lại đây để trả
  // đúng giá trị mới nhất (kể cả khi poll/download thất bại sau đó), không rơi về giá trị cũ.
  let startedTaskId: string | undefined;
  let startedVideoApiKeyId: string | undefined;

  try {
    const videoUrl = await createSceneVideo(
      draft,
      veoInput,
      {
        forceNew: true,
        onOperationStarted: (operationId, videoApiKeyId) => {
          startedTaskId = operationId;
          startedVideoApiKeyId = videoApiKeyId;
          callbacks?.onOperationStarted?.(operationId, videoApiKeyId);
        },
      },
      previousSceneVideoUrl,
    );

    // Thành công — giờ mới thu hồi blob CŨ (video + audio), vì đã có bản mới thay thế.
    revokeSceneVideoUrl(scene.videoUrl);
    if (draft.audioUrl !== scene.audioUrl) revokeSceneAudioUrl(scene.audioUrl);

    return {
      ...draft,
      videoUrl,
      // veoTaskId KHÔNG bị xoá — giữ lại vĩnh viễn làm audit trail (task nào đã tạo ra
      // video này).
      veoTaskId: startedTaskId,
      videoApiKeyId: startedVideoApiKeyId,
      videoPath: undefined,
      status: 'success',
      errorMessage: undefined,
    };
  } catch (err) {
    // Video lỗi — bản audio MỚI (nếu vừa tạo xong ở bước TTS trên) không dùng tới nữa,
    // thu hồi tránh rò bộ nhớ. Audio/video CŨ giữ nguyên vì đang rollback về cảnh cũ.
    if (draft.audioUrl !== scene.audioUrl) revokeSceneAudioUrl(draft.audioUrl);

    if (scene.videoUrl) {
      // Cảnh ĐÃ có video thành công trước đó — giữ nguyên toàn bộ (video/audio/status),
      // chỉ đính kèm errorMessage để caller hiện toast báo lỗi.
      return {
        ...scene,
        veoTaskId: startedTaskId ?? scene.veoTaskId,
        videoApiKeyId: startedVideoApiKeyId ?? scene.videoApiKeyId,
        errorMessage: toUserMessage(err, 'Tạo lại cảnh thất bại — đã giữ nguyên video cũ.'),
      };
    }

    // Chưa từng có video thành công (lần đầu tạo) — không có gì để giữ, đánh dấu lỗi
    // như trước: status='error' chặn tự resume, user chủ động bấm "Tạo lại" mới thử lại.
    return {
      ...scene,
      videoUrl: undefined,
      veoTaskId: startedTaskId ?? scene.veoTaskId,
      videoApiKeyId: startedVideoApiKeyId ?? scene.videoApiKeyId,
      status: 'error',
      errorMessage: toUserMessage(err, 'Tạo lại cảnh thất bại — thử lại.'),
    };
  }
}
