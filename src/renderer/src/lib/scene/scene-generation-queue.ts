// ─── Hàng đợi sinh cảnh: TTS → Veo tuần tự, cập nhật UI từng bước ───────────

import type { VideoScene } from '@/lib/scene/scenes';
import { recalculateSceneTimings } from '@/lib/scene/scenes';
import { attachAudioToSingleScene } from '@/lib/scene/scene-tts';
import { createSceneVideo } from '@/lib/scene/scene-video';
import { getVideoDurationSeconds } from '@/lib/scene/scene-video-duration';
import { isFatalVeoError, sceneNeedsVeoResume } from '@/lib/veo/veo-generation';
import { isSceneStopped, clearSceneStopped, SceneStoppedError } from '@/lib/veo/veo-generation-lock';
import type { TtsInput, VeoInput } from '@/lib/pipeline-payload';
import { toUserMessage } from '@/lib/error-messages';

export type SceneQueueStep = 'pending' | 'tts' | 'video' | 'done' | 'error';

export interface SceneQueueItem {
  sceneId: string;
  index: number;
  prompt: string;
  voice: string;
  step: SceneQueueStep;
  errorMessage?: string;
}

export interface SceneQueueCallbacks {
  onScenesUpdate: (scenes: VideoScene[]) => void;
  onQueueUpdate?: (items: SceneQueueItem[]) => void;
  /** Dừng toàn queue khi Billing/Quota */
  onFatalError?: (message: string) => void;
  /** Kiểm tra epoch — return false để hủy queue */
  shouldContinue?: () => boolean;
  /**
   * Gọi đúng lúc 1 lượt generate THẬT SỰ vừa start xong (có taskId mới) — dùng để ghi
   * 1 dòng lịch sử mới vào bảng audit `veo_task_records` (fire-and-forget, không chặn
   * queue). Không ảnh hưởng state in-memory (`working.veoTaskId` vẫn set như cũ).
   * `videoApiKeyId` — chỉ có ở provider 'veo' (kie.ai, key hệ thống do admin quản lý), cần
   * lưu kèm để poll/tra cứu lại đúng key này về sau.
   */
  onTaskStarted?: (sceneId: string, taskId: string, videoApiKeyId?: string) => void;
  /** Cảnh vừa tạo video thành công — upload blob lên Storage trước khi cập nhật UI */
  onPersistSceneAssets?: (scene: VideoScene) => Promise<VideoScene>;
  /** Lỗi 1 cảnh (TTS/Veo) — ghi nhật ký admin, không chặn queue */
  onSceneFailed?: (info: { sceneId: string; message: string; rawMessage?: string; step: 'tts' | 'video' }) => void;
}

export interface SceneQueueOptions {
  /** Chỉ poll các cảnh đang generating + có task — không lật cảnh lỗi/đã sửa thành generating. */
  resumeOnly?: boolean;
}

function buildQueueItems(scenes: VideoScene[]): SceneQueueItem[] {
  return scenes.map((s) => ({
    sceneId: s.id,
    index: s.index,
    prompt: s.prompt,
    voice: s.voice,
    step: 'pending' as const,
  }));
}

function patchSceneAt(scenes: VideoScene[], index: number, patch: VideoScene): VideoScene[] {
  return recalculateSceneTimings(scenes.map((s, j) => (j === index ? patch : s)));
}

/** Xử lý tuần tự từng cảnh — không gọi Veo song song, không generate trùng */
export async function runSceneGenerationQueue(
  initialScenes: VideoScene[],
  ttsInput: TtsInput,
  veoInput: VeoInput,
  callbacks: SceneQueueCallbacks,
  options?: SceneQueueOptions,
): Promise<VideoScene[]> {
  const queueItems = buildQueueItems(initialScenes);
  const resumeOnly = Boolean(options?.resumeOnly);
  // Đánh dấu 'generating' cho mọi cảnh chưa xong ngay từ đầu — UI hiện spinner
  // "Đang tạo..." cho cả loạt cảnh cùng lúc, dù thực tế xử lý tuần tự bên dưới.
  //
  // QUAN TRỌNG: tin vào `status` — KHÔNG đòi thêm `videoUrl` — vì videoUrl chỉ là
  // link hiển thị tạm (blob: hoặc signed URL), phải đợi resolveSceneSignedUrls chạy
  // xong (bất đồng bộ, sau khi load trang) mới có. Nếu queue này chạy trước khi
  // videoUrl kịp resolve, đòi thêm điều kiện videoUrl sẽ khiến 1 cảnh ĐÃ 'success'
  // (đã lưu video thật trong Supabase) bị hiểu nhầm là "chưa có video" và bị tạo
  // lại từ đầu — tốn phí API oan VÀ xoá mất videoPath/audioPath cũ đang đúng.
  //
  // resumeOnly: KHÔNG lật error/edited → generating (F5 giữa chừng chỉ poll đúng
  // cảnh đang chờ Veo; cảnh lỗi giữ nguyên để user bấm Tạo lại).
  if (process.env.NODE_ENV !== 'production') console.log('[video-library] runSceneGenerationQueue nhận initialScenes:', initialScenes.map((s) => ({ id: s.id, status: s.status, hasVideoUrl: Boolean(s.videoUrl) })));

  let scenes: VideoScene[] = initialScenes.map((s) => {
    if (s.status === 'success' || s.status === 'edited') return s;
    if (resumeOnly) return s;
    if (sceneNeedsVeoResume(s)) return s;
    if (process.env.NODE_ENV !== 'production') console.log(`[video-library] Cảnh ${s.id} (status=${s.status}) bị đánh dấu 'generating' trong queue init.`);
    return { ...s, status: 'generating' as const };
  });

  callbacks.onScenesUpdate(scenes);

  for (let i = 0; i < scenes.length; i++) {
    // Epoch đổi (video bị hủy/chạy lại) — dừng ngay, không đụng tới scenes vì
    // đã có 1 lượt runSceneGenerationQueue mới (epoch mới) đang tự quản lý rồi.
    if (callbacks.shouldContinue && !callbacks.shouldContinue()) break;

    const scene = scenes[i];

    // Cảnh đã có video thành công từ trước (resume/regenerate 1 phần) — bỏ qua,
    // giữ nguyên video cũ hiển thị, không tạo lại. Tin vào status, không đòi
    // videoUrl (xem giải thích ở trên) — tránh tạo lại + xoá videoPath oan.
    if (scene.status === 'success' || scene.status === 'edited') {
      queueItems[i] = { ...queueItems[i], step: 'done' };
      callbacks.onQueueUpdate?.([...queueItems]);
      continue;
    }

    // F5 resume — chỉ poll cảnh đang chờ Veo; cảnh lỗi/chưa start giữ nguyên.
    if (resumeOnly && !sceneNeedsVeoResume(scene)) {
      continue;
    }

    // User đã bấm "Dừng" cho cảnh này (kể cả trước khi queue kịp xử lý tới) — bỏ qua,
    // không tạo, đánh dấu lỗi rõ ràng thay vì hiện spinner mãi.
    if (isSceneStopped(scene.id)) {
      clearSceneStopped(scene.id);
      // veoTaskId (nếu có) KHÔNG bị xoá — giữ lại làm audit trail, sceneNeedsVeoResume vẫn
      // an toàn vì status='error' ở đây chặn resume, không phụ thuộc riêng veoTaskId.
      const stopped: VideoScene = {
        ...scene,
        status: 'error' as const,
        errorMessage: 'Đã dừng theo yêu cầu.',
      };
      queueItems[i] = { ...queueItems[i], step: 'error', errorMessage: 'Đã dừng theo yêu cầu.' };
      scenes = patchSceneAt(scenes, i, stopped);
      callbacks.onQueueUpdate?.([...queueItems]);
      callbacks.onScenesUpdate([...scenes]);
      continue;
    }

    let working: VideoScene = { ...scene, errorMessage: undefined };

    const skipTts = Boolean(working.audioUrl) || ttsInput.enabled === false;

    if (!skipTts) {
      queueItems[i] = { ...queueItems[i], step: 'tts', errorMessage: undefined };
      callbacks.onQueueUpdate?.([...queueItems]);

      try {
        working = await attachAudioToSingleScene(working, ttsInput);
      } catch (err) {
        // TTS lỗi — CHỈ cảnh này hiện badge "Lỗi" + errorMessage, không dừng
        // queue: nhảy sang cảnh kế tiếp (continue), các cảnh sau vẫn tạo bình thường.
        const message = toUserMessage(err, 'Tạo giọng đọc (TTS) thất bại — thử lại.');
        // veoTaskId (nếu có sót từ trước) KHÔNG bị xoá — giữ audit trail; status='error'
        // đã đủ để chặn tự resume, không phụ thuộc riêng veoTaskId.
        working = { ...working, status: 'error' as const, errorMessage: message };
        queueItems[i] = { ...queueItems[i], step: 'error', errorMessage: message };
        scenes = patchSceneAt(scenes, i, working);
        callbacks.onQueueUpdate?.([...queueItems]);
        callbacks.onScenesUpdate([...scenes]);
        callbacks.onSceneFailed?.({
          sceneId: scene.id,
          message,
          rawMessage: err instanceof Error ? err.message : undefined,
          step: 'tts',
        });
        continue;
      }

      // TTS xong — vẫn hiện spinner "Đang tạo..." (chuyển sang bước tạo video Veo)
      scenes = patchSceneAt(scenes, i, { ...working, status: 'generating' as const });
      callbacks.onScenesUpdate([...scenes]);
    }

    // Kiểm tra lại — user có thể đã bấm "Dừng" TRONG lúc TTS đang chạy (cờ dừng chỉ
    // được check ở đầu vòng lặp, trước TTS). Nếu không check lại ở đây,
    // generateSceneVideoAsset sắp gọi bên dưới sẽ tự xoá cờ dừng này (clearSceneStopped
    // cho lượt tạo mới) và âm thầm tạo video dù user đã yêu cầu dừng.
    if (isSceneStopped(scene.id)) {
      clearSceneStopped(scene.id);
      const stopped: VideoScene = {
        ...working,
        status: 'error' as const,
        errorMessage: 'Đã dừng theo yêu cầu.',
      };
      queueItems[i] = { ...queueItems[i], step: 'error', errorMessage: 'Đã dừng theo yêu cầu.' };
      scenes = patchSceneAt(scenes, i, stopped);
      callbacks.onQueueUpdate?.([...queueItems]);
      callbacks.onScenesUpdate([...scenes]);
      continue;
    }

    queueItems[i] = { ...queueItems[i], step: 'video' };
    callbacks.onQueueUpdate?.([...queueItems]);

    // Scene Continuity — cảnh sau (không phải cảnh 1) nối tiếp bằng KHUNG HÌNH CUỐI của
    // video cảnh liền trước, dùng làm khung đầu cho /veo/generate. scenes[i-1].videoUrl
    // lúc này đã là kết quả mới nhất (loop tuần tự, đã await xong cảnh trước). Nếu undefined
    // (resume mất blob) → generateSceneVideoAsset tự fallback tạo cảnh không có khung nối.
    const previousSceneVideoUrl = veoInput.sceneContinuity && i > 0
      ? scenes[i - 1]?.videoUrl
      : undefined;

    let finished: VideoScene;
    try {
      const videoUrl = await createSceneVideo(working, veoInput, {
        // Đã start (predictLongRunning / createTask) — lưu taskId ngay để nếu user
        // refresh giữa chừng thì lần load sau resume poll tiếp, không start lại
        // (không tốn thêm 1 lần generate). UI vẫn đang hiện spinner lúc này.
        onOperationStarted: (operationId, videoApiKeyId) => {
          const patched: VideoScene = { ...working, veoTaskId: operationId, videoApiKeyId, status: 'generating' };
          working = patched;
          scenes = patchSceneAt(scenes, i, patched);
          callbacks.onScenesUpdate([...scenes]);
          callbacks.onTaskStarted?.(scene.id, operationId, videoApiKeyId);
        },
      }, previousSceneVideoUrl);

      // Đo lại thời lượng THẬT của video vừa tạo — Veo có thể trả về clip lệch vài phần
      // giây so với con số đã "xin" lúc generate. Cập nhật durationSeconds đúng bằng độ dài
      // thật NGAY TẠI ĐÂY (nguồn duy nhất) để timeline preview lẫn export MP4 sau này đều tự
      // động dùng đúng số liệu — không còn cảnh nào bị cắt sớm/loop sai vì durationSeconds cũ.
      const realDurationSeconds = await getVideoDurationSeconds(videoUrl).catch(() => working.durationSeconds);

      // Thành công — hiện video thật đã tạo xong, hết spinner.
      finished = {
        ...working,
        videoUrl,
        durationSeconds: realDurationSeconds,
        // veoTaskId (đã set qua onOperationStarted ở trên) KHÔNG bị xoá — giữ lại vĩnh
        // viễn làm audit trail (task nào đã tạo ra video này). sceneNeedsVeoResume vẫn an
        // toàn vì đòi thêm !videoUrl (giờ đã có) && status='generating' (giờ là 'success').
        // Video mới sinh — xoá path cũ; onPersistSceneAssets (nếu có) upload blob lên Storage ngay.
        videoPath: undefined,
        status: 'success' as const,
        errorMessage: undefined,
      };
      if (callbacks.onPersistSceneAssets) {
        finished = await callbacks.onPersistSceneAssets(finished);
      }
      queueItems[i] = { ...queueItems[i], step: 'done' };
    } catch (err) {
      // User bấm "Dừng" giữa lúc đang poll — không phải lỗi thật, không dừng cả queue,
      // chỉ đánh dấu đúng cảnh này rồi tiếp tục các cảnh sau bình thường.
      if (err instanceof SceneStoppedError) {
        const stopped: VideoScene = {
          ...working,
          status: 'error' as const,
          errorMessage: err.message,
        };
        queueItems[i] = { ...queueItems[i], step: 'error', errorMessage: err.message };
        scenes = patchSceneAt(scenes, i, stopped);
        callbacks.onQueueUpdate?.([...queueItems]);
        callbacks.onScenesUpdate([...scenes]);
        continue;
      }

      const rawMessage = err instanceof Error ? err.message : 'Tạo video thất bại';
      const message = toUserMessage(err, 'Tạo video Veo thất bại — thử lại.');
      const fatalFlag = Boolean((err as Error & { fatal?: boolean }).fatal);
      const isFatal = isFatalVeoError(rawMessage, fatalFlag);

      // Lỗi nghiêm trọng (hết quota/billing/API key sai...) — không có ích gì khi
      // thử tiếp các cảnh sau vì chắc chắn cũng lỗi y hệt. Cảnh này VÀ toàn bộ
      // cảnh phía sau đều chuyển sang hiện badge "Lỗi", dừng hẳn queue.
      if (isFatal) {
        callbacks.onFatalError?.(message);
        // veoTaskId KHÔNG bị xoá — cảnh đã kết luận LỖI (status='error' ở đây), đủ để
        // sceneNeedsVeoResume chặn tự resume mà không cần xoá riêng veoTaskId (giữ lại
        // làm audit trail task nào đã thất bại).
        finished = { ...working, status: 'error' as const, errorMessage: message };
        queueItems[i] = { ...queueItems[i], step: 'error', errorMessage: message };
        scenes = patchSceneAt(scenes, i, finished);

        // Các cảnh phía sau chưa kịp xử lý — vẫn đang ở status 'generating' được
        // set sẵn lúc khởi tạo queue (để hiện spinner cả loạt ngay từ đầu). Dừng
        // queue ở đây thì phải đánh dấu lại, nếu không UI sẽ hiện loading mãi mãi
        // dù thực ra chưa từng được gọi tạo.
        const stoppedMessage = 'Chưa tạo — đã dừng do lỗi nghiêm trọng ở cảnh trước.';
        scenes = scenes.map((s, j) =>
          j > i && s.status === 'generating'
            ? { ...s, status: 'error' as const, errorMessage: stoppedMessage }
            : s,
        );
        for (let j = i + 1; j < queueItems.length; j++) {
          if (queueItems[j].step !== 'done') {
            queueItems[j] = { ...queueItems[j], step: 'error', errorMessage: stoppedMessage };
          }
        }

        callbacks.onQueueUpdate?.([...queueItems]);
        callbacks.onScenesUpdate([...scenes]);
        callbacks.onSceneFailed?.({
          sceneId: scene.id,
          message,
          rawMessage,
          step: 'video',
        });
        break;
      }

      // Lỗi Veo không nghiêm trọng (timeout, lỗi tạm...) — CHỈ cảnh này hiện
      // badge "Lỗi" + errorMessage, các cảnh phía sau vẫn tiếp tục tạo bình thường.
      // veoTaskId KHÔNG bị xoá — dù lỗi tạm, giữ lại làm audit trail; status='error'
      // đã đủ để chặn tự resume, user vẫn phải chủ động bấm "Tạo lại" mới thử lại.
      finished = { ...working, status: 'error' as const, errorMessage: message };
      queueItems[i] = { ...queueItems[i], step: 'error', errorMessage: message };
      scenes = patchSceneAt(scenes, i, finished);
      callbacks.onQueueUpdate?.([...queueItems]);
      callbacks.onScenesUpdate([...scenes]);
      callbacks.onSceneFailed?.({
        sceneId: scene.id,
        message,
        rawMessage,
        step: 'video',
      });
      continue;
    }

    // Cảnh vừa xong (thành công) — patch vào scenes rồi mới xử lý cảnh kế tiếp.
    scenes = patchSceneAt(scenes, i, finished);
    callbacks.onQueueUpdate?.([...queueItems]);
    callbacks.onScenesUpdate([...scenes]);
  }

  return scenes;
}

/** Cảnh cần resume poll sau refresh — Veo 3.1 (cả 2 nhà cung cấp) */
export function scenesNeedingVeoResume(scenes: VideoScene[]): VideoScene[] {
  return scenes.filter((s) => sceneNeedsVeoResume(s));
}
