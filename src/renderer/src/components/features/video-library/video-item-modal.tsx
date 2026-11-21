'use client';

import { Fragment, useEffect, useState } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import {
  ArrowLeft, ArrowRight, CheckCircle2, Clapperboard, Cpu, Film, FileText, Image, ImagePlus,
  Info, Link2, Pencil, Play, Plus, Sparkles, Star, Type, X,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { ModalOverlay } from '@/components/ui/modal-overlay';
import { FieldError } from '@/components/ui/field-error';
import { Button } from '@/components/ui/button';
import { SelectVeo } from '@/components/ui/veomodel';
import { VoiceSelect } from '@/components/features/voice-select/voice-select';
import {
  ASPECT_RATIO_OPTIONS,
  DEFAULT_VIDEO_SETTINGS,
  getVideoProviderOptions,
  isVeoFamilyProvider,
  LANGUAGE_OPTIONS,
  normalizeVideoSettings,
  SCENE_COUNT_OPTIONS,
  VIDEO_QUALITY_OPTIONS,
  type VideoProvider,
  type VideoSettings,
} from '@/contexts/project-settings-context';
import { getSceneDurationOptions, normalizeSceneDurationSetting } from '@/lib/saved-scripts/saved-scripts';
import { useDefaultVeoModel } from '@/hooks/use-veo-models';
import { useVeoModels } from '@/contexts/veo-models-context';
import { useVideoLibrary } from '@/contexts/video-library-context';
import {
  formatVideoItemTitle,
  resolveVeoModelLabel,
  type CreateVideoItemOptions,
  type VideoLibraryItem,
} from '@/lib/video-library/video-library';
import { getApiKey, API_KEY_IDS } from '@/lib/api-keys/api-keys-store';
import { getVideoApiKeyForProvider, VEO_GEMINI_MODEL_OPTIONS } from '@/lib/veo/veo-models';
import { buildAnalyzePipeline, toPipelineCharacters } from '@/lib/pipeline-payload';
import { resolveSceneStyleLabel } from '@/lib/scene/scene-styles';
import { toUserMessage } from '@/lib/error-messages';
import { videoItemFormSchema, VIDEO_TITLE_MAX, type VideoItemFormValues } from '@/lib/schemas/video-item-schema';

interface VideoItemModalProps {
  mode: 'create' | 'edit';
  open: boolean;
  onClose: () => void;
  /** Bắt buộc khi mode="create" */
  onCreate?: (options: CreateVideoItemOptions) => void;
  /** Bắt buộc khi mode="edit" */
  initialItem?: VideoLibraryItem | null;
}

const selectClass =
  'w-full px-3 py-2 bg-background border border-border rounded-lg text-sm text-foreground focus:outline-none focus:border-primary/50 focus:ring-1 focus:ring-primary/20 disabled:opacity-60';

const MIN_CONTENT_CHARS = 20;

type ContentInputType = NonNullable<CreateVideoItemOptions['initialInputType']>;

// ─── Nguồn nội dung — màn chọn cách tạo video (Bước 1) ────────────────────────
// Giữ đúng 4 nguồn của contract `initialInputType` ('text' | 'link' | 'image' |
// 'veo-direct'). 3 nguồn đầu đi qua Gemini viết kịch bản + ElevenLabs TTS; 'veo-direct'
// là workflow riêng (user tự viết prompt + ảnh tham chiếu, gửi thẳng Veo).
type Accent = 'violet' | 'sky' | 'emerald' | 'amber';

interface SourceOption {
  id: ContentInputType;
  icon: typeof Type;
  accent: Accent;
  label: string;
  /** Nhãn nổi bật góc phải card (vd "Đề xuất", "Phù hợp Pro") */
  badge?: string;
  /** 1 dòng tóm tắt ngay dưới tiêu đề */
  tagline: string;
  /** Mô tả dài hơn — khi nào nên dùng */
  desc: string;
  /** "Phù hợp với" — 2 gạch đầu dòng */
  fits: [string, string];
  /** Các bước quy trình, hiển thị dạng chip nối bằng mũi tên */
  flow: string[];
}

const SOURCE_OPTIONS: SourceOption[] = [
  {
    id: 'text',
    icon: Type,
    accent: 'violet',
    label: 'Tự nhập nội dung',
    badge: 'Đề xuất',
    tagline: 'Nhập kịch bản, chủ đề hoặc ý tưởng — AI dựng kịch bản chi tiết.',
    desc: 'Dành cho người đã có ý tưởng và muốn kiểm soát nội dung. Gemini phân tích rồi dựng kịch bản theo từng cảnh trước khi tạo video.',
    fits: ['Đã có ý tưởng hoặc kịch bản sẵn', 'Muốn kiểm soát chi tiết nội dung video'],
    flow: ['Nội dung', 'Phân tích', 'Kịch bản', 'Veo', 'Video'],
  },
  {
    id: 'link',
    icon: Link2,
    accent: 'sky',
    label: 'Từ link video',
    tagline: 'Dán link YouTube, TikTok... để AI phân tích và tái tạo.',
    desc: 'AI phân tích nội dung video rồi dựng kịch bản, prompt mới để tái tạo video với Veo.',
    fits: ['Muốn tái tạo hoặc làm mới video có sẵn', 'Lấy ý tưởng từ video trên nền tảng khác'],
    flow: ['Link', 'Phân tích', 'Kịch bản', 'Veo', 'Video'],
  },
  {
    id: 'image',
    icon: Image,
    accent: 'emerald',
    label: 'Từ hình ảnh',
    tagline: 'Tải ảnh lên để AI tạo prompt và video từ hình ảnh.',
    desc: 'AI phân tích hình ảnh, tạo prompt chi tiết rồi dựng video chuyển động từ hình ảnh đó.',
    fits: ['Có ảnh muốn chuyển thành video', 'Tạo video từ concept hoặc thiết kế'],
    flow: ['Ảnh', 'Phân tích', 'Kịch bản', 'Veo', 'Video'],
  },
  {
    id: 'veo-direct',
    icon: Film,
    accent: 'amber',
    label: 'Tôi có prompt sẵn',
    badge: 'Phù hợp Pro',
    tagline: 'Dùng prompt của bạn (1 prompt + 1–3 ảnh tham chiếu).',
    desc: 'Kết hợp prompt bạn có sẵn với 1–3 ảnh tham chiếu, gửi thẳng đến Veo — không qua AI viết kịch bản.',
    fits: ['Đã có prompt và muốn thêm hình tham chiếu', 'Muốn kiểm soát hình ảnh và phong cách'],
    flow: ['Prompt', '1–3 ảnh', 'Veo', 'Video'],
  },
];

const ACCENT: Record<Accent, {
  /** Ô icon vuông bo góc cạnh tiêu đề */
  iconBox: string;
  /** Màu chữ tiêu đề + nhãn "Phù hợp với" */
  title: string;
  /** Viền card mặc định (nhuốm nhẹ màu accent như trong ảnh mẫu) */
  idleBorder: string;
  hoverBorder: string;
  selectedBorder: string;
  ring: string;
  badge: string;
  bullet: string;
  /** Quầng sáng nền trang trí phía sau lưới card */
  glow: string;
}> = {
  violet: {
    iconBox: 'bg-violet-500/15 text-violet-300 ring-1 ring-inset ring-violet-400/20',
    title: 'text-violet-300',
    idleBorder: 'border-violet-500/25',
    hoverBorder: 'hover:border-violet-400/70',
    selectedBorder: 'border-violet-400/80 ring-1 ring-violet-400/30',
    ring: 'focus-visible:ring-violet-400/50',
    badge: 'bg-violet-500/20 text-violet-200',
    bullet: 'text-violet-400',
    glow: 'bg-violet-500/20',
  },
  sky: {
    iconBox: 'bg-sky-500/15 text-sky-300 ring-1 ring-inset ring-sky-400/20',
    title: 'text-sky-300',
    idleBorder: 'border-sky-500/25',
    hoverBorder: 'hover:border-sky-400/70',
    selectedBorder: 'border-sky-400/80 ring-1 ring-sky-400/30',
    ring: 'focus-visible:ring-sky-400/50',
    badge: 'bg-sky-500/20 text-sky-200',
    bullet: 'text-sky-400',
    glow: 'bg-sky-500/15',
  },
  emerald: {
    iconBox: 'bg-emerald-500/15 text-emerald-300 ring-1 ring-inset ring-emerald-400/20',
    title: 'text-emerald-300',
    idleBorder: 'border-emerald-500/25',
    hoverBorder: 'hover:border-emerald-400/70',
    selectedBorder: 'border-emerald-400/80 ring-1 ring-emerald-400/30',
    ring: 'focus-visible:ring-emerald-400/50',
    badge: 'bg-emerald-500/20 text-emerald-200',
    bullet: 'text-emerald-400',
    glow: 'bg-emerald-500/15',
  },
  amber: {
    iconBox: 'bg-amber-500/15 text-amber-300 ring-1 ring-inset ring-amber-400/20',
    title: 'text-amber-300',
    idleBorder: 'border-amber-500/30',
    hoverBorder: 'hover:border-amber-400/70',
    selectedBorder: 'border-amber-400/80 ring-1 ring-amber-400/30',
    ring: 'focus-visible:ring-amber-400/50',
    badge: 'bg-amber-500/20 text-amber-200',
    bullet: 'text-amber-400',
    glow: 'bg-amber-500/15',
  },
};

/** Icon cho từng bước trong sơ đồ quy trình của card — mỗi nhãn ở `flow` map sang 1 icon. */
const FLOW_STEP_ICON: Record<string, typeof Type> = {
  'Nội dung': Type,
  Link: Link2,
  'Ảnh': Image,
  Prompt: Type,
  '1–3 ảnh': ImagePlus,
  'Phân tích': Cpu,
  'Kịch bản': FileText,
  Veo: Play,
  Video: Clapperboard,
};

export function VideoItemModal({ mode, open, onClose, onCreate, initialItem }: VideoItemModalProps) {
  const { updateItem, startRegenerate } = useVideoLibrary();

  // Field "Tên video" — quản lý bằng react-hook-form + zod (validate on blur, re-validate on
  // change sau lần lỗi đầu — đúng hành vi mode: 'onBlur' + reValidateMode mặc định 'onChange'
  // của RHF). Các field còn lại (content/settings...) vẫn giữ useState tay như cũ — không phải
  // input dạng text cần validate theo schema, đổi hết sang RHF sẽ là refactor lớn không cần
  // thiết cho phạm vi lần này.
  const {
    register,
    handleSubmit,
    reset: resetTitleForm,
    watch,
    formState: { errors: titleErrors, isSubmitting },
  } = useForm<VideoItemFormValues>({
    resolver: zodResolver(videoItemFormSchema),
    mode: 'onBlur',
    reValidateMode: 'onChange',
    defaultValues: { title: '' },
  });
  const titleValue = watch('title') ?? '';

  const [content, setContent] = useState('');
  const [contentInputType, setContentInputType] = useState<ContentInputType | null>(null);
  /** Bước wizard khi tạo mới: 'source' = màn chọn cách tạo video, 'details' = thiết lập thông tin. */
  const [step, setStep] = useState<'source' | 'details'>('source');
  const [settings, setSettings] = useState<VideoSettings>(DEFAULT_VIDEO_SETTINGS);
  const [otherErrors, setOtherErrors] = useState<{ content?: string; contentInputType?: string; submit?: string }>({});
  const [saved, setSaved] = useState(false);

  const {
    models: kieVeoModels,
    loading: kieVeoModelsLoading,
    hasKey: hasKieVeoKey,
    hasVeoGeminiKey,
  } = useVeoModels();

  // 'veo-gemini' gọi thẳng Google: model cố định ở frontend, "đã có key" = có "Gemini Key Veo 3.1"
  const isGeminiVeo = settings.videoProvider === 'veo-gemini';
  const veoModels = isGeminiVeo ? VEO_GEMINI_MODEL_OPTIONS : kieVeoModels;
  const veoModelsLoading = isGeminiVeo ? false : kieVeoModelsLoading;
  const hasVeoKey = isGeminiVeo ? hasVeoGeminiKey : hasKieVeoKey;

  useDefaultVeoModel(
    veoModels,
    settings.videoQuality,
    settings.veoModel,
    (modelId) => setSettings((s) => ({ ...s, veoModel: modelId })),
  );

  useEffect(() => {
    if (!open) return;
    setOtherErrors({});
    setSaved(false);
    if (mode === 'edit' && initialItem) {
      resetTitleForm({ title: initialItem.title });
      setContent(initialItem.inputContent);
      // Video cũ có thể còn nhà cung cấp 'kie' (Grok Imagine đã gỡ) — chuẩn hoá về 'veo'
      setSettings(normalizeVideoSettings({ ...initialItem.settings }));
    } else {
      resetTitleForm({ title: formatVideoItemTitle() });
      setContent('');
      setContentInputType(null);
      setStep('source');
      setSettings({ ...DEFAULT_VIDEO_SETTINGS });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, mode, initialItem]);

  useEffect(() => {
    setSettings((prev) => {
      const next = normalizeSceneDurationSetting(prev.sceneDuration, prev.videoQuality, prev.videoProvider);
      return next === prev.sceneDuration ? prev : { ...prev, sceneDuration: next };
    });
  }, [settings.videoQuality, settings.videoProvider]);

  if (!open) return null;
  if (mode === 'edit' && !initialItem) return null;

  const sceneDurationOptions = getSceneDurationOptions(settings.videoQuality, settings.videoProvider);
  const patch = (p: Partial<VideoSettings>) => setSettings((s) => ({ ...s, ...p }));

  const busy = mode === 'edit' && !!initialItem
    && (initialItem.isRegenerating || initialItem.status === 'analyzing' || initialItem.status === 'generating');

  const contentChanged = mode === 'edit' && initialItem
    ? content.trim() !== initialItem.inputContent.trim()
    || JSON.stringify(settings) !== JSON.stringify(initialItem.settings)
    : false;

  const onSubmitCreate = handleSubmit((data) => {
    if (!contentInputType) {
      setStep('source');
      setOtherErrors({ contentInputType: 'Vui lòng chọn cách tạo video.' });
      return;
    }
    setOtherErrors({});
    onCreate?.({ title: data.title, settings: { ...settings }, initialInputType: contentInputType });
    onClose();
  });

  const onSubmitSaveOnly = handleSubmit((data) => {
    if (!initialItem) return;
    setOtherErrors({});
    updateItem(initialItem.id, {
      title: data.title,
      settings: { ...settings },
      veoModelLabel: resolveVeoModelLabel(initialItem.veoInput, settings),
      aspectRatio: settings.aspectRatio,
    });
    setSaved(true);
    setTimeout(() => setSaved(false), 2000);
  });

  const onSubmitSaveAndRegenerate = handleSubmit(async (data) => {
    if (!initialItem) return;

    const trimmedContent = content.trim();
    if (trimmedContent.length < MIN_CONTENT_CHARS) {
      setOtherErrors({ content: `Nội dung quá ngắn — cần ít nhất ${MIN_CONTENT_CHARS} ký tự (hiện tại: ${trimmedContent.length}).` });
      return;
    }

    // Gemini API Key không bắt buộc — bỏ trống thì backend tự dùng key dự phòng của server (nếu có)
    const geminiKey = getApiKey('gemini');
    // 'veo-gemini' dùng key RIÊNG "Gemini Key Veo 3.1", không phải Gemini API Key kịch bản
    const videoApiKey = getVideoApiKeyForProvider(settings.videoProvider);
    if (!videoApiKey) {
      setOtherErrors({
        submit: settings.videoProvider === 'veo-gemini'
          ? 'Chưa có "Gemini Key Veo 3.1" — nhập key riêng tại mục API Keys để tạo video Veo3.1 Gemini.'
          : 'Chưa có Video API Key — nhập key riêng tại mục API Keys để tạo video Veo 3.1.',
      });
      return;
    }
    if (!settings.veoModel?.trim()) {
      setOtherErrors({ submit: 'Chưa chọn model Veo — đợi danh sách model tải xong và chọn trong cài đặt.' });
      return;
    }
    setOtherErrors({});

    // Lưu title/settings ngay — tạo lại chạy nền, không chặn phần lưu cơ bản
    updateItem(initialItem.id, {
      title: data.title,
      settings: { ...settings },
      veoModelLabel: resolveVeoModelLabel(initialItem.veoInput, settings),
      aspectRatio: settings.aspectRatio,
    });


    // Trước đây KHÔNG có try/catch quanh đoạn await này — nếu toPipelineCharacters/
    // buildAnalyzePipeline throw thì lỗi rơi thành unhandled rejection, nút bấm không phản hồi
    // gì và user tưởng app treo. Bọc lại + map qua toUserMessage để luôn có thông báo rõ ràng.
    try {
      const characters = await toPipelineCharacters(initialItem.characters);
      const pipeline = buildAnalyzePipeline({
        geminiApiKey: geminiKey,
        veoApiKey: videoApiKey,
        ttsApiKey: getApiKey(API_KEY_IDS.elevenlabs),
        content: trimmedContent,
        inputType: 'text',
        language: settings.language,
        sceneCount: settings.sceneCount,
        characters,
        aspectRatio: settings.aspectRatio,
        sceneDuration: settings.sceneDuration,
        videoQuality: settings.videoQuality,
        veoModel: settings.veoModel,
        sceneStyleLabel: resolveSceneStyleLabel(settings.sceneStyle),
        sceneStyleId: settings.sceneStyle,
        voice: settings.voice,
        voiceSpeed: settings.voiceSpeed,
        provider: settings.videoProvider,
        sceneContinuity: settings.sceneContinuity,
      });

      const started = startRegenerate(initialItem.id, {
        pipeline,
        sourceContent: trimmedContent,
        sceneCount: settings.sceneCount,
        language: settings.language,
      });

      if (!started) {
        setOtherErrors({ submit: 'Video đang xử lý — vui lòng thử lại sau.' });
        return;
      }

      onClose();
    } catch (err) {
      setOtherErrors({ submit: toUserMessage(err, 'Chuẩn bị dữ liệu tạo lại thất bại — vui lòng thử lại.') });
    }
  });

  const isEdit = mode === 'edit';
  const titleErrorId = 'video-title-error';
  /** true khi đang ở màn chọn cách tạo video (chỉ có ở mode create) */
  const showSourceStep = !isEdit && step === 'source';
  const selectedSource = SOURCE_OPTIONS.find((o) => o.id === contentInputType) ?? null;

  const selectSource = (id: ContentInputType) => {
    setContentInputType(id);
    setOtherErrors((p) => ({ ...p, contentInputType: undefined }));
    setStep('details');
  };

  const renderSourceCard = (opt: SourceOption) => {
    const accent = ACCENT[opt.accent];
    const selected = contentInputType === opt.id;
    return (
      <button
        key={opt.id}
        type="button"
        aria-pressed={selected}
        onClick={() => selectSource(opt.id)}
        className={cn(
          'group relative flex flex-col text-left rounded-2xl border bg-card/50 p-5 transition-all',
          'focus:outline-none focus-visible:ring-2',
          selected ? accent.selectedBorder : accent.idleBorder,
          accent.hoverBorder,
          accent.ring,
        )}
      >
        <div className="mb-2.5 flex h-5 items-center justify-end">
          {opt.badge && (
            <span className={cn(
              'inline-flex items-center gap-1 rounded-full px-2.5 py-1 text-[11px] font-semibold',
              accent.badge,
            )}>
              <Star className="h-3 w-3 fill-current" />
              {opt.badge}
            </span>
          )}
        </div>

        <div className="flex items-start gap-3.5">
          <span className={cn('flex h-12 w-12 shrink-0 items-center justify-center rounded-xl', accent.iconBox)}>
            <opt.icon className="h-6 w-6" />
          </span>
          <div className="min-w-0 flex-1 pt-0.5">
            <h4 className={cn('text-[15px] font-bold leading-tight sm:text-base', accent.title)}>{opt.label}</h4>
            <p className="mt-1 text-xs leading-snug text-muted-foreground">{opt.tagline}</p>
          </div>
        </div>

        <p className="mt-3.5 text-xs leading-relaxed text-muted-foreground">{opt.desc}</p>

        <div className="my-4 border-t border-dashed border-border/70" />

        <p className={cn('mb-2 text-xs font-semibold', accent.title)}>Phù hợp với:</p>
        <ul className="space-y-1.5">
          {opt.fits.map((f) => (
            <li key={f} className="flex items-start gap-2 text-xs text-foreground/80">
              <CheckCircle2 className={cn('mt-0.5 h-3.5 w-3.5 shrink-0', accent.bullet)} />
              <span className="leading-snug">{f}</span>
            </li>
          ))}
        </ul>

        <div className="mt-auto flex items-start gap-1 pt-6">
          {opt.flow.map((s, i) => {
            const StepIcon = FLOW_STEP_ICON[s] ?? Type;
            return (
              <Fragment key={s}>
                {i > 0 && <ArrowRight className="mt-3.5 h-3 w-3 shrink-0 text-muted-foreground/40" />}
                <div className="flex min-w-0 flex-1 flex-col items-center gap-1.5 text-center">
                  <span className="flex h-9 w-9 items-center justify-center rounded-lg border border-border bg-background/60 text-muted-foreground">
                    <StepIcon className="h-4 w-4" />
                  </span>
                  <span className="text-[10px] leading-tight text-muted-foreground">{s}</span>
                </div>
              </Fragment>
            );
          })}
        </div>
      </button>
    );
  };

  return (
    <ModalOverlay onClose={onClose}>
      <div
        className={cn(
          'relative z-10 max-h-[90vh] w-full overflow-y-auto rounded-2xl border shadow-2xl transition-[max-width]',
          showSourceStep
            ? 'max-w-6xl border-violet-500/20 bg-[#0b0d18]'
            : 'max-w-lg border-border bg-card',
        )}
        role="dialog"
        aria-modal
        aria-label={isEdit ? 'Sửa video' : showSourceStep ? 'Chọn cách tạo video' : 'Tạo video mới'}
      >
        {showSourceStep && (
          <div aria-hidden className="pointer-events-none absolute inset-0 overflow-hidden">
            <div className="absolute -right-24 -top-28 h-72 w-72 rounded-full bg-primary/20 blur-3xl" />
            <div className="absolute -left-20 top-24 h-56 w-56 rounded-full bg-sky-500/10 blur-3xl" />
          </div>
        )}

        <div
          className={cn(
            'sticky top-0 z-20 flex items-start justify-between gap-4 border-b backdrop-blur-sm',
            showSourceStep
              ? 'border-white/5 bg-[#0b0d18]/90 px-6 py-5'
              : 'border-border bg-card/95 px-5 py-4',
          )}
        >
          {showSourceStep ? (
            <div className="flex items-center gap-3">
              <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-primary/15 text-primary ring-1 ring-inset ring-primary/25">
                <Sparkles className="h-5 w-5" />
              </span>
              <div>
                <h3 className="text-xl font-bold text-foreground sm:text-2xl">Chọn cách tạo video</h3>
                <p className="mt-0.5 text-xs text-muted-foreground sm:text-sm">
                  Chọn cách phù hợp để bắt đầu tạo video với Veo
                </p>
              </div>
            </div>
          ) : (
            <div className="flex items-center gap-2">
              {isEdit ? <Pencil className="h-4 w-4 text-orange-500" /> : <Plus className="h-4 w-4 text-orange-500" />}
              <h3 className="text-sm font-bold text-foreground">{isEdit ? 'Sửa video' : 'Tạo video mới'}</h3>
            </div>
          )}
          <Button variant="ghost" size="icon" onClick={onClose} aria-label="Đóng" className="-mr-1 shrink-0 p-1">
            <X className="h-5 w-5" />
          </Button>
        </div>

        {showSourceStep ? (
          <div className="relative space-y-4 px-6 py-5">
            <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
              {SOURCE_OPTIONS.map(renderSourceCard)}
            </div>
            {otherErrors.contentInputType && <FieldError>{otherErrors.contentInputType}</FieldError>}
            <div className="flex items-center justify-center gap-2 rounded-lg border border-border bg-card/40 px-4 py-2.5 text-center">
              <Info className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
              <p className="text-[11px] text-muted-foreground">
                Bạn có thể đổi cách tạo bất cứ lúc nào trước khi phân tích.
              </p>
            </div>
          </div>
        ) : (
          <div className="space-y-4 px-5 py-4">
            {!isEdit && selectedSource && (
              <div className="flex items-center justify-between gap-3 rounded-lg border border-primary/30 bg-primary/5 px-3 py-2.5">
                <div className="flex min-w-0 items-center gap-2.5">
                  <selectedSource.icon className="h-4 w-4 shrink-0 text-primary" />
                  <div className="min-w-0">
                    <span className="block truncate text-xs font-semibold text-foreground">{selectedSource.label}</span>
                    <span className="block truncate text-[10px] text-muted-foreground">{selectedSource.tagline}</span>
                  </div>
                </div>
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  onClick={() => setStep('source')}
                  className="h-auto shrink-0 p-0 text-primary hover:bg-transparent hover:text-primary hover:underline"
                >
                  Đổi cách tạo
                </Button>
              </div>
            )}

            {!isEdit && (
              <p className="text-xs text-muted-foreground">
                Mỗi video chạy prompt và cài đặt riêng — có thể tạo nhiều video song song (vd: chiến tranh / hoạt hình).
              </p>
            )}

            <div className="space-y-1.5">
              <div className="flex items-center justify-between">
                <label htmlFor="video-title-input" className="field-label">
                  Tên video <span className="text-destructive">*</span>
                </label>
                <span className={cn(
                  'text-[10px] tabular-nums',
                  titleValue.length > VIDEO_TITLE_MAX ? 'text-destructive' : 'text-muted-foreground',
                )}>
                  {titleValue.length}/{VIDEO_TITLE_MAX}
                </span>
              </div>
              <input
                id="video-title-input"
                type="text"
                placeholder={formatVideoItemTitle()}
                aria-invalid={!!titleErrors.title}
                aria-describedby={titleErrors.title ? titleErrorId : undefined}
                className={cn(selectClass, titleErrors.title && 'border-destructive')}
                {...register('title')}
              />
              {titleErrors.title && <FieldError id={titleErrorId}>{titleErrors.title.message}</FieldError>}
            </div>

            {isEdit && (
              <div className="space-y-1.5">
                <label className="field-label">
                  Nội dung / Prompt
                </label>
                <textarea
                  value={content}
                  onChange={(e) => { setContent(e.target.value); setOtherErrors((p) => ({ ...p, content: undefined })); }}
                  placeholder="Nội dung để AI tạo video..."
                  rows={5}
                  aria-invalid={!!otherErrors.content}
                  aria-describedby={otherErrors.content ? 'video-content-error' : undefined}
                  className={cn(
                    'w-full resize-y min-h-27.5 px-3 py-2 text-sm rounded-lg border bg-background text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-1',
                    otherErrors.content ? 'border-destructive/60 focus:ring-destructive/30' : 'border-border focus:ring-primary/30',
                  )}
                />
                {otherErrors.content ? (
                  <FieldError id="video-content-error">{otherErrors.content}</FieldError>
                ) : (
                  <p className="text-[10px] text-muted-foreground leading-relaxed">
                    Chỉ hỗ trợ sửa nội dung dạng text. Muốn đổi từ link/ảnh/file, hãy vào lại workspace chính.
                  </p>
                )}
              </div>
            )}

            <div className="grid grid-cols-2 gap-3">
              <Field label="Nhà cung cấp">
                <select
                  value={settings.videoProvider}
                  onChange={(e) => patch({ videoProvider: e.target.value as VideoProvider })}
                  className={selectClass}
                >
                  {getVideoProviderOptions(hasVeoGeminiKey).map(([v, l]) => <option key={v} value={v}>{l}</option>)}
                </select>
              </Field>
              <Field label="Ngôn ngữ">
                <select value={settings.language} onChange={(e) => patch({ language: e.target.value })} className={selectClass}>
                  {LANGUAGE_OPTIONS.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
                </select>
              </Field>
              <Field label="Số cảnh">
                <select value={settings.sceneCount} onChange={(e) => patch({ sceneCount: e.target.value })} className={selectClass}>
                  {SCENE_COUNT_OPTIONS.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
                </select>
              </Field>
              <Field label="Tỷ lệ">
                <select value={settings.aspectRatio} onChange={(e) => patch({ aspectRatio: e.target.value })} className={selectClass}>
                  {ASPECT_RATIO_OPTIONS.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
                </select>
              </Field>
              <Field label="Chất lượng">
                <select value={settings.videoQuality} onChange={(e) => patch({ videoQuality: e.target.value })} className={selectClass}>
                  {VIDEO_QUALITY_OPTIONS.map(([v, l]) => (
                    <option key={v} value={v}>{l}</option>
                  ))}
                </select>
              </Field>
              <Field label="Thời lượng cảnh">
                <select
                  value={settings.sceneDuration}
                  onChange={(e) => patch({ sceneDuration: e.target.value })}
                  disabled={sceneDurationOptions.length <= 1}
                  className={selectClass}
                  title={sceneDurationOptions.length <= 1 ? '1080p (Veo3.1 Gemini) bắt buộc 8 giây/cảnh' : undefined}
                >
                  {sceneDurationOptions.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
                </select>
              </Field>
              {isVeoFamilyProvider(settings.videoProvider) && hasVeoKey && (
                <Field label="Model Veo" className="col-span-2">
                  <SelectVeo
                    showLabel={false}
                    value={settings.veoModel}
                    onChange={(veoModel) => patch({ veoModel })}
                    options={veoModels}
                    loading={veoModelsLoading}
                    selectClassName={selectClass}
                  />
                </Field>
              )}
              <Field label="Giọng đọc" className="col-span-2">
                <VoiceSelect
                  value={settings.voice}
                  onChange={(voice) => patch({ voice })}
                  language={settings.language}
                  voiceSpeed={settings.voiceSpeed}
                />
              </Field>
            </div>

            {otherErrors.submit && <FieldError>{otherErrors.submit}</FieldError>}
          </div>
        )}

        <div
          className={cn(
            'sticky bottom-0 z-20 flex items-center justify-end gap-2 border-t px-5 py-4 backdrop-blur-sm',
            showSourceStep ? 'border-white/5 bg-[#0b0d18]/90 px-6' : 'border-border bg-card/95',
          )}
        >
          {showSourceStep ? (
            <>
              <p className="mr-auto hidden self-center text-[11px] text-muted-foreground sm:block">
                Chọn một cách tạo để tiếp tục thiết lập thông tin video.
              </p>
              <Button variant="ghost" size="md" onClick={onClose} className="rounded-xl">
                Hủy
              </Button>
            </>
          ) : isEdit ? (
            <>
              <Button variant="ghost" size="md" onClick={onClose} className="rounded-xl">
                Hủy
              </Button>
              <Button
                variant="outline"
                size="md"
                onClick={onSubmitSaveOnly}
                disabled={isSubmitting}
                className={cn(
                  'rounded-xl',
                  saved && 'bg-green-500/10 border-green-500/30 text-green-400 hover:border-green-500/30 hover:text-green-400',
                )}
              >
                {saved ? 'Đã lưu!' : 'Lưu'}
              </Button>
              <Button
                variant="primary"
                size="lg"
                onClick={onSubmitSaveAndRegenerate}
                disabled={busy || !contentChanged}
                loading={isSubmitting}
                title={busy ? 'Video đang xử lý...' : !contentChanged ? 'Chưa có thay đổi nội dung/cài đặt' : undefined}
                className="rounded-xl"
              >
                Lưu &amp; tạo lại
              </Button>
            </>
          ) : (
            <>
              <Button
                variant="ghost"
                size="md"
                onClick={() => setStep('source')}
                className="mr-auto rounded-xl"
              >
                <ArrowLeft className="h-4 w-4" />
                Quay lại
              </Button>
              <Button variant="ghost" size="md" onClick={onClose} className="rounded-xl">
                Hủy
              </Button>
              <Button variant="primary" size="lg" onClick={onSubmitCreate} loading={isSubmitting} className="rounded-xl">
                Tạo &amp; bắt đầu
              </Button>
            </>
          )}
        </div>
      </div>
    </ModalOverlay>
  );
}

function Field({
  label,
  children,
  className,
}: {
  label: string;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <div className={className}>
      <label className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wider block mb-1">
        {label}
      </label>
      {children}
    </div>
  );
}
