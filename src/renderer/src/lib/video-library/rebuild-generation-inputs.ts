// ─── Dựng lại ttsInput/veoInput cho project đã có cảnh nhưng bị mất cấu hình ──
// ttsInput/veoInput KHÔNG được đồng bộ Supabase (chứa apiKey cá nhân — xem
// video-library-remote.ts), nên sau khi Supabase nạp lại items (F5/đăng nhập máy khác),
// 2 field này luôn về `null`. Hàm này dựng lại từ dữ liệu KHÔNG nhạy cảm đã lưu trên
// item (settings/characters/masterCastPrompt/masterCastImageDataUrl) + apiKey hiện tại
// trong bộ nhớ (api-keys-store) — cho phép "Tạo lại" 1 cảnh lỗi / resume poll hoạt động
// lại mà không bắt user phải submit lại toàn bộ Mục 2.

import type { VideoLibraryItem } from '@/lib/video-library/video-library';
import type { TtsInput, VeoInput } from '@/lib/pipeline-payload';
import { toPipelineCharacters, parseDataUrl } from '@/lib/pipeline-payload';
import { fetchUrlAsBase64 } from '@/lib/blob-to-base64';
import { getApiKey, API_KEY_IDS } from '@/lib/api-keys/api-keys-store';
import { getVideoApiKeyForProvider } from '@/lib/veo/veo-models';
import { SCENE_STYLES } from '@/lib/scene/scene-styles';

/**
 * Trả `null` chỉ khi provider 'veo-gemini' mà user chưa nhập Gemini Key Veo 3.1.
 * 'veo' (kie.ai) dùng key hệ thống — getVideoApiKeyForProvider() trả '' là đúng, không phải thiếu key.
 */
export async function rebuildGenerationInputs(
  item: VideoLibraryItem,
): Promise<{ ttsInput: TtsInput; veoInput: VeoInput } | null> {
  const settings = item.settings;
  const videoApiKey = getVideoApiKeyForProvider(settings.videoProvider);
  const isDirectVeo =
    item.initialInputType === 'veo-direct' || (item.directVeoScenes?.length ?? 0) > 0;
  if (settings.videoProvider === 'veo-gemini' && !videoApiKey) return null;

  const characters = await toPipelineCharacters(item.characters);
  const styleLabel = SCENE_STYLES.find((s) => s.id === settings.sceneStyle)?.label ?? settings.sceneStyle;

  // masterCastImageDataUrl giờ là signed URL TẠM từ Supabase Storage (hoặc base64 lúc đang
  // upload) — không còn URL kie.ai bền vững để gửi thẳng, nên LUÔN tải về + chuyển base64.
  const rawImage = item.masterCastImageDataUrl;
  let referenceImage: VeoInput['referenceImage'];
  if (rawImage?.startsWith('data:')) {
    referenceImage = parseDataUrl(rawImage);
  } else if (rawImage) {
    referenceImage = await fetchUrlAsBase64(rawImage);
  }

  const veoInput: VeoInput = {
    apiKey: videoApiKey || undefined,
    aspectRatio: settings.aspectRatio,
    sceneDuration: settings.sceneDuration,
    videoQuality: settings.videoQuality,
    veoModel: settings.veoModel || undefined,
    sceneStyle: styleLabel,
    sceneStyleId: settings.sceneStyle,
    characters: characters.length > 0 ? characters : undefined,
    referenceImage,
    masterCharacterText: item.masterCastPrompt,
    provider: settings.videoProvider,
    sceneContinuity: settings.sceneContinuity,
    spokenDialogueLanguage: isDirectVeo ? settings.language : undefined,
  };

  const ttsInput: TtsInput = {
    apiKey: getApiKey(API_KEY_IDS.elevenlabs) || undefined,
    voice: settings.voice,
    language: settings.language,
    voiceSpeed: settings.voiceSpeed,
    enabled: isDirectVeo ? false : true,
  };

  return { ttsInput, veoInput };
}
