'use client';

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import type { PresetInput } from '@/lib/preset/preset-scripts';
import {
  ASPECT_RATIO_OPTIONS,
  LANGUAGE_OPTIONS,
  SCENE_COUNT_OPTIONS,
  VIDEO_QUALITY_OPTIONS,
  getSceneDurationOptions,
  normalizeSceneDurationSetting,
} from '@/lib/saved-scripts/saved-scripts';
import { useDefaultVeoModel } from '@/hooks/use-veo-models';
import { useVeoModels } from '@/contexts/veo-models-context';
import { supportsVideoExtension, VEO_GEMINI_MODEL_OPTIONS } from '@/lib/veo/veo-models';

/**
 * Nhà cung cấp sinh video:
 * - 'veo'        Veo 3.1 qua kie.ai (dùng Video API Key của kie.ai)
 * - 'veo-gemini' Veo 3.1 gọi THẲNG Google Gemini API (dùng key riêng "Gemini Key Veo 3.1")
 *
 * Nhà cung cấp 'kie' (Grok Imagine) đã bị GỠ khỏi dự án — xem normalizeVideoProvider()
 * để biết cách xử lý video cũ còn lưu giá trị này.
 */
export type VideoProvider = 'veo' | 'veo-gemini';

/**
 * 2 nhà cung cấp cùng chạy trên Veo 3.1 — dùng chung ô chọn model, toggle "Tiếp nối cảnh
 * trước", danh sách chất lượng và toàn bộ luồng tạo cảnh (chỉ khác endpoint + API key ở
 * backend). Mọi chỗ trước đây kiểm tra `=== 'veo'` cho phần UI/logic Veo đều dùng hàm này.
 */
export function isVeoFamilyProvider(provider: VideoProvider | undefined): boolean {
  return provider === 'veo' || provider === 'veo-gemini';
}

/**
 * Video đã lưu TRƯỚC khi gỡ Grok Imagine có thể còn `videoProvider: 'kie'` (và quality
 * '480p' vốn chỉ Grok hỗ trợ) trong settings JSON — chuẩn hoá về 'veo' lúc đọc để không
 * rơi vào nhánh nhà cung cấp không còn tồn tại. Áp dụng ở mọi nơi nạp settings đã lưu.
 */
export function normalizeVideoProvider(provider: string | undefined): VideoProvider {
  return provider === 'veo-gemini' ? 'veo-gemini' : 'veo';
}

/**
 * Giới hạn THẬT của ElevenLabs voiceSettings.speed (xem clampSpeed() ở
 * backend/src/services/tts/elevenlabs.service.ts) — UI trước đây cho chọn tới 2× nhưng
 * backend luôn ghìm về tối đa 1.2×, dùng chung 1 nguồn giới hạn ở đây để UI/Gemini/TTS
 * không còn lệch nhau.
 */
export const VOICE_SPEED_MIN = 0.75;
export const VOICE_SPEED_MAX = 1.2;

/** Chuẩn hoá toàn bộ settings đã lưu — vá nhà cung cấp/chất lượng Grok cũ + voiceSpeed > 1.2 cũ */
export function normalizeVideoSettings(settings: VideoSettings): VideoSettings {
  const videoProvider = normalizeVideoProvider(settings.videoProvider);
  // biệt DUY NHẤT là model mặc định, nay suggestVeoModelForQuality() đã luôn ưu tiên Fast
  // nên không còn cần lựa chọn riêng) — cả 2 đều quy về '720p' khi đọc dữ liệu cũ.
  const videoQuality = settings.videoQuality === '480p' || settings.videoQuality === '720p-fast'
    ? '720p'
    : settings.videoQuality;
  const voiceSpeed = Math.min(VOICE_SPEED_MAX, Math.max(VOICE_SPEED_MIN, settings.voiceSpeed));
  return videoProvider === settings.videoProvider
    && videoQuality === settings.videoQuality
    && voiceSpeed === settings.voiceSpeed
    ? settings
    : { ...settings, videoProvider, videoQuality, voiceSpeed };
}

export interface VideoSettings {
  language: string;
  sceneCount: string;
  voice: string;
  aspectRatio: string;
  sceneDuration: string;
  videoQuality: string;
  veoModel: string;
  voiceSpeed: number;
  sceneStyle: string;
  /** Nhà cung cấp sinh video — xem VideoProvider */
  videoProvider: VideoProvider;
  /**
   * Scene Continuity — chỉ Veo 3.1 hỗ trợ. Khi bật, mỗi cảnh (trừ cảnh 1) nối tiếp bằng
   * KHUNG HÌNH CUỐI của cảnh liền trước làm khung đầu (/veo/generate FIRST_AND_LAST_FRAMES),
   * neo lại nhân vật/bối cảnh bằng pixel thật. Mặc định BẬT — user vẫn có thể tắt trên thanh
   * tham số. Không còn khoá cứng 8s/720p (generate tôn trọng duration 4/6/8).
   */
  sceneContinuity: boolean;
}

export const DEFAULT_VIDEO_SETTINGS: VideoSettings = {
  language: 'vi',
  sceneCount: '5',
  voice: 'male-natural',
  aspectRatio: '16:9',
  sceneDuration: '6',
  videoQuality: '720p',
  veoModel: '',
  voiceSpeed: 1,
  sceneStyle: 'cinematic',
  videoProvider: 'veo',
  sceneContinuity: true,
};

export const VIDEO_PROVIDER_OPTIONS: [string, string][] = [
  ['veo', 'Veo 3.1'],
  ['veo-gemini', 'Veo của Google'],
];

/**
 * 'veo-gemini' chỉ hiện trong danh sách chọn SAU KHI user đã dán "Gemini Key Veo 3.1"
 * riêng (BYOK) — trước đó ẩn đi để tránh user chọn nhầm nhà cung cấp chưa dùng được.
 */
export function getVideoProviderOptions(hasVeoGeminiKey: boolean): [string, string][] {
  return hasVeoGeminiKey
    ? VIDEO_PROVIDER_OPTIONS
    : VIDEO_PROVIDER_OPTIONS.filter(([v]) => v !== 'veo-gemini');
}

interface ProjectSettingsContextValue {
  settings: VideoSettings;
  patchSettings: (patch: Partial<VideoSettings>) => void;
  applyFromPreset: (input: PresetInput) => void;
  /** Danh sách model theo ĐÚNG nhà cung cấp đang chọn (kie.ai fetch từ API / Gemini cố định) */
  veoModels: ReturnType<typeof useVeoModels>['models'];
  veoModelsLoading: boolean;
  veoModelsError: string | null;
  /** Đã có API key phù hợp với nhà cung cấp đang chọn (kie.ai hoặc Gemini) */
  hasVeoKey: boolean;
  /** Đã có "Gemini Key Veo 3.1" riêng — dùng để quyết định có hiện option 'veo-gemini' hay không */
  hasVeoGeminiKey: boolean;
  sceneDurationOptions: [string, string][];
}

const ProjectSettingsContext = createContext<ProjectSettingsContextValue | null>(null);

interface ProjectSettingsProviderProps {
  children: ReactNode;
  projectKey?: string;
  initialSettings?: VideoSettings;
  onSettingsChange?: (settings: VideoSettings) => void;
}

export function ProjectSettingsProvider({
  children,
  projectKey,
  initialSettings,
  onSettingsChange,
}: ProjectSettingsProviderProps) {
  const [settings, setSettings] = useState<VideoSettings>(
    () => normalizeVideoSettings(initialSettings ?? DEFAULT_VIDEO_SETTINGS),
  );
  const {
    models: kieVeoModels,
    loading: kieVeoModelsLoading,
    error: kieVeoModelsError,
    hasKey: hasKieVeoKey,
    hasVeoGeminiKey,
  } = useVeoModels();

  // Nhà cung cấp 'veo-gemini' gọi thẳng Google: model là danh sách cố định (không fetch),
  // và "đã có key" nghĩa là có "Gemini Key Veo 3.1" riêng chứ không phải key kie.ai.
  const isGeminiVeo = settings.videoProvider === 'veo-gemini';
  const veoModels = isGeminiVeo ? VEO_GEMINI_MODEL_OPTIONS : kieVeoModels;
  const veoModelsLoading = isGeminiVeo ? false : kieVeoModelsLoading;
  const veoModelsError = isGeminiVeo ? null : kieVeoModelsError;
  const hasVeoKey = isGeminiVeo ? hasVeoGeminiKey : hasKieVeoKey;
  const onSettingsChangeRef = useRef(onSettingsChange);
  onSettingsChangeRef.current = onSettingsChange;
  /** Bỏ qua 1 lần sync sau khi load settings từ bulk parent (đổi project / initialSettings) */
  const skipSyncRef = useRef(true);

  useEffect(() => {
    skipSyncRef.current = true;
    setSettings(normalizeVideoSettings(initialSettings ?? DEFAULT_VIDEO_SETTINGS));
    // Chỉ load lại khi đổi bulk — không khi parent echo settings vừa sync
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [projectKey]);

  useEffect(() => {
    if (skipSyncRef.current) {
      skipSyncRef.current = false;
      return;
    }
    onSettingsChangeRef.current?.(settings);
  }, [settings]);

  const patchSettings = useCallback((patch: Partial<VideoSettings>) => {
    setSettings((prev) => ({ ...prev, ...patch }));
  }, []);

  const pickVeoModel = useCallback((modelId: string) => {
    patchSettings({ veoModel: modelId });
  }, [patchSettings]);

  useDefaultVeoModel(veoModels, settings.videoQuality, settings.veoModel, pickVeoModel);

  // Đổi chất lượng HOẶC nhà cung cấp đều có thể kích hoạt ràng buộc "veo-gemini + 1080p → 8s"
  useEffect(() => {
    setSettings((prev) => {
      const next = normalizeSceneDurationSetting(prev.sceneDuration, prev.videoQuality, prev.videoProvider);
      return next === prev.sceneDuration ? prev : { ...prev, sceneDuration: next };
    });
  }, [settings.videoQuality, settings.videoProvider]);

  // Scene Continuity chỉ Veo 3.1/3.1 Fast hỗ trợ — đổi sang provider/model khác thì tự tắt
  useEffect(() => {
    setSettings((prev) => {
      if (!prev.sceneContinuity) return prev;
      const supported = isVeoFamilyProvider(prev.videoProvider) && supportsVideoExtension(prev.veoModel);
      return supported ? prev : { ...prev, sceneContinuity: false };
    });
  }, [settings.videoProvider, settings.veoModel]);

  // Mất "Gemini Key Veo 3.1" (user xoá key) khi đang chọn 'veo-gemini' → tự rơi về 'veo',
  // tránh ô chọn nhà cung cấp trỏ vào option đã bị ẩn khỏi getVideoProviderOptions().
  useEffect(() => {
    if (hasVeoGeminiKey) return;
    setSettings((prev) => (prev.videoProvider === 'veo-gemini' ? { ...prev, videoProvider: 'veo' } : prev));
  }, [hasVeoGeminiKey]);

  const applyFromPreset = useCallback((input: PresetInput) => {
    setSettings((prev) => ({
      ...prev,
      language: input.language,
      sceneCount: input.sceneCount,
      voice: input.voice,
      aspectRatio: input.aspectRatio ?? '16:9',
      sceneDuration: normalizeSceneDurationSetting(
        input.sceneDuration ?? '6',
        input.videoQuality ?? '720p',
        prev.videoProvider,
      ),
      videoQuality: input.videoQuality ?? '720p',
      veoModel: input.veoModel ?? '',
      voiceSpeed: input.voiceSpeed ?? prev.voiceSpeed,
      sceneStyle: input.sceneStyleId ?? prev.sceneStyle,
      // Preset không mang nhà cung cấp — giữ nguyên lựa chọn hiện tại của user
    }));
  }, []);

  const sceneDurationOptions = useMemo(
    () => getSceneDurationOptions(settings.videoQuality, settings.videoProvider),
    [settings.videoQuality, settings.videoProvider],
  );

  const value = useMemo(
    () => ({
      settings,
      patchSettings,
      applyFromPreset,
      veoModels,
      veoModelsLoading,
      veoModelsError,
      hasVeoKey,
      hasVeoGeminiKey,
      sceneDurationOptions,
    }),
    [
      settings,
      patchSettings,
      applyFromPreset,
      veoModels,
      veoModelsLoading,
      veoModelsError,
      hasVeoKey,
      hasVeoGeminiKey,
      sceneDurationOptions,
    ],
  );

  return (
    <ProjectSettingsContext.Provider value={value}>
      {children}
    </ProjectSettingsContext.Provider>
  );
}

export function useProjectSettings(): ProjectSettingsContextValue {
  const ctx = useContext(ProjectSettingsContext);
  if (!ctx) {
    throw new Error('useProjectSettings must be used within ProjectSettingsProvider');
  }
  return ctx;
}

export {
  ASPECT_RATIO_OPTIONS,
  LANGUAGE_OPTIONS,
  SCENE_COUNT_OPTIONS,
  VIDEO_QUALITY_OPTIONS,
};
