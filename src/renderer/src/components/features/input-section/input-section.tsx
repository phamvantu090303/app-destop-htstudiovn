'use client';

import { useState, useRef, useEffect, type RefObject } from 'react';
import {
  Type, Link2, Image, Send, Loader2,
  CheckCircle2, Bookmark, Gauge, Palette, ChevronDown, ChevronUp,
  Sliders, X, Plus, ArrowDown, Film,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { FieldError } from '@/components/ui/field-error';
import { Button } from '@/components/ui/button';
import type { SceneGenerationResult } from '@/lib/scene/scenes';
import type { CharacterMasterHandle } from '@/components/features/character-master';
import type { PresetInput } from '@/lib/preset/preset-scripts';
import type { DirectVeoPersistedScene, SourceImageItem } from '@/lib/video-library/video-library';
import { getApiKey, API_KEY_IDS } from '@/lib/api-keys/api-keys-store';
import { getVideoApiKeyForProvider } from '@/lib/veo/veo-models';
import { buildAnalyzePipeline, toPipelineCharacters } from '@/lib/pipeline-payload';
import type { TtsInput, VeoInput } from '@/lib/pipeline-payload';
import { logAnalyzePipeline } from '@/lib/gemini/pipeline-debug-log';
import { toUserMessage } from '@/lib/error-messages';
import { useProjectSettings, VOICE_SPEED_MAX, VOICE_SPEED_MIN } from '@/contexts/project-settings-context';
import { useVideoLibrary } from '@/contexts/video-library-context';
import { SCENE_STYLES, formatSceneStyleDisplayLabel } from '@/lib/scene/scene-styles';
import { DirectVeoInput, type DirectVeoInputHandle, type DirectVeoScenePersistData } from '@/components/features/direct-veo';
import { mapDirectVeoScenesToVideoScenes, buildDirectVeoInputContent } from '@/components/features/direct-veo/direct-veo-mapper';
import { normalizeSceneDurationSetting } from '@/lib/veo/veo-duration';

// ─── Voice Speed config ───────────────────────────────────────────────────────
// Giới hạn 0.75–1.2 là giới hạn THẬT của ElevenLabs voiceSettings.speed (xem
// clampSpeed() ở backend/src/services/tts/elevenlabs.service.ts) — trước đây UI cho
// chọn tới 2× nhưng backend luôn ghìm về tối đa 1.2×, vừa đánh lừa người dùng (nghe
// không nhanh như label) vừa đánh lừa Gemini (viết thoại dày hơn cho vừa cảnh 8s,
// trong khi giọng đọc thật không nhanh hơn 1.2×) → dễ khiến audio bị cắt cụt lúc render.
const SPEED_OPTIONS = [
  { value: 0.75, label: '0.75×', desc: 'Chậm' },
  { value: 1, label: '1×', desc: 'Bình thường' },
  { value: VOICE_SPEED_MAX, label: '1.2×', desc: 'Nhanh (tối đa)' },
];

// ─── Scene Style config — dùng chung frontend/lib/scene-styles.ts ────────────

// ─── Types ────────────────────────────────────────────────────────────────────
export type TabId = 'text' | 'link' | 'image' | 'veo-direct';

const tabs: { id: TabId; icon: typeof Type; label: string; desc: string }[] = [
  { id: 'text', icon: Type, label: 'Tự nhập nội dung', desc: 'Nhập từ bàn phím' },
  { id: 'link', icon: Link2, label: 'Từ link video', desc: 'YouTube, TikTok...' },
  { id: 'image', icon: Image, label: 'Từ hình ảnh', desc: 'Tải lên hình ảnh' },
  { id: 'veo-direct', icon: Film, label: 'Từ Prompt cá nhân', desc: '1 prompt + 1–3 ảnh' },
];

// ─── Validation limits ────────────────────────────────────────────────────────
// Không giới hạn số ký tự tối đa — người dùng có thể nhập kịch bản dài tuỳ ý,
// chỉ giữ mức tối thiểu để đảm bảo đủ dữ liệu cho AI phân tích.
const MIN_CONTENT_CHARS = 20;
const MIN_LINK_DESCRIPTION_CHARS = 20;
const MAX_IMAGE_MB = 10;
const MAX_IMAGES = 12;
const IMAGE_MIME = ['image/jpeg', 'image/png', 'image/webp', 'image/gif'];

// Cho phép các host video phổ biến — kiểm tra để cảnh báo cụ thể
const SUPPORTED_HOSTS = ['youtube.com', 'youtu.be', 'tiktok.com', 'vimeo.com', 'facebook.com', 'fb.watch'];

// ─── Types cho form ───────────────────────────────────────────────────────────

interface FormErrors {
  content?: string;
  linkUrl?: string;
  linkDescription?: string;
  upload?: string;
  submit?: string;
  /** Lỗi prompt tổng tab ảnh */
  imageMasterBrief?: string;
  /** Lỗi chung tab "Veo trực tiếp" khi payload chưa hợp lệ lúc submit — lỗi chi tiết (parse/
   * validate) đã hiện inline trong DirectVeoInput, field này chỉ dùng để chặn submit. */
  directVeo?: string;
}

interface FormState {
  /** null — chưa chọn cách nhập, hiện màn chọn 4 phương thức */
  activeTab: TabId | null;
  content: string;
  linkUrl: string;
  /** Mô tả nội dung/phong cách video — Gemini không tự xem được video qua URL nên cần mô tả này để phân tích */
  linkDescription: string;
  dragOver: boolean;
  isSubmitting: boolean;
}

export interface InputSectionProps {
  presetData?: PresetInput | null;
  presetKey?: number;
  onSaveScript?: (
    content: string,
    meta: { language: string; sceneCount: string; voice: string; aspectRatio: string; sceneDuration: string; videoQuality: string }
  ) => void;
  /** Sidebar click "Nhập nội dung" → scroll + focus textarea */
  focusContentKey?: number;
  /** Sidebar click "Tốc độ giọng" → scroll + mở accordion */
  focusVoiceSpeedKey?: number;
  /** Sidebar click "Phong cách cảnh" → scroll + mở accordion */
  focusSceneStyleKey?: number;
  /** Sau khi phân tích xong — optional legacy callback */
  onScenesGenerated?: (result: SceneGenerationResult, projectId: string) => void | Promise<void>;
  /** ID video (kho video) — khóa kết quả phân tích đúng video */
  projectId?: string;
  /** Nội dung prompt lưu theo từng video */
  initialContent?: string;
  onContentChange?: (content: string) => void;
  /**
   * Nguồn nội dung đã chọn sẵn lúc "Tạo video mới" (hoặc lần chọn đầu tiên ở màn inline) —
   * bỏ qua màn chọn cách nhập, vào thẳng tab tương ứng. Một khi có giá trị thì bị KHOÁ
   * (ẩn "Đổi cách nhập") — xem prop `locked`.
   */
  initialInputType?: TabId;
  /** true khi initialInputType đã có giá trị — ẩn nút "Đổi cách nhập", không cho đổi nguồn */
  locked?: boolean;
  /**
   * true khi đã từng nhấn "Phân Tích & Tạo Kịch Bản" ở tab "Từ hình ảnh" (item không còn
   * 'draft') — chốt khoá chế độ "Nhiều ảnh"/"1 ảnh" theo đúng chế độ đã dùng để tạo video,
   * ẩn nút chế độ còn lại (không cho đổi qua lại nữa).
   */
  imageModeLocked?: boolean;
  /** Ref mục 1 — lấy danh sách nhân vật khi gửi Gemini */
  characterMasterRef?: RefObject<CharacterMasterHandle | null>;
  /** Banner "Đã tạo kịch bản" — bấm mũi tên để cuộn xuống mục 3. DANH SÁCH CẢNH */
  onJumpToScenes?: () => void;
  /** Báo tab đang chọn (text/link/image/file) lên component cha — dùng để ẩn/hiện Character Master. null = chưa chọn */
  onActiveTabChange?: (tab: TabId | null) => void;
  /** Lần đầu chọn 1 trong 4 nguồn (item chưa từng có initialInputType) — chốt khoá ngay, không đợi debounce */
  onInputTypeLocked?: (tab: TabId) => void;
  /** Tab "Từ link video" — giữ lại qua reload/điều hướng */
  savedLinkUrl?: string;
  savedLinkDescription?: string;
  onLinkChange?: (linkUrl: string, linkDescription: string) => void;
  /** Tab "Từ hình ảnh" — Prompt tổng + từng ảnh đã upload (path Storage, có previewUrl signed URL) */
  savedImageMasterBrief?: string;
  onImageMasterBriefChange?: (text: string) => void;
  /** 'multi' (mặc định, nhiều ảnh — mỗi ảnh 1 cảnh) | 'single' (1 ảnh + Prompt tổng — nhiều cảnh) */
  savedImageMode?: 'multi' | 'single';
  onImageModeChange?: (mode: 'multi' | 'single') => void;
  savedSourceImages?: SourceImageItem[];
  onImagesMetaChange?: (images: SourceImageItem[]) => void;
  /** Tab "Veo trực tiếp" — scenes đã lưu (prompt + ảnh tuỳ chọn, path Storage), Phase 9 */
  savedDirectVeoScenes?: DirectVeoPersistedScene[];
  savedDirectVeoGlobalContext?: string;
  onDirectVeoChange?: (scenes: DirectVeoScenePersistData[], globalContext: string) => void;
}

// ─── Validation helpers ───────────────────────────────────────────────────────

function validateContent(raw: string): string | undefined {
  const s = raw.trim();
  if (!s) return 'Vui lòng nhập nội dung để AI có thể tạo video.';
  if (s.length < MIN_CONTENT_CHARS) {
    return `Nội dung quá ngắn — cần ít nhất ${MIN_CONTENT_CHARS} ký tự (hiện tại: ${s.length}).`;
  }
  return undefined;
}

function validateUrl(raw: string): string | undefined {
  const s = raw.trim();
  if (!s) return 'Vui lòng nhập URL video.';
  let url: URL;
  try {
    url = new URL(s);
  } catch {
    return 'URL không hợp lệ — cần dạng đầy đủ, ví dụ: https://www.youtube.com/watch?v=...';
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    return `URL phải bắt đầu bằng http:// hoặc https:// (hiện tại: ${url.protocol}).`;
  }
  const host = url.hostname.replace(/^www\./, '').toLowerCase();
  const supported = SUPPORTED_HOSTS.some((h) => host === h || host.endsWith(`.${h}`));
  if (!supported) {
    return `Nền tảng "${host}" chưa được hỗ trợ. Vui lòng dùng: YouTube, TikTok, Vimeo, Facebook.`;
  }
  return undefined;
}

/** YouTube public — Gemini đọc trực tiếp qua file_uri, không cần Files API upload */
function isYouTubeUrl(raw: string): boolean {
  try {
    const u = new URL(raw.trim());
    const host = u.hostname.replace(/^www\./, '').toLowerCase();
    return host === 'youtube.com' || host === 'youtu.be' || host.endsWith('.youtube.com');
  } catch {
    return false;
  }
}

/** Gemini không tự xem được video qua URL (trừ YouTube) — cần mô tả để phân tích */
function validateLinkDescription(raw: string, optional = false): string | undefined {
  const s = raw.trim();
  if (!s) {
    return optional
      ? undefined
      : 'Vui lòng mô tả nội dung video (Gemini không tự xem được link ngoài YouTube).';
  }
  if (s.length < MIN_LINK_DESCRIPTION_CHARS) {
    return `Mô tả quá ngắn — cần ít nhất ${MIN_LINK_DESCRIPTION_CHARS} ký tự (hiện tại: ${s.length}).`;
  }
  return undefined;
}

const MIN_IMAGE_PROMPT_CHARS = 10;

interface UploadedImageItem {
  id: string;
  file: File | null;
  previewUrl: string | null;
  prompt: string;
  /** Tiêu đề cảnh — preset stickman */
  label?: string;
  /** Gợi ý lời kể TTS */
  voiceHint?: string;
  /**
   * Path Storage (bucket `source-uploads`) — có ngay sau khi upload xong, hoặc phục hồi
   * từ dữ liệu đã lưu (khi đó `file` là null, chỉ còn path + previewUrl signed URL).
   */
  path?: string;
  fileName?: string;
  mimeType?: string;
}

function createImageId(): string {
  return `img-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
}

function revokeImagePreview(url: string | null) {
  if (url?.startsWith('blob:')) URL.revokeObjectURL(url);
}

/** Prompt tổng — chỉ dùng ở chế độ "1 ảnh", mô tả toàn bộ video, bắt buộc phải nhập */
function validateImageMasterBrief(raw: string): string | undefined {
  const s = raw.trim();
  if (!s) return 'Vui lòng nhập Prompt tổng — mô tả chung áp dụng cho mọi ảnh.';
  if (s.length < MIN_IMAGE_PROMPT_CHARS) {
    return `Prompt tổng quá ngắn — cần ít nhất ${MIN_IMAGE_PROMPT_CHARS} ký tự (hiện tại: ${s.length}).`;
  }
  return undefined;
}

/** Chế độ "Nhiều ảnh" — CHỈ dùng prompt riêng từng ảnh, không có Prompt tổng */
function buildImagePipelineContent(images: UploadedImageItem[]): string {
  const lines: string[] = [];

  images.forEach((img, i) => {
    const heading = img.label || `CẢNH ${i + 1}`;
    const fileNote = img.file ? ` (${img.file.name})` : '';
    lines.push(`## ${heading}${fileNote}`);
    lines.push('');
    lines.push('VIDEO PROMPT:');
    const scenePrompt = img.prompt.trim();
    lines.push(
      scenePrompt
      || 'Tự phân tích ảnh đính kèm và tạo mô tả visual phù hợp cho cảnh này, đồng nhất phong cách với các cảnh khác.',
    );
    if (img.voiceHint?.trim()) {
      lines.push('');
      lines.push('VOICE (TTS):');
      lines.push(img.voiceHint.trim());
    }
    lines.push('');
  });
  return lines.join('\n').trim();
}

function validateImageFile(file: File): string | undefined {
  const sizeMB = file.size / 1024 / 1024;
  if (!IMAGE_MIME.includes(file.type) && !file.type.startsWith('image/')) {
    return `File "${file.name}" không phải hình ảnh hợp lệ. Chấp nhận: JPG, PNG, WebP, GIF.`;
  }
  if (sizeMB > MAX_IMAGE_MB) {
    return `File "${file.name}" quá lớn (${sizeMB.toFixed(1)} MB) — tối đa ${MAX_IMAGE_MB} MB.`;
  }
  return undefined;
}

/** Đọc file ảnh thành base64 thuần (không kèm prefix data URL) — gửi Veo làm ảnh mồi cho đúng cảnh */
/** File kế thừa Blob — dùng lại nguyên blobToBase64(), chỉ đổi tên cho rõ ngữ cảnh gọi (ảnh) */
function fileToBase64(file: File): Promise<{ base64: string; mimeType: string }> {
  return blobToBase64(file);
}

/** Đọc Blob thành base64 thuần — dùng chung cho blobToBase64/fetchUrlAsBase64 bên dưới */
function blobToBase64(blob: Blob): Promise<{ base64: string; mimeType: string }> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const dataUrl = reader.result;
      if (typeof dataUrl !== 'string') { reject(new Error('Không đọc được file.')); return; }
      const match = /^data:([^;]+);base64,(.+)$/.exec(dataUrl);
      if (!match) { reject(new Error('Không đọc được file.')); return; }
      resolve({ mimeType: match[1], base64: match[2] });
    };
    reader.onerror = () => reject(new Error('Không đọc được file.'));
    reader.readAsDataURL(blob);
  });
}

/**
 * Tải lại bytes thật từ 1 URL (signed URL Storage) → base64 — dùng khi resubmit với
 * ảnh/file đã phục hồi từ dữ liệu đã lưu (không còn File object thật, chỉ còn URL).
 */
async function fetchUrlAsBase64(url: string): Promise<{ base64: string; mimeType: string } | null> {
  try {
    const res = await fetch(url);
    if (!res.ok) return null;
    return await blobToBase64(await res.blob());
  } catch {
    return null;
  }
}

// ─── Component ────────────────────────────────────────────────────────────────

export function InputSection({
  presetData, presetKey, onSaveScript,
  focusContentKey, focusVoiceSpeedKey, focusSceneStyleKey, onScenesGenerated,
  characterMasterRef, projectId, initialContent = '', onContentChange,
  onJumpToScenes,
  onActiveTabChange, initialInputType, locked = false, onInputTypeLocked,
  imageModeLocked = false,
  savedLinkUrl = '', savedLinkDescription = '', onLinkChange,
  savedImageMasterBrief = '', onImageMasterBriefChange,
  savedImageMode, onImageModeChange,
  savedSourceImages, onImagesMetaChange,
  savedDirectVeoScenes, savedDirectVeoGlobalContext, onDirectVeoChange,
}: InputSectionProps = {}) {
  const fileInputRef = useRef<HTMLInputElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const voiceSpeedRef = useRef<HTMLDivElement>(null);
  const sceneStyleRef = useRef<HTMLDivElement>(null);
  const directVeoRef = useRef<DirectVeoInputHandle>(null);
  /** Bump khi rời tab 'veo-direct' → remount DirectVeoInput (key) = state sạch, không cần reset thủ công */
  const [directVeoResetKey, setDirectVeoResetKey] = useState(0);
  /** Số Scene hiện tại trong DirectVeoInput — dùng cho nhãn nút submit "Tạo N Video" (Phase 8: N = số Scene, không phải số ảnh — ảnh giờ tuỳ chọn per Scene) */
  const [directVeoSceneCount, setDirectVeoSceneCount] = useState(0);

  const [form, setForm] = useState<FormState>({
    // initialInputType LUÔN đáng tin cậy 1 khi đã có (chốt khoá — xem handleTabChange) —
    // fallback về 'text' chỉ áp dụng cho dữ liệu cũ trước khi field này tồn tại.
    activeTab: initialInputType ?? (initialContent.trim() ? 'text' : null),
    content: initialContent, linkUrl: savedLinkUrl, linkDescription: savedLinkDescription,
    dragOver: false, isSubmitting: false,
  });
  const [errors, setErrors] = useState<FormErrors>({});
  /**
   * 2 danh sách ảnh TÁCH RIÊNG theo chế độ — đổi qua lại "Nhiều ảnh"/"1 ảnh" không được xoá
   * dữ liệu của chế độ kia (yêu cầu UX). Ảnh cũ chưa có field `mode` (lưu trước khi tách) —
   * coi như thuộc `savedImageMode` lúc đó, giữ đúng hành vi cũ khi phục hồi dữ liệu.
   */
  const seedImages = (mode: 'multi' | 'single'): UploadedImageItem[] =>
    (savedSourceImages ?? [])
      .filter((img) => (img.mode ?? savedImageMode ?? 'multi') === mode)
      .map((img) => ({
        id: img.id,
        file: null,
        previewUrl: img.previewUrl ?? null,
        prompt: img.prompt,
        label: img.label,
        voiceHint: img.voiceHint,
        path: img.path,
        fileName: img.fileName,
        mimeType: img.mimeType,
      }));
  const [multiImages, setMultiImages] = useState<UploadedImageItem[]>(() => seedImages('multi'));
  const [singleImages, setSingleImages] = useState<UploadedImageItem[]>(() => seedImages('single'));
  const [imageMode, setImageMode] = useState<'multi' | 'single'>(savedImageMode ?? 'multi');
  /** Danh sách/setter của chế độ ẢNH ĐANG HIỂN THỊ — mọi logic bên dưới vẫn dùng như 1 mảng duy nhất */
  const uploadedImages = imageMode === 'multi' ? multiImages : singleImages;
  const setUploadedImages = imageMode === 'multi' ? setMultiImages : setSingleImages;
  const uploadedImagesRef = useRef<UploadedImageItem[]>([]);
  uploadedImagesRef.current = [...multiImages, ...singleImages];
  const [imageMasterBrief, setImageMasterBrief] = useState(savedImageMasterBrief);
  const [pendingImageSlotId, setPendingImageSlotId] = useState<string | null>(null);
  const [justApplied, setJustApplied] = useState(false);
  const [savedScript, setSavedScript] = useState(false);

  const { settings, patchSettings, applyFromPreset, hasVeoKey } = useProjectSettings();
  const { startAnalyze, startDirectVeoGeneration, items, uploadSourceImage, deleteSourceUpload, getSourceSignedUrl } = useVideoLibrary();
  const { voiceSpeed, sceneStyle } = settings;

  const activeItem = items.find((p) => p.id === projectId);
  const activeItemStatus = activeItem?.status;
  const isItemBusy = activeItemStatus === 'analyzing' || activeItemStatus === 'generating';
  /** Kịch bản đã phân tích xong, đang chờ xác nhận "Bắt đầu tạo video" ở mục 3 — chỉ dùng để
   *  hiện banner nhắc xuống mục 3; nút "Phân Tích & Tạo Kịch Bản" vẫn bấm lại được bình
   *  thường (cho phép tạo lại kịch bản, ghi đè pendingLinkReview cũ). */
  const awaitingScriptReview = Boolean(activeItem?.pendingLinkReview);
  const submitLockRef = useRef(false);

  useEffect(() => {
    if (!isItemBusy) {
      submitLockRef.current = false;
    }
  }, [isItemBusy]);

  /** Nút "✓ Đã tạo kịch bản" chỉ hiện khi phân tích THẬT SỰ thành công (status vừa chuyển từ
   *  analyzing → draft) — trước đây bật ngay lúc gọi submit nên vẫn hiện xanh dù backend từ chối
   *  (vd thiếu credit) và status thật ra chuyển sang 'error'. */
  const wasBusyRef = useRef(false);
  useEffect(() => {
    const wasBusy = wasBusyRef.current;
    wasBusyRef.current = isItemBusy;
    if (wasBusy && !isItemBusy && activeItemStatus === 'draft') {
      setForm((f) => ({ ...f, submitted: true }));
      const timer = setTimeout(() => setForm((f) => ({ ...f, submitted: false })), 3000);
      return () => clearTimeout(timer);
    }
  }, [isItemBusy, activeItemStatus]);

  useEffect(() => {
    onActiveTabChange?.(form.activeTab);
  }, [form.activeTab, onActiveTabChange]);

  const [showVoiceSpeed, setShowVoiceSpeed] = useState(false);
  const [showSceneStyle, setShowSceneStyle] = useState(false);
  /** Đang ở chế độ tự nhập phong cách (không khớp preset nào có sẵn) */
  const [customStyleMode, setCustomStyleMode] = useState(
    () => Boolean(settings.sceneStyle) && !SCENE_STYLES.some((s) => s.id === settings.sceneStyle),
  );

  // ── Preset apply ───────────────────────────────────────────────────────────
  useEffect(() => {
    if (!presetData) return;
    applyFromPreset(presetData);
    setErrors({});
    setMultiImages((prev) => {
      prev.forEach((img) => revokeImagePreview(img.previewUrl));
      return [];
    });
    setSingleImages((prev) => {
      prev.forEach((img) => revokeImagePreview(img.previewUrl));
      return [];
    });

    if (presetData.inputType === 'image' && presetData.imageScenes?.length) {
      setImageMasterBrief(presetData.content);
      // Kịch bản mẫu luôn là "mỗi ảnh 1 cảnh" — chốt chế độ multi, tránh hiện sai UI nếu
      // trước đó người dùng đang ở chế độ 'single'.
      setImageMode('multi');
      setForm((f) => ({
        ...f,
        activeTab: 'image',
        content: presetData.content,
      }));
      setMultiImages(
        presetData.imageScenes.map((scene) => ({
          id: createImageId(),
          file: null,
          previewUrl: null,
          prompt: scene.videoPrompt,
          label: scene.title,
          voiceHint: scene.voice,
        })),
      );
    } else {
      setImageMasterBrief('');
      setForm((f) => ({
        ...f,
        activeTab: 'text',
        content: presetData.content,
      }));
    }

    setJustApplied(true);
    setTimeout(() => setJustApplied(false), 2500);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [presetKey]);

  // ── Sidebar navigation triggers ───────────────────────────────────────────
  useEffect(() => {
    if (!focusContentKey) return;
    setForm((f) => ({ ...f, activeTab: 'text' }));
    setTimeout(() => textareaRef.current?.focus(), 80);
  }, [focusContentKey]);

  useEffect(() => {
    if (!focusVoiceSpeedKey) return;
    setShowVoiceSpeed(true);
    setTimeout(() => voiceSpeedRef.current?.scrollIntoView({ behavior: 'smooth', block: 'center' }), 80);
  }, [focusVoiceSpeedKey]);

  useEffect(() => {
    if (!focusSceneStyleKey) return;
    setShowSceneStyle(true);
    setTimeout(() => sceneStyleRef.current?.scrollIntoView({ behavior: 'smooth', block: 'center' }), 80);
  }, [focusSceneStyleKey]);

  useEffect(() => () => {
    uploadedImagesRef.current.forEach((img) => revokeImagePreview(img.previewUrl));
  }, []);

  // Tab "Tự nhập nội dung" — kênh riêng, không còn dùng chung với tab ảnh (nguồn gốc bug
  // reset về tab text sau reload: gõ Prompt tổng làm inputContent hết rỗng, khiến lần
  // mount sau FormState init hiểu nhầm là đang ở tab text).
  useEffect(() => {
    if (form.activeTab !== 'text') return;
    const timer = setTimeout(() => onContentChange?.(form.content), 400);
    return () => clearTimeout(timer);
  }, [form.content, form.activeTab, onContentChange]);

  // Tab "Từ link video" — giữ lại qua reload/điều hướng
  useEffect(() => {
    if (form.activeTab !== 'link') return;
    const timer = setTimeout(() => onLinkChange?.(form.linkUrl, form.linkDescription), 400);
    return () => clearTimeout(timer);
  }, [form.linkUrl, form.linkDescription, form.activeTab, onLinkChange]);

  // Tab "Từ hình ảnh" — Prompt tổng
  useEffect(() => {
    if (form.activeTab !== 'image') return;
    const timer = setTimeout(() => onImageMasterBriefChange?.(imageMasterBrief), 400);
    return () => clearTimeout(timer);
  }, [imageMasterBrief, form.activeTab, onImageMasterBriefChange]);

  // Tab "Từ hình ảnh" — chế độ multi/single, chốt ngay không đợi debounce (đổi mode
  // hiếm khi xảy ra liên tục, và cần lưu sớm để không lẫn dữ liệu khi điều hướng đi ngay).
  useEffect(() => {
    if (form.activeTab !== 'image') return;
    onImageModeChange?.(imageMode);
  }, [imageMode, form.activeTab, onImageModeChange]);

  // Tab "Từ hình ảnh" — meta từng ảnh (prompt/label/voiceHint + path Storage khi đã upload
  // xong) — chỉ gửi ảnh ĐÃ CÓ path (upload xong), tránh lưu ảnh dở dang chưa có gì để phục hồi.
  // Gộp CẢ 2 chế độ (gắn `mode`) để lưu song song, khôi phục lại đúng chỗ khi mở lại video —
  // xem seedImages() ở trên.
  useEffect(() => {
    if (form.activeTab !== 'image') return;
    const toMeta = (images: UploadedImageItem[], mode: 'multi' | 'single'): SourceImageItem[] =>
      images
        .filter((img): img is UploadedImageItem & { path: string } => Boolean(img.path))
        .map((img) => ({
          id: img.id,
          path: img.path,
          fileName: img.fileName ?? img.file?.name ?? '',
          mimeType: img.mimeType ?? img.file?.type ?? '',
          prompt: img.prompt,
          label: img.label,
          voiceHint: img.voiceHint,
          mode,
        }));
    const meta = [...toMeta(multiImages, 'multi'), ...toMeta(singleImages, 'single')];
    const timer = setTimeout(() => onImagesMetaChange?.(meta), 400);
    return () => clearTimeout(timer);
  }, [multiImages, singleImages, form.activeTab, onImagesMetaChange]);

  // ── Helpers ────────────────────────────────────────────────────────────────
  const charCount = form.content.length;
  /** Chế độ '1 ảnh + Prompt tổng' — chỉ nhận đúng 1 ảnh, ảnh mới thay ảnh cũ */
  const maxImages = imageMode === 'single' ? 1 : MAX_IMAGES;

  const validate = (): FormErrors => {
    const e: FormErrors = {};
    // Tab "Veo trực tiếp" — lỗi chi tiết (parse/validate/ảnh) do DirectVeoInput tự hiển thị
    // inline, live khi gõ. Ở đây chỉ chặn submit khi payload chưa hợp lệ (xem handleSubmit) —
    // KHÔNG chạy validateContent/validateUrl/upload của các tab cũ cho tab này.
    if (form.activeTab === 'veo-direct') {
      setErrors(e);
      return e;
    }
    if (form.activeTab === 'text') {
      const msg = validateContent(form.content);
      if (msg) e.content = msg;
    }
    if (form.activeTab === 'link') {
      const msg = validateUrl(form.linkUrl);
      if (msg) e.linkUrl = msg;
      const youtube = !msg && isYouTubeUrl(form.linkUrl);
      // YouTube: mô tả tuỳ chọn; link khác: bắt buộc mô tả (Gemini không tự xem được)
      const descMsg = validateLinkDescription(form.linkDescription, youtube);
      if (descMsg) e.linkDescription = descMsg;
    }
    if (form.activeTab === 'image') {
      // Prompt tổng chỉ tồn tại (và bắt buộc) ở chế độ "1 ảnh" — chế độ "Nhiều ảnh"
      // chỉ dùng prompt riêng từng ảnh, không có Prompt tổng để mà validate.
      if (imageMode === 'single') {
        const masterMsg = validateImageMasterBrief(imageMasterBrief);
        if (masterMsg) e.imageMasterBrief = masterMsg;
      }

      if (uploadedImages.length === 0) {
        e.upload = 'Vui lòng tải lên ít nhất một hình ảnh.';
      } else {
        for (const img of uploadedImages) {
          // Ảnh phục hồi từ dữ liệu đã lưu (Storage) không có File thật, chỉ có
          // previewUrl/path — vẫn hợp lệ, không bắt tải lại.
          if (!img.file && !img.previewUrl) {
            e.upload = `${img.label ?? 'Một ảnh'} chưa có ảnh — hãy tải hình lên.`;
            break;
          }
          const fileMsg = img.file ? validateImageFile(img.file) : undefined;
          if (fileMsg) {
            e.upload = fileMsg;
            break;
          }
        }
      }
    }
    setErrors(e);
    return e;
  };

  const handleSubmit = async () => {
    if (submitLockRef.current || isItemBusy || !form.activeTab) return;

    const e = validate();
    if (Object.keys(e).length > 0) {
      if (e.content) textareaRef.current?.focus();
      return;
    }

    submitLockRef.current = true;

    // Gemini API Key không bắt buộc — bỏ trống thì backend tự dùng key dự phòng của server (nếu có)
    const geminiKey = getApiKey('gemini');
    // if (!geminiKey.trim()) {
    //   submitLockRef.current = false;
    //   setErrors((p) => ({
    //     ...p,
    //     submit: 'Chưa có Gemini API Key — vào mục API Keys để nhập và lưu key.',
    //   }));
    //   return;
    // }

    // 'veo-gemini' dùng key RIÊNG "Gemini Key Veo 3.1", bắt buộc user tự nhập (BYOK). Nhà cung
    // cấp mặc định 'veo' (qua kie.ai) dùng key hệ thống do admin quản lý — không cần user nhập
    // gì, không chặn submit ở đây (thiếu key hệ thống sẽ báo lỗi rõ ràng từ backend khi tạo video).
    const isGeminiVeoProvider = settings.videoProvider === 'veo-gemini';
    const videoApiKey = getVideoApiKeyForProvider(settings.videoProvider);
    if (isGeminiVeoProvider && !videoApiKey) {
      submitLockRef.current = false;
      setErrors((p) => ({
        ...p,
        submit: 'Chưa có "Gemini Key Veo 3.1" — nhập key riêng tại mục API Keys để tạo video Veo3.1 Gemini.',
      }));
      return;
    }
    if (!settings.veoModel?.trim()) {
      submitLockRef.current = false;
      setErrors((p) => ({
        ...p,
        submit: 'Chưa chọn model Veo — đợi danh sách model tải xong và chọn trong thanh cài đặt.',
      }));
      return;
    }

    // Tab "Veo trực tiếp" — rẽ nhánh SỚM, KHÔNG rơi xuống luồng Gemini bên dưới (§10, §21):
    // không gọi getApiKey('gemini')/toPipelineCharacters/buildAnalyzePipeline/startAnalyze.
    if (form.activeTab === 'veo-direct') {
      const payload = directVeoRef.current?.validateAndGetPayload();
      if (!payload) {
        submitLockRef.current = false;
        return;
      }

      const provider = settings.videoProvider;
      let scenes: ReturnType<typeof mapDirectVeoScenesToVideoScenes>;
      try {
        // mapDirectVeoScenesToVideoScenes có thể ném Error nếu input bất thường — validator ở
        // DirectVeoInput lẽ ra đã chặn, đây chỉ là defense-in-depth. Vẫn phải bắt ở đây: nếu để
        // lọt, throw không bắt sẽ khoá vĩnh viễn submitLockRef (không có finally nào reset lại)
        // — nút submit im lặng không phản hồi nữa cho tới khi tải lại trang.
        scenes = mapDirectVeoScenesToVideoScenes({
          scenes: payload.scenes,
          globalContext: payload.globalContext,
          sceneDurationSetting: settings.sceneDuration,
          videoQuality: settings.videoQuality,
          provider,
        });
      } catch (err) {
        submitLockRef.current = false;
        setErrors((p) => ({
          ...p,
          directVeo: toUserMessage(err, 'Không dựng được cảnh từ Prompt — thử lại.'),
        }));
        return;
      }

      const directVeoInput: VeoInput = {
        apiKey: videoApiKey,
        aspectRatio: settings.aspectRatio,
        sceneDuration: normalizeSceneDurationSetting(settings.sceneDuration, settings.videoQuality, provider),
        videoQuality: settings.videoQuality,
        veoModel: settings.veoModel,
        provider,
        sceneContinuity: false, // §9 — continuity qua Global Prompt, không frame chaining
        spokenDialogueLanguage: settings.language,
      };
      const directTtsInput: TtsInput = { voice: '', language: settings.language, enabled: false }; // §10

      if (process.env.NODE_ENV !== 'production') {
        console.log('[direct-veo] submit', {
          scenes: scenes.length,
          promptLengths: scenes.map((s) => s.prompt.length),
          hasImage: scenes.map((s) => Boolean(s.sourceImageBase64)),
          veoModel: directVeoInput.veoModel, provider, ttsEnabled: directTtsInput.enabled,
        });
      }

      const started = startDirectVeoGeneration(projectId ?? 'default', {
        scenes,
        rawPrompt: buildDirectVeoInputContent(payload.scenes, payload.globalContext),
        veoInput: directVeoInput,
        ttsInput: directTtsInput,
      });
      if (!started) submitLockRef.current = false;
      return;
    }

    setErrors((p) => ({ ...p, submit: undefined }));
    const submitProjectId = projectId ?? 'default';
    const isImageTab = form.activeTab === 'image';
    // Chế độ 'single' (1 ảnh + Prompt tổng) — nhiều cảnh, KHÔNG map ảnh theo thứ tự cảnh
    // (ảnh dùng làm referenceImage chung, xem patch pipeline.veoInput bên dưới).
    const isSingleImageMode = isImageTab && imageMode === 'single';
    const isMultiImageMode = isImageTab && imageMode === 'multi';
    // Chế độ 'multi': mỗi ảnh = đúng 1 cảnh — ép Gemini sinh đúng số cảnh bằng số ảnh đã tải lên.
    // Chế độ 'single' (và mọi tab khác): theo đúng "Số cảnh" đã cài đặt.
    const effectiveSceneCount = isMultiImageMode ? String(uploadedImages.length) : settings.sceneCount;

    const contentForScenes =
      form.activeTab === 'text'
        ? form.content
        : form.activeTab === 'link'
          ? [
            form.linkUrl.trim() ? `URL video: ${form.linkUrl.trim()}` : '',
            form.linkDescription.trim()
              ? `Gợi ý / mô tả bổ sung từ người dùng:\n${form.linkDescription.trim()}`
              : '',
          ]
            .filter(Boolean)
            .join('\n\n') || 'Phân tích video đính kèm.'
          // Chế độ 'single' — Prompt tổng LÀ nội dung, dùng thẳng như tab text (Gemini viết
          // kịch bản nhiều cảnh từ đây, không tách theo từng ảnh).
          : isSingleImageMode
            ? imageMasterBrief
            : isMultiImageMode && uploadedImages.length > 0
              ? buildImagePipelineContent(uploadedImages)
              : form.content;

    const styleLabel = SCENE_STYLES.find((s) => s.id === sceneStyle)?.label ?? sceneStyle;

    try {
      // avatarDataUrl giờ là signed URL tạm từ Supabase Storage — luôn tải về + chuyển base64
      // ở toPipelineCharacters, bất kể provider. Await cùng các bước resolve ảnh/file khác.
      const characters = await toPipelineCharacters(
        characterMasterRef?.current?.getCharacters() ?? [],
      );
      // Đọc 1 ảnh đã upload thành base64 — từ File thật (vừa chọn) HOẶC phục hồi từ Storage
      // (chỉ có path/previewUrl, không có File — fetch lại bytes qua signed URL; previewUrl
      // có thể đã hết hạn sau 1 giờ nên fallback lấy signed URL mới).
      const resolveUploadedImage = async (
        img: UploadedImageItem,
      ): Promise<{ base64: string; mimeType: string } | null> => {
        if (img.file) return fileToBase64(img.file);
        const url = img.previewUrl ?? (img.path ? await getSourceSignedUrl(img.path) : undefined);
        if (!url) return null;
        const result = await fetchUrlAsBase64(url);
        if (result || !img.path) return result;
        const freshUrl = await getSourceSignedUrl(img.path);
        return freshUrl ? fetchUrlAsBase64(freshUrl) : null;
      };

      // Gom form → geminiInput / veoInput / ttsInput (pipeline-payload.ts)
      const pipeline = buildAnalyzePipeline({
        // ── API Keys (đọc từ localStorage, user lưu ở mục API Keys) ──
        geminiApiKey: geminiKey,              // Gemini — dùng ngay để gọi /api/gemini/analyze
        veoApiKey: videoApiKey,
        ttsApiKey: getApiKey(API_KEY_IDS.elevenlabs), // ElevenLabs — voiceover → audio MP3

        // ── Nội dung đầu vào (mục 2 — tab đang chọn) ──
        content: contentForScenes,            // Text / link / ảnh
        inputType: form.activeTab,            // 'text' | 'link' | 'image'
        imageMode: isImageTab ? imageMode : undefined,

        // ── Cài đặt kịch bản → geminiInput ──
        language: settings.language,
        sceneCount: effectiveSceneCount,
        characters,

        aspectRatio: settings.aspectRatio,
        sceneDuration: settings.sceneDuration,
        videoQuality: settings.videoQuality,
        veoModel: settings.veoModel,
        sceneStyleLabel: styleLabel,
        sceneStyleId: sceneStyle,

        voice: settings.voice,
        voiceSpeed,

        provider: settings.videoProvider,
        sceneContinuity: settings.sceneContinuity,

        // Tab link — YouTube: Gemini đọc qua file_uri
        sourceVideoUrl: form.activeTab === 'link' ? form.linkUrl.trim() || undefined : undefined,
      });

      // Chế độ 'single' (1 ảnh + Prompt tổng) — 1 ảnh dùng làm referenceImage áp dụng cho
      // MỌI cảnh (backend collectReferenceImages() đã ưu tiên đọc field này trước — đúng cơ
      // chế Master Cast đang dùng cho tab "Từ link video"), không map ảnh theo từng cảnh.
      if (isSingleImageMode && uploadedImages[0]) {
        const singleImage = await resolveUploadedImage(uploadedImages[0]);
        if (singleImage) {
          pipeline.veoInput = { ...pipeline.veoInput, referenceImage: singleImage };
        }
      }

      logAnalyzePipeline(
        pipeline,
        form.activeTab === 'image'
          ? {
            images: uploadedImages.map((img) => ({
              fileName: img.file?.name ?? '(chưa có file)',
              sizeMB: img.file ? (img.file.size / 1024 / 1024).toFixed(2) : '—',
              prompt: img.prompt.trim(),
            })),
          }
          : undefined,
      );

      // Chế độ 'multi' — đọc từng file thành base64 để gắn đúng ảnh[i] vào cảnh[i] khi gửi
      // Veo. Chế độ 'single' không map theo cảnh (đã patch referenceImage ở trên).
      const sceneImages = isMultiImageMode
        ? await Promise.all(uploadedImages.map(resolveUploadedImage))
        : undefined;

      const started = startAnalyze(submitProjectId, {
        pipeline,
        sourceContent: contentForScenes,
        sceneCount: effectiveSceneCount,
        language: settings.language,
        sceneImages,
      });

      if (!started) {
        submitLockRef.current = false;
        return;
      }
    } catch (err) {
      submitLockRef.current = false;
      setErrors((p) => ({
        ...p,
        submit: toUserMessage(err, 'Không đọc được video để gửi Files API.'),
      }));
    }
  };

  const handleSaveScript = () => {
    const s = form.content.trim();
    if (!s) {
      setErrors((p) => ({ ...p, content: 'Cần có nội dung để lưu kịch bản.' }));
      textareaRef.current?.focus();
      return;
    }
    if (s.length < 10) {
      setErrors((p) => ({
        ...p,
        content: `Nội dung quá ngắn — cần ít nhất 10 ký tự để lưu (hiện tại: ${s.length}).`,
      }));
      textareaRef.current?.focus();
      return;
    }
    onSaveScript?.(form.content, {
      language: settings.language,
      sceneCount: settings.sceneCount,
      voice: settings.voice,
      aspectRatio: settings.aspectRatio,
      sceneDuration: settings.sceneDuration,
      videoQuality: settings.videoQuality,
    });
    setSavedScript(true);
    setTimeout(() => setSavedScript(false), 2500);
  };

  const handleTabChange = (tab: TabId | null) => {
    // Lần đầu chọn nguồn (item chưa từng có initialInputType) — chốt khoá NGAY, không
    // đợi debounce, để dù điều hướng đi ngay sau khi chọn vẫn không mất lựa chọn này.
    if (tab && !locked) {
      onInputTypeLocked?.(tab);
    }
    setForm((f) => ({ ...f, activeTab: tab }));
    setErrors({});
    if (tab !== 'image') {
      setImageMasterBrief('');
      setMultiImages((prev) => {
        prev.forEach((img) => revokeImagePreview(img.previewUrl));
        return [];
      });
      setSingleImages((prev) => {
        prev.forEach((img) => revokeImagePreview(img.previewUrl));
        return [];
      });
    } else {
      setImageMasterBrief(savedImageMasterBrief);
    }
    // Rời tab "Veo trực tiếp" — remount DirectVeoInput (key đổi) để state (prompt + ảnh)
    // sạch hoàn toàn khi quay lại, tránh stale state leak giữa các lần chuyển tab.
    if (tab !== 'veo-direct') {
      setDirectVeoResetKey((k) => k + 1);
      setDirectVeoSceneCount(0);
    }
  };

  /**
   * Đổi chế độ multi/single — CHỈ đổi chế độ hiển thị, KHÔNG xoá ảnh/prompt của chế độ kia
   * (mỗi chế độ giữ riêng danh sách ảnh — xem multiImages/singleImages). Bị khoá vĩnh viễn
   * sau khi đã nhấn "Phân Tích & Tạo Kịch Bản" (imageModeLocked).
   */
  const handleImageModeChange = (mode: 'multi' | 'single') => {
    if (mode === imageMode || imageModeLocked) return;
    setImageMode(mode);
    setErrors((p) => ({ ...p, upload: undefined }));
  };

  /** Upload ảnh lên Storage ngay khi đính kèm (đăng nhập mới có path — guest vẫn ephemeral như trước) */
  const uploadImageInBackground = (imageId: string, file: File) => {
    void uploadSourceImage(imageId, file)
      .then((path) => {
        if (!path) return;
        setUploadedImages((prev) =>
          prev.map((img) => (img.id === imageId ? { ...img, path, fileName: file.name, mimeType: file.type } : img)),
        );
      })
      .catch((err) => {
        console.error('[input-section] Upload ảnh nguồn lên Storage thất bại:', err);
      });
  };

  const attachImageToSlot = (slotId: string, file: File) => {
    const msg = validateImageFile(file);
    if (msg) {
      setErrors((p) => ({ ...p, upload: msg }));
      return;
    }
    let oldPath: string | undefined;
    setUploadedImages((prev) =>
      prev.map((img) => {
        if (img.id !== slotId) return img;
        revokeImagePreview(img.previewUrl);
        oldPath = img.path;
        return {
          ...img,
          file,
          previewUrl: URL.createObjectURL(file),
          path: undefined,
          fileName: undefined,
          mimeType: undefined,
        };
      }),
    );
    if (oldPath) deleteSourceUpload(oldPath);
    uploadImageInBackground(slotId, file);
    setErrors((p) => ({ ...p, upload: undefined }));
  };

  const openSlotUpload = (slotId: string) => {
    setPendingImageSlotId(slotId);
    fileInputRef.current?.click();
  };

  const addImages = (files: FileList | File[]) => {
    const list = Array.from(files);
    if (list.length === 0) return;

    /** {imageId, file, oldPath?} cần upload lên Storage sau khi setUploadedImages xong */
    const toUpload: Array<{ id: string; file: File; oldPath?: string }> = [];

    setUploadedImages((prev) => {
      const next = [...prev];
      let fileIndex = 0;
      let firstError: string | undefined;

      for (let i = 0; i < next.length && fileIndex < list.length; i++) {
        if (next[i].file) continue;
        const file = list[fileIndex];
        const msg = validateImageFile(file);
        if (msg) {
          firstError = msg;
          fileIndex++;
          continue;
        }
        revokeImagePreview(next[i].previewUrl);
        toUpload.push({ id: next[i].id, file, oldPath: next[i].path });
        next[i] = {
          ...next[i],
          file,
          previewUrl: URL.createObjectURL(file),
          path: undefined,
          fileName: undefined,
          mimeType: undefined,
        };
        fileIndex++;
      }

      const remaining = maxImages - next.length;
      const toAdd = list.slice(fileIndex, fileIndex + Math.max(0, remaining));
      const newItems: UploadedImageItem[] = [];

      for (const file of toAdd) {
        const msg = validateImageFile(file);
        if (msg) {
          firstError = msg;
          continue;
        }
        const id = createImageId();
        toUpload.push({ id, file });
        newItems.push({
          id,
          file,
          previewUrl: URL.createObjectURL(file),
          prompt: '',
        });
      }

      if (fileIndex === 0 && newItems.length === 0 && firstError) {
        setErrors((p) => ({ ...p, upload: firstError }));
        return prev;
      }

      if (list.length > fileIndex + toAdd.length) {
        setErrors((p) => ({
          ...p,
          upload: `Chỉ thêm được tối đa ${maxImages} ảnh.`,
        }));
      } else {
        setErrors((p) => ({ ...p, upload: undefined }));
      }

      return [...next, ...newItems];
    });

    for (const { id, file, oldPath } of toUpload) {
      if (oldPath) deleteSourceUpload(oldPath);
      uploadImageInBackground(id, file);
    }
  };

  const updateImagePrompt = (id: string, value: string) => {
    setUploadedImages((prev) => prev.map((img) => (img.id === id ? { ...img, prompt: value } : img)));
  };

  const removeImage = (id: string) => {
    setUploadedImages((prev) => {
      const target = prev.find((img) => img.id === id);
      if (target) {
        revokeImagePreview(target.previewUrl);
        if (target.path) deleteSourceUpload(target.path);
      }
      return prev.filter((img) => img.id !== id);
    });
    setErrors((p) => ({ ...p, upload: undefined }));
  };

  const updateImageMasterBrief = (value: string) => {
    setImageMasterBrief(value);
    if (errors.imageMasterBrief) {
      setErrors((p) => ({ ...p, imageMasterBrief: undefined }));
    }
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setForm((f) => ({ ...f, dragOver: false }));
    addImages(e.dataTransfer.files);
  };

  const handleFileSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (pendingImageSlotId && file) {
      attachImageToSlot(pendingImageSlotId, file);
      setPendingImageSlotId(null);
    } else if (e.target.files?.length) {
      addImages(e.target.files);
    }
    e.target.value = '';
  };

  const acceptedTypes = 'image/jpeg,image/png,image/webp,image/gif';
  const isHighlighted = justApplied;

  const currentStyle = SCENE_STYLES.find((s) => s.id === sceneStyle);
  // Dự án cũ có thể còn lưu voiceSpeed > 1.2 (1.25/1.5/2 — trước khi rút option) —
  // clamp về đúng giới hạn thật để không vỡ % thanh trượt hay mất mô tả "currentSpeed".
  const clampedVoiceSpeed = Math.min(VOICE_SPEED_MAX, Math.max(VOICE_SPEED_MIN, voiceSpeed));
  const currentSpeed = SPEED_OPTIONS.find((o) => o.value === clampedVoiceSpeed);
  const speedPercent = ((clampedVoiceSpeed - VOICE_SPEED_MIN) / (VOICE_SPEED_MAX - VOICE_SPEED_MIN)) * 100;
  const selectedTab = tabs.find((t) => t.id === form.activeTab);

  return (
    <section
      aria-labelledby="section-input-heading"
      className={cn(
        'space-y-6 rounded-xl transition-all duration-300',
        isHighlighted && 'ring-2 ring-primary/30 ring-offset-2 ring-offset-background p-4 -m-4',
      )}
    >
      {/* Header */}
      <div className="flex items-center justify-between">
        <h2 id="section-input-heading" className="section-label">
          2. NHẬP NỘI DUNG ĐỂ AI TẠO VIDEO
        </h2>
        {justApplied && (
          <span className="flex items-center gap-1.5 text-xs text-green-400 bg-green-500/10 border border-green-500/20 px-2.5 py-1 rounded-full">
            <CheckCircle2 className="w-3.5 h-3.5" />Đã điền từ kịch bản mẫu
          </span>
        )}
      </div>

      {!form.activeTab ? (
        // Chưa chọn cách nhập — hiện màn chọn, chưa hiện giao diện nhập nội dung
        <div>
          <p className="text-xs text-muted-foreground mb-3">
            Chọn 1 cách để AI lấy nội dung tạo video:
          </p>
          <div
            role="tablist"
            aria-label="Nguồn nội dung"
            className="grid grid-cols-2 sm:grid-cols-2 lg:grid-cols-4 gap-2 sm:gap-3"
          >
            {tabs.map((tab) => (
              <button
                key={tab.id}
                type="button"
                role="tab"
                aria-selected={false}
                onClick={() => handleTabChange(tab.id)}
                className="p-4 rounded-lg border transition-all text-left bg-card border-border text-muted-foreground hover:border-primary/30 hover:text-foreground hover:bg-primary/5"
              >
                <tab.icon className="w-5 h-5 mb-2" />
                <span className="block text-xs font-semibold leading-tight">{tab.label}</span>
                <span className="block text-xs text-muted-foreground mt-1">{tab.desc}</span>
              </button>
            ))}
          </div>
        </div>
      ) : (
        <>
          {/* Cách nhập đã chọn — đổi lại nếu cần */}
          <div className="flex items-center justify-between gap-3 px-3 py-2.5 rounded-lg border border-primary/30 bg-primary/5">
            <div className="flex items-center gap-2.5 min-w-0">
              {selectedTab && <selectedTab.icon className="w-4 h-4 text-primary shrink-0" />}
              <div className="min-w-0">
                <span className="block text-xs font-semibold text-foreground truncate">{selectedTab?.label}</span>
                <span className="block text-[10px] text-muted-foreground truncate">{selectedTab?.desc}</span>
              </div>
            </div>
            {!locked && (
              <Button
                type="button"
                variant="ghost"
                size="sm"
                onClick={() => handleTabChange(null)}
                className="shrink-0 h-auto p-0 text-primary hover:text-primary hover:bg-transparent hover:underline"
              >
                Đổi cách nhập
              </Button>
            )}
          </div>

          {/* Content input */}
          <div>
            {form.activeTab === 'text' && (
              <div>
                <textarea
                  ref={textareaRef}
                  value={form.content}
                  aria-invalid={!!errors.content}
                  aria-describedby={errors.content ? 'content-error' : undefined}
                  onChange={(e) => {
                    setForm((f) => ({ ...f, content: e.target.value }));
                    if (errors.content) setErrors((p) => ({ ...p, content: undefined }));
                  }}
                  placeholder="Nhập nội dung để AI tạo video — ví dụ: kịch bản, chủ đề, ý tưởng..."
                  className={cn(
                    // resize-y + min-h (thay vì h cố định) — người dùng kéo góc dưới-phải để
                    // phóng to khung nhập, dễ đọc lại nội dung dài mà không bị giới hạn chiều cao.
                    'w-full min-h-40 px-4 py-3 bg-card border rounded-lg text-foreground placeholder-muted-foreground resize-y focus:outline-none transition-colors',
                    errors.content
                      ? 'border-destructive focus:border-destructive focus:ring-1 focus:ring-destructive/30'
                      : 'border-border focus:border-primary/50 focus:ring-1 focus:ring-primary/20',
                  )}
                />
                <div className="flex items-center justify-between mt-1.5 gap-3">
                  {errors.content ? (
                    <FieldError id="content-error" className="gap-1">{errors.content}</FieldError>
                  ) : (
                    <p className="text-xs text-muted-foreground">
                      Cần tối thiểu <span className="font-medium text-foreground">{MIN_CONTENT_CHARS}</span> ký tự — không giới hạn tối đa.
                    </p>
                  )}
                </div>
              </div>
            )}

            {form.activeTab === 'link' && (
              <div>
                <input
                  type="url"
                  value={form.linkUrl}
                  aria-invalid={!!errors.linkUrl}
                  aria-describedby={errors.linkUrl ? 'link-error' : 'link-hint'}
                  onChange={(e) => {
                    setForm((f) => ({ ...f, linkUrl: e.target.value }));
                    if (errors.linkUrl) setErrors((p) => ({ ...p, linkUrl: undefined }));
                  }}
                  placeholder="https://www.youtube.com/watch?v=..."
                  className={cn(
                    'w-full px-4 py-3 bg-card border rounded-lg text-foreground placeholder-muted-foreground focus:outline-none transition-colors',
                    errors.linkUrl
                      ? 'border-destructive focus:border-destructive focus:ring-1 focus:ring-destructive/30'
                      : 'border-border focus:border-primary/50 focus:ring-1 focus:ring-primary/20',
                  )}
                />
                {errors.linkUrl ? (
                  <FieldError id="link-error" className="gap-1 mt-1.5">{errors.linkUrl}</FieldError>
                ) : (
                  <p id="link-hint" className="text-xs text-muted-foreground mt-2">
                    {isYouTubeUrl(form.linkUrl)
                      ? 'YouTube: chỉ cần dán link — Gemini xem video trực tiếp, không cần tải file.'
                      : 'Hỗ trợ: YouTube, TikTok, Vimeo, Facebook. YouTube chỉ cần dán link.'}
                  </p>
                )}

                <div className="mt-3">
                  <label className="field-label block mb-1.5">
                    {isYouTubeUrl(form.linkUrl)
                      ? 'Mô tả / yêu cầu thêm (tuỳ chọn)'
                      : 'Mô tả / yêu cầu thêm'}
                  </label>
                  <textarea
                    value={form.linkDescription}
                    aria-invalid={!!errors.linkDescription}
                    aria-describedby={errors.linkDescription ? 'link-description-error' : 'link-description-hint'}
                    onChange={(e) => {
                      setForm((f) => ({ ...f, linkDescription: e.target.value }));
                      if (errors.linkDescription) setErrors((p) => ({ ...p, linkDescription: undefined }));
                    }}
                    rows={4}
                    placeholder="VD: Đổi nhân vật thành màu đỏ; giữ nguyên cốt truyện; phong cách anime..."
                    className={cn(
                      'w-full px-4 py-3 bg-card border rounded-lg text-foreground placeholder-muted-foreground resize-y min-h-24 focus:outline-none transition-colors',
                      errors.linkDescription
                        ? 'border-destructive focus:border-destructive focus:ring-1 focus:ring-destructive/30'
                        : 'border-border focus:border-primary/50 focus:ring-1 focus:ring-primary/20',
                    )}
                  />
                  {errors.linkDescription ? (
                    <FieldError id="link-description-error" className="gap-1 mt-1.5">{errors.linkDescription}</FieldError>
                  ) : (
                    <p id="link-description-hint" className="text-xs text-muted-foreground mt-2">
                      {isYouTubeUrl(form.linkUrl)
                        ? 'Tuỳ chọn — ví dụ yêu cầu đổi màu nhân vật, phong cách, số cảnh…'
                        : 'Link không phải YouTube: Gemini không tự xem được — hãy mô tả nội dung video chi tiết.'}
                    </p>
                  )}
                </div>
              </div>
            )}

            {form.activeTab === 'image' && (
              <div className="space-y-3">
                <div
                  role="tablist"
                  aria-label="Chế độ ảnh"
                  className={cn('grid gap-2', imageModeLocked ? 'grid-cols-1' : 'grid-cols-2')}
                >
                  {(!imageModeLocked || imageMode === 'multi') && (
                    <button
                      type="button"
                      role="tab"
                      aria-selected={imageMode === 'multi'}
                      disabled={imageModeLocked}
                      onClick={() => handleImageModeChange('multi')}
                      className={cn(
                        'px-3 py-2 rounded-lg border text-xs font-semibold text-left transition-colors',
                        imageMode === 'multi'
                          ? 'bg-primary/10 border-primary/50 text-primary ring-1 ring-primary/25'
                          : 'bg-card border-border text-muted-foreground hover:border-primary/30 hover:text-foreground',
                        imageModeLocked && 'cursor-default',
                      )}
                    >
                      Nhiều ảnh
                      <span className="block text-[10px] font-normal opacity-80 mt-0.5">Mỗi ảnh 1 cảnh riêng</span>
                    </button>
                  )}
                  {(!imageModeLocked || imageMode === 'single') && (
                    <button
                      type="button"
                      role="tab"
                      aria-selected={imageMode === 'single'}
                      disabled={imageModeLocked}
                      onClick={() => handleImageModeChange('single')}
                      className={cn(
                        'px-3 py-2 rounded-lg border text-xs font-semibold text-left transition-colors',
                        imageMode === 'single'
                          ? 'bg-primary/10 border-primary/50 text-primary ring-1 ring-primary/25'
                          : 'bg-card border-border text-muted-foreground hover:border-primary/30 hover:text-foreground',
                        imageModeLocked && 'cursor-default',
                      )}
                    >
                      1 ảnh
                      <span className="block text-[10px] font-normal opacity-80 mt-0.5">Prompt tổng cho cả video</span>
                    </button>
                  )}
                </div>

                {imageMode === 'single' && (
                  <div className="rounded-xl border border-border bg-card/40 p-3 space-y-2">
                    <label htmlFor="image-master-brief" className="text-xs font-semibold text-foreground">
                      Prompt tổng
                    </label>
                    <textarea
                      id="image-master-brief"
                      value={imageMasterBrief}
                      onChange={(e) => updateImageMasterBrief(e.target.value)}
                      placeholder="Mô tả toàn bộ câu chuyện/video — Gemini sẽ tách thành nhiều cảnh, ảnh đính kèm dùng giữ nhân vật xuyên suốt..."
                      rows={4}
                      className={cn(
                        'w-full resize-y min-h-22 px-3 py-2 text-xs rounded-lg border bg-background text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-1',
                        errors.imageMasterBrief
                          ? 'border-destructive/60 focus:ring-destructive/30'
                          : 'border-border focus:ring-primary/30',
                      )}
                    />
                    {errors.imageMasterBrief ? (
                      <FieldError className="gap-1 text-[11px]">{errors.imageMasterBrief}</FieldError>
                    ) : (
                      <p className="text-[10px] text-muted-foreground leading-relaxed">
                        Toàn bộ nội dung video dựa vào prompt này — số cảnh theo đúng &quot;Số cảnh&quot; đã cài đặt, ảnh đính kèm dùng làm ảnh tham chiếu giữ nhân vật ở mọi cảnh.
                      </p>
                    )}
                  </div>
                )}

                <input
                  ref={fileInputRef}
                  type="file"
                  accept={acceptedTypes}
                  multiple={imageMode === 'multi'}
                  onChange={handleFileSelect}
                  className="hidden"
                />

                {uploadedImages.length > 0 && (
                  <div className="space-y-3">
                    {imageMode === 'multi' && imageMasterBrief && uploadedImages.some((img) => img.label) && (
                      <p className="text-[11px] text-muted-foreground leading-relaxed px-1">
                        Kịch bản mẫu — tải <strong className="text-foreground">1 ảnh stickman</strong> cho mỗi cảnh bên dưới. VIDEO PROMPT &amp; VOICE đã điền sẵn.
                      </p>
                    )}
                    {uploadedImages.map((img, index) => (
                      <div
                        key={img.id}
                        className="flex gap-3 rounded-xl border border-border bg-card/50 p-3"
                      >
                        <div className="relative shrink-0 w-24 h-24 sm:w-28 sm:h-28 rounded-lg overflow-hidden border border-border bg-muted">
                          {img.previewUrl && img.file ? (
                            /* eslint-disable-next-line @next/next/no-img-element */
                            <img
                              src={img.previewUrl}
                              alt={img.file.name}
                              className="w-full h-full object-cover"
                            />
                          ) : (
                            <button
                              type="button"
                              onClick={() => openSlotUpload(img.id)}
                              className="w-full h-full flex flex-col items-center justify-center gap-1.5 text-muted-foreground hover:text-primary hover:bg-primary/5 transition-colors"
                            >
                              <Image className="w-7 h-7" />
                              <span className="text-[10px] font-medium px-1 text-center">Tải ảnh</span>
                            </button>
                          )}
                        </div>

                        <div className="flex-1 min-w-0 flex flex-col gap-2">
                          <div className="flex items-start justify-between gap-2">
                            <div className="min-w-0">
                              <p className="text-xs font-semibold text-foreground leading-snug">
                                {imageMode === 'single' ? (img.label ?? 'Ảnh tham chiếu') : (img.label ?? `Ảnh ${index + 1}`)}
                              </p>
                              <p className="text-[10px] text-muted-foreground truncate">
                                {img.file
                                  ? `${img.file.name} · ${(img.file.size / 1024 / 1024).toFixed(2)} MB`
                                  : 'Chưa có ảnh — bấm ô trái để tải lên'}
                              </p>
                            </div>
                            <Button
                              type="button"
                              variant="icon-danger"
                              onClick={() => removeImage(img.id)}
                              title="Xóa ảnh"
                              className="shrink-0 w-7 h-7 rounded-lg border border-border bg-muted/60 hover:border-destructive/50"
                            >
                              <X className="w-4 h-4" />
                            </Button>
                          </div>

                          {imageMode === 'multi' && (
                            <textarea
                              value={img.prompt}
                              onChange={(e) => updateImagePrompt(img.id, e.target.value)}
                              placeholder="Hành động/bối cảnh cho đúng ảnh này (tuỳ chọn) — để trống thì Gemini tự phân tích ảnh."
                              rows={2}
                              className="w-full resize-y min-h-12 px-2.5 py-1.5 text-[11px] rounded-lg border border-border bg-background text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-primary/30 transition-colors"
                            />
                          )}

                          {img.voiceHint && (
                            <p className="text-[10px] text-muted-foreground leading-relaxed border-l-2 border-primary/30 pl-2">
                              <span className="font-semibold text-primary/90">VOICE (TTS): </span>
                              {img.voiceHint}
                            </p>
                          )}
                        </div>
                      </div>
                    ))}
                  </div>
                )}

                {uploadedImages.length < maxImages && (
                  <div
                    onDragOver={(e) => { e.preventDefault(); setForm((f) => ({ ...f, dragOver: true })); }}
                    onDragLeave={() => setForm((f) => ({ ...f, dragOver: false }))}
                    onDrop={handleDrop}
                    onClick={() => fileInputRef.current?.click()}
                    className={cn(
                      'w-full border-2 border-dashed rounded-xl flex flex-col items-center justify-center gap-2 cursor-pointer transition-colors px-4 text-center',
                      uploadedImages.length > 0 ? 'h-28' : 'h-40',
                      form.dragOver ? 'border-primary bg-primary/5'
                        : errors.upload ? 'border-destructive/60 bg-destructive/5 hover:border-destructive'
                          : 'border-border hover:border-primary/50 hover:bg-card',
                    )}
                  >
                    <Plus className={cn('w-7 h-7', uploadedImages.length > 0 ? 'text-primary' : 'text-muted-foreground')} />
                    <p className="text-sm text-muted-foreground">
                      {imageMode === 'single'
                        ? 'Kéo thả hoặc chọn 1 hình ảnh'
                        : uploadedImages.length > 0
                          ? `Thêm ảnh (${uploadedImages.length}/${maxImages})`
                          : 'Kéo thả hoặc chọn nhiều hình ảnh'}
                    </p>
                    <p className="text-xs text-muted-foreground/70">
                      JPG, PNG, WebP, GIF — tối đa {MAX_IMAGE_MB} MB/ảnh
                    </p>
                  </div>
                )}

                {errors.upload && <FieldError className="gap-1">{errors.upload}</FieldError>}
              </div>
            )}

            {form.activeTab === 'veo-direct' && (
              <div className="space-y-3">
                <DirectVeoInput
                  key={directVeoResetKey}
                  ref={directVeoRef}
                  disabled={isItemBusy}
                  projectId={projectId ?? 'default'}
                  initialScenes={savedDirectVeoScenes}
                  initialGlobalContext={savedDirectVeoGlobalContext}
                  onPromptChange={onContentChange}
                  onSceneCountChange={setDirectVeoSceneCount}
                  onPersist={onDirectVeoChange}
                />
                {errors.directVeo && <FieldError className="gap-1">{errors.directVeo}</FieldError>}
              </div>
            )}
          </div>

          {/* ── Tùy chỉnh nâng cao — nhóm Voice Speed + Scene Style ─────────── */}
          {/* Ẩn cả khối ở tab "Veo trực tiếp": cả 2 con (Voice Speed, Scene Style) đều đã bị
              ẩn riêng lẻ vì không áp dụng cho Direct Veo (không TTS, không qua Gemini) — để
              card rỗng nổi lên thì thừa, không có gì để tuỳ chỉnh. */}
          {form.activeTab !== 'veo-direct' && (
            <div className="bg-card/40 border border-border rounded-xl overflow-hidden">
              <div className="px-4 py-2.5 border-b border-border/60 bg-background/40 flex items-center gap-2">
                <Sliders className="w-3.5 h-3.5 text-primary" />
                <span className="text-[11px] font-bold text-foreground uppercase tracking-wider">
                  Tùy chỉnh nâng cao
                </span>
                <span className="text-[10px] text-muted-foreground ml-auto hidden sm:inline">
                  Tốc độ giọng · Phong cách cảnh
                </span>
              </div>

              {/* Tốc độ giọng (accordion) — cả khối cha đã ẩn ở tab "Veo trực tiếp" (§15: không TTS Speed) */}
              <div ref={voiceSpeedRef}>
                <button
                  type="button"
                  onClick={() => setShowVoiceSpeed((v) => !v)}
                  aria-expanded={showVoiceSpeed}
                  aria-controls="voice-speed-panel"
                  className="w-full flex items-center justify-between px-4 py-3 hover:bg-muted/30 transition-colors"
                >
                  <div className="flex items-center gap-2.5">
                    <div className="w-7 h-7 rounded-lg bg-primary/10 flex items-center justify-center shrink-0">
                      <Gauge className="w-3.5 h-3.5 text-primary" />
                    </div>
                    <div className="text-left">
                      <span className="block text-xs font-semibold text-foreground">Tốc độ giọng đọc (TTS)</span>
                      <span className="block text-[10px] text-muted-foreground mt-0.5">
                        Hiện tại: <span className="text-primary font-medium">{clampedVoiceSpeed}×</span>
                        {' '}— {currentSpeed?.desc}
                      </span>
                    </div>
                  </div>
                  {showVoiceSpeed
                    ? <ChevronUp className="w-4 h-4 text-muted-foreground" />
                    : <ChevronDown className="w-4 h-4 text-muted-foreground" />}
                </button>

                {showVoiceSpeed && (
                  <div id="voice-speed-panel" className="px-4 py-4 space-y-4 border-t border-border/60 bg-background/20">
                    <div className="flex gap-2 flex-wrap">
                      {SPEED_OPTIONS.map((opt) => {
                        const isActive = voiceSpeed === opt.value;
                        return (
                          <button
                            key={opt.value}
                            type="button"
                            onClick={() => patchSettings({ voiceSpeed: opt.value })}
                            aria-pressed={isActive}
                            className={cn(
                              'flex flex-col items-center px-4 py-2 rounded-xl border text-xs font-medium transition-all',
                              isActive
                                ? 'bg-primary/15 border-primary/50 text-primary ring-1 ring-primary/25'
                                : 'bg-background border-border text-muted-foreground hover:border-primary/30 hover:text-foreground',
                            )}
                          >
                            <span className="text-sm font-bold">{opt.label}</span>
                            <span className="mt-0.5 opacity-70">{opt.desc}</span>
                          </button>
                        );
                      })}
                    </div>
                    <div className="flex items-center gap-3 px-3 py-2.5 bg-muted/20 rounded-lg border border-border/50">
                      <Gauge className="w-3.5 h-3.5 text-muted-foreground shrink-0" />
                      <div className="flex-1 h-1.5 bg-border rounded-full overflow-hidden">
                        <div className="h-full bg-primary rounded-full transition-all duration-300" style={{ width: `${speedPercent}%` }} />
                      </div>
                      <span className="text-xs font-mono text-primary font-semibold w-10 text-right">{clampedVoiceSpeed}×</span>
                    </div>
                  </div>
                )}
              </div>

              {/* Phong cách cảnh (accordion) — cả khối cha đã ẩn ở tab "Veo trực tiếp": setting
                này chỉ ảnh hưởng cách Gemini viết script (buildAnalyzePipeline →
                pipeline-payload.ts:209), nhánh veo-direct rẽ sớm không bao giờ gọi Gemini nên
                chọn gì cũng vô nghĩa. */}
              <div ref={sceneStyleRef} className="border-t border-border/60">
                <button
                  type="button"
                  onClick={() => setShowSceneStyle((v) => !v)}
                  aria-expanded={showSceneStyle}
                  aria-controls="scene-style-panel"
                  className="w-full flex items-center justify-between px-4 py-3 hover:bg-muted/30 transition-colors"
                >
                  <div className="flex items-center gap-2.5 min-w-0">
                    <div className="w-7 h-7 rounded-lg bg-primary/10 flex items-center justify-center shrink-0">
                      <Palette className="w-3.5 h-3.5 text-primary" />
                    </div>
                    <div className="text-left min-w-0">
                      <span className="block text-xs font-semibold text-foreground">Phong cách cảnh (Visual Style)</span>
                      <span className="block text-[10px] text-muted-foreground mt-0.5 truncate">
                        {currentStyle ? (
                          <>
                            Hiện tại: <span className="text-primary font-medium">{currentStyle.emoji} {formatSceneStyleDisplayLabel(currentStyle)}</span>
                            {' '}— {currentStyle.desc}
                          </>
                        ) : (
                          <>
                            Hiện tại: <span className="text-primary font-medium">✍️ {sceneStyle || 'Tự nhập'}</span>
                            {' '}— Phong cách tùy chỉnh
                          </>
                        )}
                      </span>
                    </div>
                  </div>
                  {showSceneStyle
                    ? <ChevronUp className="w-4 h-4 text-muted-foreground shrink-0" />
                    : <ChevronDown className="w-4 h-4 text-muted-foreground shrink-0" />}
                </button>

                {showSceneStyle && (
                  <div id="scene-style-panel" className="px-4 py-4 border-t border-border/60 bg-background/20">
                    <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-2">
                      {SCENE_STYLES.map((style) => {
                        const isActive = !customStyleMode && sceneStyle === style.id;
                        return (
                          <button
                            key={style.id}
                            type="button"
                            onClick={() => { setCustomStyleMode(false); patchSettings({ sceneStyle: style.id }); }}
                            aria-pressed={isActive}
                            className={cn(
                              'flex flex-col items-start gap-1 p-3 rounded-xl border text-left transition-all',
                              isActive
                                ? 'bg-primary/10 border-primary/50 ring-1 ring-primary/25'
                                : 'bg-background border-border hover:border-primary/30 hover:bg-muted/20',
                            )}
                          >
                            <span className="text-base leading-none">{style.emoji}</span>
                            <span className={cn('text-xs font-semibold leading-tight', isActive ? 'text-primary' : 'text-foreground')}>
                              {formatSceneStyleDisplayLabel(style)}
                            </span>
                            <span className="text-[10px] text-muted-foreground leading-tight">{style.desc}</span>
                          </button>
                        );
                      })}

                      {/* Phong cách tùy chỉnh — khi không có preset nào phù hợp */}
                      <button
                        type="button"
                        onClick={() => { setCustomStyleMode(true); patchSettings({ sceneStyle: '' }); }}
                        aria-pressed={customStyleMode}
                        className={cn(
                          'flex flex-col items-start gap-1 p-3 rounded-xl border text-left transition-all',
                          customStyleMode
                            ? 'bg-primary/10 border-primary/50 ring-1 ring-primary/25'
                            : 'bg-background border-border hover:border-primary/30 hover:bg-muted/20',
                        )}
                      >
                        <Plus className={cn('w-4 h-4', customStyleMode ? 'text-primary' : 'text-muted-foreground')} />
                        <span className={cn('text-xs font-semibold leading-tight', customStyleMode ? 'text-primary' : 'text-foreground')}>
                          Khác — tự nhập
                        </span>
                        <span className="text-[10px] text-muted-foreground leading-tight">Mô tả phong cách riêng</span>
                      </button>
                    </div>

                    {customStyleMode && (
                      <div className="mt-3">
                        <label className="field-label block mb-1.5">Mô tả phong cách hình ảnh</label>
                        <input
                          type="text"
                          value={sceneStyle}
                          onChange={(e) => patchSettings({ sceneStyle: e.target.value })}
                          placeholder="VD: Stop-motion clay, ánh sáng neon..."
                          maxLength={100}
                          autoFocus
                          className="input-base"
                        />
                      </div>
                    )}
                  </div>
                )}
              </div>
            </div>
          )}

          {/* Actions row */}
          {errors.submit && <FieldError>{errors.submit}</FieldError>}
          <div className="flex flex-col sm:flex-row gap-2">
            <Button
              type="button"
              variant="accent"
              onClick={handleSubmit}
              disabled={isItemBusy}
              className="flex-1 py-3"
            >
              {isItemBusy
                ? <><Loader2 className="w-4 h-4 animate-spin" />Đang phân tích...</>
                : form.activeTab === 'veo-direct'
                  ? <><Send className="w-4 h-4" />{directVeoSceneCount > 0 ? `Tạo ${directVeoSceneCount} Video` : 'Tạo Video'}</>
                  : <><Send className="w-4 h-4" />Phân Tích &amp; Tạo Kịch Bản</>}
            </Button>

            {onSaveScript && form.activeTab === 'text' && (
              <Button
                type="button"
                variant="outline"
                onClick={handleSaveScript}
                title="Lưu lại kịch bản hiện tại để dùng sau"
                className={cn(
                  'py-3 sm:w-auto',
                  savedScript && 'bg-green-500/10 border-green-500/30 text-green-400 hover:text-green-400 hover:border-green-500/30 cursor-default',
                )}
              >
                {savedScript
                  ? <><CheckCircle2 className="w-4 h-4" />Đã lưu!</>
                  : <><Bookmark className="w-4 h-4" />Lưu kịch bản</>}
              </Button>
            )}
          </div>

          {/* Banner "Đã tạo kịch bản" — tĩnh, chỉ ẩn khi confirmSceneGeneration() clear
              pendingLinkReview (mục 3) hoặc phân tích lại. Mũi tên cuộn xuống mục 3. */}
          {awaitingScriptReview && (
            <Button
              type="button"
              onClick={onJumpToScenes}
              title="Đi tới danh sách cảnh"
              className="w-full flex items-center justify-center gap-2 px-4 py-3 rounded-xl border border-green-500/30 bg-green-500/10 text-xs text-foreground hover:bg-green-500/15 transition-colors cursor-pointer"
            >
              <CheckCircle2 className="w-4 h-4 text-green-400 shrink-0" />
              <span>
                Đã tạo kịch bản thành công — xem <strong>3. DANH SÁCH CẢNH</strong>
              </span>
              <ArrowDown className="w-4 h-4 text-green-400 shrink-0" />
            </Button>
          )}
        </>
      )}
    </section>
  );
}
