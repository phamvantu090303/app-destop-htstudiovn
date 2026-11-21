// ─── Kiểu dữ liệu cảnh video ────────────────────────────────────────────────

import type { TtsInput, VeoInput } from '@/lib/pipeline-payload';
import {
  resolveSceneDurationSeconds,
  snapToVeoDuration,
} from '@/lib/veo/veo-duration';

export type SceneStatus = 'generating' | 'success' | 'error' | 'edited';

export interface VideoScene {
  id: string;
  index: number;
  timeStart: number;
  timeEnd: number;
  prompt: string;
  voice: string;
  durationSeconds: number;
  status: SceneStatus;
  /** Lý do lỗi gần nhất (status === 'error') — hiển thị cho user, clear khi thử lại thành công */
  errorMessage?: string;
  /** Blob URL clip video — sinh sau khi cảnh hoàn thiện ở mục 3 */
  videoUrl?: string;
  /** Blob URL audio MP3 — ElevenLabs TTS từ voiceover */
  audioUrl?: string;
  /** Độ dài thực của MP3 (giây) — dùng sync timeline */
  audioDurationSeconds?: number;
  /**
   * taskId (kie.ai Veo) / operation name (Google Gemini) GẦN NHẤT dùng để tạo video cho
   * cảnh này — dùng để resume poll sau refresh khi status='generating' và chưa có videoUrl
   * (xem sceneNeedsVeoResume). Field in-memory THUẦN TUÝ — KHÔNG còn là cột trên
   * `video_scenes` (đã tách sang bảng audit riêng `veo_task_records`, xem
   * video-library-remote.ts: hydrate từ bản ghi mới nhất khi load, ghi thêm 1 dòng lịch
   * sử mới mỗi khi 1 lượt generate thật sự bắt đầu qua `insertVeoTaskRecord`). KHÔNG bị
   * xoá về undefined khi cảnh xong/lỗi/dừng, chỉ bị GHI ĐÈ khi một lượt generate mới thực
   * sự bắt đầu. Logic resume an toàn vì còn xét thêm status/videoUrl, không chỉ dựa vào
   * trường này.
   */
  veoTaskId?: string;
  /**
   * Id (KHÔNG phải giá trị secret) của Video API Key hệ thống đã tạo ra `veoTaskId` này —
   * chỉ có ý nghĩa với provider 'veo' (kie.ai, key do admin quản lý). Cần dùng LẠI đúng key
   * này khi poll/tải tiếp sau F5 (xem generateSceneVideoAsset ở veo-generation.ts). `undefined`
   * cho provider 'veo-gemini' (BYOK, dùng thẳng apiKey của user) hoặc dữ liệu cũ trước khi có
   * trường này.
   */
  videoApiKeyId?: string;
  /**
   * Thời điểm start task Veo mới nhất (từ `veo_task_records.created_at`) — chỉ hydrate lúc
   * load, không ghi ngược DB. Dùng để hết hạn cảnh 'generating' mồ côi sau khi đóng tab.
   */
  veoTaskStartedAt?: string;
  /** Path trong Supabase Storage bucket `scene-videos` — có nghĩa là video đã lưu cloud */
  videoPath?: string;
  /** Path trong Supabase Storage bucket `scene-audio` */
  audioPath?: string;
  /** Ảnh nguồn (base64, tab "Từ hình ảnh") — Veo dùng làm ảnh mồi tạo video cho đúng cảnh này */
  sourceImageBase64?: string;
  sourceImageMimeType?: string;
  /**
   * Giây bỏ qua từ đầu video GỐC (trim đầu clip — kéo tay ở Timeline mục 4). 0/undefined =
   * không trim. `durationSeconds` vẫn là độ dài THỰC SỰ DÙNG (đã trừ phần trim), không phải
   * độ dài gốc — xem `trimmed` bên dưới để biết vì sao cần tách 2 khái niệm này.
   */
  trimStartSeconds?: number;
  /**
   * true khi user đã tự kéo trim/split cảnh này ở Timeline (mục 4). Cờ này chặn
   * `withRealVideoDurations` (video-composer.ts) ghi đè lại `durationSeconds` bằng độ dài đo
   * lại từ video gốc — nếu không, mỗi lần render sẽ "hoàn tác" trim của user về full video.
   */
  trimmed?: boolean;
}

export interface SceneGenerationResult {
  scenes: VideoScene[];
  sourceContent: string;
  sceneCount: string;
  language: string;
  aspectRatio: string;
  sceneDuration: string;
  veoInput: VeoInput;
  ttsInput: TtsInput;
  inputType?: 'text' | 'link' | 'image';
  /** Prompt mô tả toàn bộ dàn nhân vật (Gemini tự sinh — chỉ có khi inputType === 'link') */
  masterCastPrompt?: string;
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

/** Format giây → `MM:SS` cho hiển thị timeline */
function formatTime(seconds: number): string {
  const m = Math.floor(seconds / 60);
  const s = Math.floor(seconds % 60);
  return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
}

/** Chuỗi hiển thị khoảng thời gian cảnh: `00:00 - 00:06` */
export function formatSceneTimeRange(scene: VideoScene): string {
  return `${formatTime(scene.timeStart)} - ${formatTime(scene.timeEnd)}`;
}

/** Tìm cảnh chứa playhead — fallback cảnh gần nhất, không nhảy về cảnh 1 */
export function findSceneAtPlayhead(scenes: VideoScene[], playhead: number): VideoScene | null {
  if (scenes.length === 0) return null;

  const exact = scenes.find((s) => playhead >= s.timeStart && playhead < s.timeEnd);
  if (exact) return exact;

  if (playhead >= scenes[scenes.length - 1].timeEnd) {
    return scenes[scenes.length - 1];
  }

  let best = scenes[0];
  for (const s of scenes) {
    if (s.timeStart <= playhead) best = s;
  }
  return best;
}

/**
 * Thời lượng thực tế cảnh — LUÔN đúng bằng durationSeconds (độ dài THẬT của video, đo lại
 * ngay lúc tạo xong — xem scene-generation-queue.ts). Mặc định: video dài bao nhiêu chạy bấy
 * nhiêu, không tự kéo dài để khớp audio TTS (kể cả khi lời thoại dài hơn video) — không tự
 * thêm/bớt gì cả.
 */
function sceneEffectiveDuration(scene: VideoScene): number {
  return scene.durationSeconds;
}

/** Chữ ký timing các cảnh — dùng detect thay đổi để re-sync preview */
export function scenesTimingSignature(scenes: VideoScene[]): string {
  return scenes
    .map((s) =>
      `${s.id}:${s.timeStart}-${s.timeEnd}:${s.durationSeconds}:${s.audioDurationSeconds ?? ''}:${s.status}:${s.trimStartSeconds ?? 0}`,
    )
    .join('|');
}

/** Tính lại timeStart/timeEnd/index sau khi đổi duration hoặc thứ tự cảnh */
export function recalculateSceneTimings(scenes: VideoScene[]): VideoScene[] {
  let cursor = 0;
  return scenes.map((scene, i) => {
    const durationSeconds = sceneEffectiveDuration(scene);
    const timeStart = cursor;
    const timeEnd = cursor + durationSeconds;
    cursor = timeEnd;
    return { ...scene, index: i + 1, timeStart, timeEnd, durationSeconds };
  });
}

/** Chuyển kịch bản JSON từ Gemini → VideoScene[] cho mục 3 */
//đoạn này là chia kịch bản thành các cảnh
// script là kịch bản từ Gemini
// sceneDurationSetting là độ dài của cảnh
// videoQuality là chất lượng video
// trả về mảng các cảnh
export function scenesFromGeminiScript(
  script: { scenes: Array<{ visual: string; voiceover: string; durationSeconds?: number }> },
  sceneDurationSetting?: string,
  videoQuality?: string,
): VideoScene[] {
  const fixedDuration =
    sceneDurationSetting && sceneDurationSetting !== 'auto'
      ? parseInt(sceneDurationSetting, 10)
      : null;

  let cursor = 0;
  const baseId = Date.now();

  return script.scenes.map((scene, i) => {
    // Cả 2 nhà cung cấp đều chạy Veo 3.1 → luôn snap về lưới 4/6/8 giây
    const durationSeconds = fixedDuration && Number.isFinite(fixedDuration)
      ? snapToVeoDuration(fixedDuration, videoQuality)
      : scene.durationSeconds && scene.durationSeconds > 0
        ? snapToVeoDuration(scene.durationSeconds, videoQuality)
        : resolveSceneDurationSeconds(undefined, scene.voiceover, videoQuality);
    const timeStart = cursor;
    const timeEnd = cursor + durationSeconds;
    cursor = timeEnd;

    return {
      id: `scene-${baseId}-${i}`,
      index: i + 1,
      timeStart,
      timeEnd,
      prompt: scene.visual.trim(),
      voice: scene.voiceover.trim(),
      durationSeconds,
      status: 'success' as const,
    };
  });
}

// ─── Direct Veo (veo-direct) — dựng VideoScene[] từ Scene-centric input ────────────────────
// Xem docs/BUILD PROMPT - tối ưu V3.md. KHÔNG qua Gemini — mirror scenesFromGeminiScript ở trên
// (cursor timing, id pattern, status:'success') nhưng nguồn prompt là user, không AI, và
// mỗi scene có sẵn ảnh riêng tuỳ chọn (sourceImageBase64/sourceImageMimeType, có thể rỗng =
// Text-to-Video).

/** Direct Veo (veo-direct) — dựng VideoScene[] từ DirectVeoScene[] đã validate. KHÔNG qua Gemini.
 * `image: null` = Text-to-Video (Phase 8 — Scene-centric, xem docs/BUILD PROMPT - tối ưu V3.md). */
export function scenesFromDirectVeoPrompt(
  scenes: Array<{ prompt: string; image: { base64: string; mimeType: string } | null }>,
  sceneDurationSetting?: string,
  videoQuality?: string,
  provider?: string,
): VideoScene[] {
  let cursor = 0;
  const baseId = Date.now();

  return scenes.map((scene, i) => {
    // Direct Veo không có voiceover (không TTS) — voice='' làm resolveSceneDurationSeconds
    // rơi vào nhánh ước lượng tối thiểu (6s) khi setting='auto', đúng ý §11 "hiệu lực rõ ràng".
    const durationSeconds = resolveSceneDurationSeconds(sceneDurationSetting, '', videoQuality, provider);
    const timeStart = cursor;
    const timeEnd = cursor + durationSeconds;
    cursor = timeEnd;

    return {
      id: `scene-${baseId}-${i}`,
      index: i + 1,
      timeStart,
      timeEnd,
      prompt: scene.prompt,
      voice: '',
      durationSeconds,
      status: 'success' as const,
      sourceImageBase64: scene.image?.base64,
      sourceImageMimeType: scene.image?.mimeType,
    };
  });
}
