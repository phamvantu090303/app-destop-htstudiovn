// ─── Thời lượng cảnh Veo 3: snap 4/6/8s, 1080p bắt buộc 8s ─────────────────

/** Thời lượng cảnh theo giới hạn Veo 3 API */

export const VEO_SCENE_DURATIONS = [4, 6, 8] as const;
export type VeoSceneDuration = (typeof VEO_SCENE_DURATIONS)[number];

export const SCENE_DURATION_LABELS: Record<string, string> = {
  auto: 'Tự động (4–8 giây · Veo 3)',
  '4': '4 giây/cảnh',
  '6': '6 giây/cảnh',
  '8': '8 giây/cảnh',
};

/**
 * 1080p bắt buộc 8 giây/cảnh — CHỈ đúng với nhà cung cấp 'veo-gemini' (gọi thẳng Google:
 * resolution nằm ngay trong request predictLongRunning nên bị ràng buộc 8s, xem
 * veo-3-1-gemini.md và backend/src/services/veo/veo-gemini.service.ts).
 *
 * Với 'veo' (kie.ai), 1080p là lệnh gọi phụ (get-1080p-video) tách biệt khỏi duration của
 * lần generate gốc → KHÔNG ràng buộc. Không truyền provider → coi như không ràng buộc (kie),
 * giữ nguyên hành vi cũ cho các call site chưa biết provider.
 */
export function is1080pQuality(videoQuality?: string, provider?: string): boolean {
  return provider === 'veo-gemini' && videoQuality === '1080p';
}

/** Dropdown options theo chất lượng video (+ nhà cung cấp — veo-gemini + 1080p khoá 8s) */
export function getSceneDurationOptions(videoQuality?: string, provider?: string): [string, string][] {
  if (is1080pQuality(videoQuality, provider)) {
    return [['8', '8 giây/cảnh (bắt buộc với 1080p)']];
  }
  return Object.entries(SCENE_DURATION_LABELS) as [string, string][];
}

/** Snap số giây → 4 | 6 | 8 (veo-gemini + 1080p luôn 8) */
export function snapToVeoDuration(seconds: number, videoQuality?: string, provider?: string): VeoSceneDuration {
  if (is1080pQuality(videoQuality, provider)) return 8;
  const s = Math.round(seconds);
  if (s <= 5) return 4;
  if (s <= 7) return 6;
  return 8;
}

/** Chuẩn hóa giá trị form (migrate 3/5/10 → 4/6/8) */
export function normalizeSceneDurationSetting(
  value: string | undefined,
  videoQuality?: string,
  provider?: string,
): string {
  if (is1080pQuality(videoQuality, provider)) return '8';
  if (!value || value === 'auto') return 'auto';
  const n = parseInt(value, 10);
  if (n === 4 || n === 6 || n === 8) return String(n);
  return String(snapToVeoDuration(Number.isFinite(n) ? n : 6, videoQuality, provider));
}

/** Ước lượng thời lượng cảnh từ số từ voiceover (auto mode) */
function estimateDurationFromVoice(voice: string): number {
  const words = voice.split(/\s+/).filter(Boolean).length;
  return Math.min(8, Math.max(4, Math.round(words / 2.5) || 6));
}

/** Resolve thời lượng cảnh thực tế (giây) cho pipeline */
export function resolveSceneDurationSeconds(
  setting: string | undefined,
  voice: string,
  videoQuality?: string,
  provider?: string,
): VeoSceneDuration {
  if (is1080pQuality(videoQuality, provider)) return 8;
  if (!setting || setting === 'auto') {
    return snapToVeoDuration(estimateDurationFromVoice(voice), videoQuality, provider);
  }
  const n = parseInt(setting, 10);
  if (n === 4 || n === 6 || n === 8) return n;
  return snapToVeoDuration(Number.isFinite(n) ? n : 6, videoQuality, provider);
}

/** Nhãn hiển thị thời lượng cảnh từ giá trị form */
export function formatSceneDuration(value: string): string {
  return SCENE_DURATION_LABELS[value] ?? `${value}s/cảnh`;
}
