'use client';

import {
  useState, useCallback, useRef, useEffect, useImperativeHandle, forwardRef,
  type Dispatch, type SetStateAction,
} from 'react';
import {
  ImageIcon, AlertCircle, Loader2, CheckCircle2, Pencil, RefreshCw, Film, Volume2, Save, X, Play, Download, Clock,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { FieldError } from '@/components/ui/field-error';
import { ModalOverlay } from '@/components/ui/modal-overlay';
import { ConfirmDialog } from '@/components/ui/confirm-dialog';
import { Button } from '@/components/ui/button';
import type { VideoScene } from '@/lib/scene/scenes';
import { formatSceneTimeRange, recalculateSceneTimings } from '@/lib/scene/scenes';
import { captureSceneThumbnail } from '@/lib/scene/scene-thumbnail';
import { regenerateSceneAssets } from '@/lib/scene/scene-tts';
import type { TtsInput, VeoInput } from '@/lib/pipeline-payload';
import { toUserMessage } from '@/lib/error-messages';
import { useAppToast } from '@/components/ui/toast';
import type { VideoLibraryItem } from '@/lib/video-library/video-library';
import { markSceneStopped } from '@/lib/veo/veo-generation-lock';
import { downloadBlob } from '@/lib/video-library/video-composer';
import { insertVeoTaskRecord } from '@/lib/video-library/video-library-remote';
import { reportUserError } from '@/lib/user-errors/report-user-error';
import { persistSceneAssetsToCloud } from '@/lib/video-library/video-library-storage';
import { notifyCreditChanged, useUserCredit } from '@/hooks/use-user-credit';
import { useEstimatedVideoCost } from '@/hooks/use-estimated-video-cost';
import { useAuth } from '@/contexts/auth-context';
import { createClient } from '@/lib/supabase/client';
import { SceneToolbar } from './scene-toolbar';
import { type SceneToolbarState } from './scene-quick-actions';

// ─── Thumbnail từ giữa clip (tránh frame 0 = Master Cast I2V) ─────────────────

function SceneVideoThumbnail({ videoUrl }: { videoUrl: string }) {
  const [thumbUrl, setThumbUrl] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    let created: string | null = null;
    setThumbUrl(null);

    void captureSceneThumbnail(videoUrl)
      .then((url) => {
        if (cancelled) {
          URL.revokeObjectURL(url);
          return;
        }
        created = url;
        setThumbUrl(url);
      })
      .catch(() => {
        /* fallback video bên dưới */
      });

    return () => {
      cancelled = true;
      if (created) URL.revokeObjectURL(created);
    };
  }, [videoUrl]);

  if (thumbUrl) {
    return (
      // eslint-disable-next-line @next/next/no-img-element
      <img
        src={thumbUrl}
        alt=""
        className="absolute inset-0 w-full h-full object-cover object-center pointer-events-none"
      />
    );
  }

  // Tạm: #t=… để trình duyệt ưu tiên khung giữa, không flash ảnh Master Cast
  return (
    <video
      src={`${videoUrl}#t=1.5`}
      className="absolute inset-0 w-full h-full object-cover object-center pointer-events-none"
      muted
      playsInline
      preload="metadata"
    />
  );
}

// ─── Preview Modal — xem trọn video 1 cảnh, không cần qua Timeline (mục 4) ───

function ScenePreviewModal({ scene, onClose }: { scene: VideoScene; onClose: () => void }) {
  if (!scene.videoUrl) return null;

  return (
    <ModalOverlay onClose={onClose}>
      <div
        className="relative z-10 w-full max-w-2xl bg-card border border-border rounded-2xl flex flex-col shadow-2xl overflow-hidden"
        role="dialog"
        aria-modal
        aria-label={`Xem video cảnh ${scene.index}`}
      >
        <div className="flex items-center justify-between px-5 py-4 border-b border-border">
          <div className="flex items-center gap-2 min-w-0">
            <Film className="w-4 h-4 text-primary shrink-0" />
            <h3 className="font-bold text-foreground truncate">
              Cảnh {scene.index} · {formatSceneTimeRange(scene)} · {scene.durationSeconds}s
            </h3>
          </div>
          <Button
            type="button"
            variant="icon-ghost"
            size="icon"
            onClick={onClose}
            className="p-1.5 shrink-0"
            aria-label="Đóng"
          >
            <X className="w-4 h-4" />
          </Button>
        </div>

        <video
          key={scene.id}
          src={scene.videoUrl}
          controls
          autoPlay
          className="w-full aspect-video bg-black"
        />
      </div>
    </ModalOverlay>
  );
}

// ─── Edit Modal ───────────────────────────────────────────────────────────────

interface SceneEditModalProps {
  scene: VideoScene;
  onClose: () => void;
  onConfirm: (updated: Pick<VideoScene, 'prompt' | 'voice'>) => void;
  isRegenerating: boolean;
}

function SceneEditModal({ scene, onClose, onConfirm, isRegenerating }: SceneEditModalProps) {
  const [prompt, setPrompt] = useState(scene.prompt);
  const [voice, setVoice] = useState(scene.voice);
  const [errors, setErrors] = useState<{ prompt?: string; voice?: string }>({});

  const handleConfirm = () => {
    const errs: typeof errors = {};
    if (!prompt.trim()) errs.prompt = 'Video prompt không được để trống.';
    if (!voice.trim()) errs.voice = 'Lời thoại TTS không được để trống.';
    if (Object.keys(errs).length > 0) { setErrors(errs); return; }
    onConfirm({ prompt: prompt.trim(), voice: voice.trim() });
  };

  const isDirty = prompt.trim() !== scene.prompt || voice.trim() !== scene.voice;

  return (
    <ModalOverlay onClose={onClose}>
      <div
        className="relative z-10 w-full max-w-4xl max-h-[min(90vh,900px)] bg-card border border-border rounded-2xl flex flex-col shadow-2xl"
        role="dialog"
        aria-modal
        aria-label={`Chỉnh sửa cảnh ${scene.index}`}
      >
        <div className="flex items-center justify-between px-5 py-4 border-b border-border shrink-0">
          <div className="flex items-center gap-2">
            <Pencil className="w-4 h-4 text-primary" />
            <h3 className="text-sm font-bold text-foreground">Cảnh {scene.index} — Chỉnh sửa</h3>
            {isDirty && (
              <span className="text-[10px] font-medium text-orange-400 bg-orange-500/10 border border-orange-500/20 px-1.5 py-0.5 rounded">
                Chưa lưu
              </span>
            )}
          </div>
          <Button
            type="button"
            variant="icon-ghost"
            size="icon"
            onClick={onClose}
            aria-label="Đóng"
          >
            <X className="w-4 h-4" />
          </Button>
        </div>

        <div className="px-5 py-4 space-y-4 overflow-y-auto min-h-0 flex-1">
          <div className="space-y-1.5">
            <label className="field-label">
              Video Prompt <span className="text-destructive">*</span>
            </label>
            <textarea
              value={prompt}
              onChange={(e) => { setPrompt(e.target.value); setErrors((p) => ({ ...p, prompt: undefined })); }}
              rows={14}
              placeholder="Mô tả hình ảnh / chuyển động cho AI tạo video..."
              className={cn(
                'w-full min-h-[280px] px-3 py-2.5 bg-background border rounded-lg text-sm text-foreground leading-relaxed resize-y focus:outline-none focus:ring-1 transition-colors',
                errors.prompt
                  ? 'border-destructive focus:ring-destructive/25'
                  : 'border-border focus:border-primary/50 focus:ring-primary/20',
              )}
            />
            {errors.prompt && <FieldError className="items-center gap-1">{errors.prompt}</FieldError>}
          </div>

          <div className="space-y-1.5">
            <label className="field-label">
              Voice (TTS) <span className="text-destructive">*</span>
            </label>
            <textarea
              value={voice}
              onChange={(e) => { setVoice(e.target.value); setErrors((p) => ({ ...p, voice: undefined })); }}
              rows={6}
              placeholder="Lời thoại / narration cho cảnh này..."
              className={cn(
                'w-full min-h-[120px] px-3 py-2.5 bg-background border rounded-lg text-sm text-foreground leading-relaxed resize-y focus:outline-none focus:ring-1 transition-colors',
                errors.voice
                  ? 'border-destructive focus:ring-destructive/25'
                  : 'border-border focus:border-primary/50 focus:ring-primary/20',
              )}
            />
            {errors.voice && <FieldError className="items-center gap-1">{errors.voice}</FieldError>}
          </div>
        </div>

        <div className="flex items-center justify-end gap-2 px-5 py-4 border-t border-border bg-background/50 shrink-0">
          <Button
            type="button"
            variant="ghost"
            onClick={onClose}
            disabled={isRegenerating}
            className="rounded-xl bg-muted/30 hover:bg-muted/60"
          >
            Hủy
          </Button>
          <Button
            type="button"
            variant="accent"
            onClick={handleConfirm}
            disabled={isRegenerating}
            className="rounded-xl font-bold"
          >
            {isRegenerating ? (
              <><Loader2 className="w-4 h-4 animate-spin" />Đang tạo lại...</>
            ) : (
              <><CheckCircle2 className="w-4 h-4" />Lưu &amp; tạo lại TTS + video</>
            )}
          </Button>
        </div>
      </div>
    </ModalOverlay>
  );
}

// ─── Status Badge ─────────────────────────────────────────────────────────────

/** Sau phân tích kịch bản: status 'edited' nhưng chưa có video — không phải lỗi, không phải "đã sửa". */
function isSceneAwaitingFirstGeneration(scene: Pick<VideoScene, 'status' | 'videoUrl'>): boolean {
  return scene.status === 'edited' && !scene.videoUrl;
}

function StatusBadge({ scene }: { scene: Pick<VideoScene, 'status' | 'videoUrl'> }) {
  const { status } = scene;
  if (status === 'error') {
    return (
      <span className="absolute bottom-2 left-2 flex items-center gap-1 px-1.5 py-0.5 bg-destructive/90 rounded text-[10px] font-medium text-white">
        <AlertCircle className="w-3 h-3" />
        Lỗi
      </span>
    );
  }
  if (status === 'generating') {
    return (
      <span className="absolute bottom-2 left-2 flex items-center gap-1 px-1.5 py-0.5 bg-primary/90 rounded text-[10px] font-medium text-white">
        <Loader2 className="w-3 h-3 animate-spin" />
        Đang tạo...
      </span>
    );
  }
  if (status === 'edited') {
    if (isSceneAwaitingFirstGeneration(scene)) {
      return (
        <span className="absolute bottom-2 left-2 flex items-center gap-1 px-1.5 py-0.5 bg-muted-foreground/80 rounded text-[10px] font-medium text-white">
          <Clock className="w-3 h-3" />
          Chờ tạo
        </span>
      );
    }
    return (
      <span className="absolute bottom-2 left-2 flex items-center gap-1 px-1.5 py-0.5 bg-orange-500/90 rounded text-[10px] font-medium text-white">
        <Pencil className="w-3 h-3" />
        Đã sửa
      </span>
    );
  }
  return (
    <span className="absolute bottom-2 left-2 flex items-center gap-1 px-1.5 py-0.5 bg-green-600/90 rounded text-[10px] font-medium text-white">
      <CheckCircle2 className="w-3 h-3" />
      OK
    </span>
  );
}

// ─── Scene Gallery ────────────────────────────────────────────────────────────

interface SceneGalleryProps {
  scenes: VideoScene[];
  onScenesChange: Dispatch<SetStateAction<VideoScene[]>>;
  ttsInput?: TtsInput | null;
  veoInput?: VeoInput | null;
  /** Báo timeline (mục 4) focus đúng cảnh đang sửa */
  onSceneFocus?: (sceneId: string) => void;
  /** Id project đang xem — phân biệt đúng lượt "vừa sinh xong" khi user đổi project */
  projectId: string;
  projectStatus: VideoLibraryItem['status'];
  /** Upload video/audio cảnh (blob:) lên Storage — trả số lượng đã lưu/lỗi */
  onSaveVideos: () => Promise<{ saved: number; failed: number }>;
  /** Xoá file Storage của các cảnh vừa bị xoá — gọi cùng lúc với xoá khỏi state */
  onDeleteScenes: (scenes: VideoScene[]) => void;
  /** 'rows' — mỗi cảnh 1 hàng ngang (dùng cho video tạo từ tab link). Mặc định 'grid'. */
  layout?: 'grid' | 'rows';
  /** true khi đang chờ user bấm "Bắt đầu tạo video" HOẶC đang generating (tab text/image/file)
   *  — ở lại true suốt lúc generating để banner không biến mất giữa chừng, chỉ tắt khi
   *  status rời sang 'completed'/'error' (xem điều kiện truyền vào ở page.tsx). */
  awaitingGenerationConfirm?: boolean;
  onConfirmGeneration?: () => void;
  /**
   * Dựng lại ttsInput/veoInput nếu F5 làm mất (không lưu DB). Gọi trước khi tạo lại cảnh.
   */
  onEnsureGenerationInputs?: () => Promise<{ ttsInput: TtsInput; veoInput: VeoInput } | null>;
  /**
   * Báo state cho SceneQuickActions (render ở VideoSettingsBar, nhánh cây khác — xem
   * page.tsx) mỗi khi selection/regenerating/saving đổi, vì component đó không đọc trực
   * tiếp state nội bộ ở đây được.
   */
  onToolbarStateChange?: (state: SceneToolbarState) => void;
}

/** Expose ra ngoài để SceneQuickActions (render trong Header) gọi được hành động của đúng
 *  SceneGallery đang active — xem page.tsx (sceneGalleryRef). Cùng pattern CharacterMasterHandle. */
export interface SceneGalleryHandle {
  sceneAction: (action: string) => void;
  bulkAction: (action: string) => void;
}

export const SceneGallery = forwardRef<SceneGalleryHandle, SceneGalleryProps>(function SceneGallery({
  scenes,
  onScenesChange,
  ttsInput,
  veoInput,
  onSceneFocus,
  projectId,
  projectStatus,
  onSaveVideos,
  onDeleteScenes,
  layout = 'grid',
  awaitingGenerationConfirm = false,
  onConfirmGeneration,
  onEnsureGenerationInputs,
  onToolbarStateChange,
}, ref) {
  const scenesRef = useRef(scenes);
  scenesRef.current = scenes;
  // Chỉ dùng để ghi lịch sử vào bảng audit veo_task_records khi tạo lại 1 cảnh — component
  // này không nhận user/supabase qua props nên lấy trực tiếp qua hook, cùng pattern với
  // page.tsx/video-library-context.tsx.
  const { user } = useAuth();
  const supabaseRef = useRef(createClient());
  // Cảnh báo credit TRƯỚC khi gọi ElevenLabs cho "Tạo lại" — chốt thật vẫn ở veo.route.ts (mỗi
  // cảnh tự chặn lúc bắt đầu tạo video), đây chỉ tránh tốn phí ElevenLabs oan cho các cảnh
  // chắc chắn sẽ chết ở bước video vì hết credit hệ thống. unitCredit tính theo 1 cảnh — nhân
  // với số cảnh thật đang tạo lại (ids.length) ngay lúc bấm, xem regenerateScenes bên dưới.
  const userCredit = useUserCredit();
  const { unitCredit: regenerateUnitCredit } = useEstimatedVideoCost(
    veoInput?.provider ?? 'veo',
    veoInput?.veoModel,
    1,
  );
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [isRegenerating, setIsRegenerating] = useState(false);
  const [regeneratingIds, setRegeneratingIds] = useState<string[]>([]);
  const appToast = useAppToast();
  const [editTarget, setEditTarget] = useState<VideoScene | null>(null);
  const [previewTarget, setPreviewTarget] = useState<VideoScene | null>(null);
  const [isSaving, setIsSaving] = useState(false);
  const [showSaveReminder, setShowSaveReminder] = useState(false);
  // Cảnh đã tốn credit để tạo — xoá nhầm 1 click là mất vĩnh viễn, nên luôn xác nhận trước
  // (giống video-library-view.tsx) thay vì xoá ngay như trước đây.
  const [confirmDeleteIds, setConfirmDeleteIds] = useState<string[] | null>(null);

  const errorScenes = scenes.filter((s) => s.status === 'error');
  const editedScenes = scenes.filter((s) => s.status === 'edited');
  const regeneratableScenes = [
    ...errorScenes,
    ...editedScenes.filter((s) => s.videoUrl),
  ];
  const generatingCount = scenes.filter((s) => s.status === 'generating').length;
  const doneCount = scenes.filter((s) => s.status === 'success').length;
  const unsavedCount = scenes.filter(
    (s) => s.status === 'success' && s.videoUrl?.startsWith('blob:') && !s.videoPath,
  ).length;
  const allSelected = selectedIds.length === scenes.length && scenes.length > 0;

  // Trước đây tự chế state + setTimeout riêng cho component này — nay dùng chung
  // AppToastProvider (mount ở app/layout.tsx) như phần còn lại của app.
  const showToast = (msg: string) => {
    appToast.info(msg);
  };

  const toggleScene = (id: string) => {
    setSelectedIds((prev) =>
      prev.includes(id) ? prev.filter((i) => i !== id) : [...prev, id],
    );
  };

  const [downloadingIds, setDownloadingIds] = useState<string[]>([]);

  /** Tải nguyên video 1 cảnh — không cắt/ghép/xử lý gì, đúng file gốc đã tạo */
  const handleDownloadScene = async (scene: VideoScene) => {
    if (!scene.videoUrl || downloadingIds.includes(scene.id)) return;
    setDownloadingIds((prev) => [...prev, scene.id]);
    try {
      const res = await fetch(scene.videoUrl);
      const blob = await res.blob();
      downloadBlob(blob, `ai-video-studio-canh-${scene.index}.mp4`);
    } catch {
      showToast('Không tải được video cảnh này — thử lại.');
    } finally {
      setDownloadingIds((prev) => prev.filter((id) => id !== scene.id));
    }
  };

  const handleSaveVideos = useCallback(async () => {
    if (isSaving) return;
    setIsSaving(true);
    try {
      const { saved, failed } = await onSaveVideos();
      if (saved === 0 && failed === 0) {
        showToast('Không có cảnh nào cần lưu.');
      } else if (failed > 0) {
        showToast(`Đã lưu ${saved} video — ${failed} cảnh lỗi, thử lại sau.`);
      } else {
        showToast(`Đã lưu ${saved} video lên cloud.`);
        setShowSaveReminder(false);
      }
    } catch (err) {
      showToast(toUserMessage(err, 'Lưu video thất bại — thử lại.'));
    } finally {
      setIsSaving(false);
    }
  }, [isSaving, onSaveVideos]);

  /** Vừa sinh xong (đúng project đang xem) và còn cảnh chưa lưu — nhắc user lưu ngay */
  const prevCompletionRef = useRef<{ id: string; status: VideoLibraryItem['status'] }>({
    id: projectId,
    status: projectStatus,
  });
  useEffect(() => {
    const prev = prevCompletionRef.current;
    if (
      prev.id === projectId
      && prev.status !== 'completed'
      && projectStatus === 'completed'
      && unsavedCount > 0
    ) {
      setShowSaveReminder(true);
    }
    prevCompletionRef.current = { id: projectId, status: projectStatus };
  }, [projectId, projectStatus, unsavedCount]);

  /**
   * Hàng đợi "Tạo lại" — click thêm 1 cảnh khác trong lúc đang tạo lại cảnh trước đó sẽ được
   * XẾP HÀNG thay vì bị chặn (nút không còn bị disable toàn cục). Vẫn xử lý TUẦN TỰ từng
   * cảnh 1 (không chạy song song) để giữ đúng Scene Continuity (cảnh sau cần video THẬT của
   * đúng cảnh liền trước) và không gọi dồn dập API. `processingRef` (ref, không phải state)
   * đảm bảo chỉ có ĐÚNG 1 vòng lặp xử lý chạy tại 1 thời điểm dù bấm nhiều nút liên tiếp
   * trong cùng 1 tick — state React batch/async nên không dùng được để khoá tức thời.
   */
  const queueRef = useRef<Array<{ id: string; override?: Pick<VideoScene, 'prompt' | 'voice'> }>>([]);
  const processingRef = useRef(false);

  const processRegenerateQueue = useCallback(async () => {
    if (processingRef.current) return;
    processingRef.current = true;
    setIsRegenerating(true);

    let processedCount = 0;
    let firstError: string | undefined;

    try {
      let activeTts = ttsInput;
      let activeVeo = veoInput;
      if ((!activeTts || !activeVeo) && onEnsureGenerationInputs) {
        const ensured = await onEnsureGenerationInputs();
        if (ensured) {
          activeTts = ensured.ttsInput;
          activeVeo = ensured.veoInput;
        }
      }

      while (queueRef.current.length > 0) {
        const job = queueRef.current.shift()!;
        const { id, override } = job;
        const scene = scenesRef.current.find((s) => s.id === id);
        if (!scene) {
          setRegeneratingIds((prev) => prev.filter((x) => x !== id));
          continue;
        }
        if (!activeTts || !activeVeo) {
          const message = 'Chưa có cấu hình cảnh — F5 đã mất cấu hình tạm. Nếu dùng Veo Gemini, kiểm tra API key rồi thử tạo lại.';
          onScenesChange((prev) => prev.map((s) => (s.id === id ? { ...s, status: 'error' as const, errorMessage: message } : s)));
          setRegeneratingIds((prev) => prev.filter((x) => x !== id));
          firstError = firstError ?? message;
          reportUserError({
            source: 'client',
            message,
            projectId,
            sceneId: id,
          });
          continue;
        }

        onSceneFocus?.(id);
        const working: VideoScene = override ? { ...scene, ...override, errorMessage: undefined } : { ...scene, errorMessage: undefined };
        // Scene Continuity — nối tiếp bằng khung hình cuối video của đúng cảnh liền trước
        // (theo index). Vì mỗi cảnh trong hàng đợi được áp kết quả vào state NGAY sau khi
        // xong (không đợi gộp cả lượt), scenesRef.current luôn phản ánh video MỚI NHẤT của
        // cảnh liền trước nếu nó cũng vừa được tạo lại trong cùng hàng đợi này.
        const previousSceneVideoUrl = activeVeo.sceneContinuity
          ? scenesRef.current.find((s) => s.index === scene.index - 1)?.videoUrl
          : undefined;

        let finalScene: VideoScene;
        let error: string | undefined;
        try {
          const rebuilt = await regenerateSceneAssets(
            working,
            activeTts,
            activeVeo,
            {
              onOperationStarted: (operationId, videoApiKeyId) => {
                // Provider 'veo' (kie.ai) vừa trừ credit ở backend ngay khi task được tạo.
                if (activeVeo?.provider !== 'veo-gemini') notifyCreditChanged();
                onScenesChange((prev) =>
                  prev.map((s) =>
                    s.id === id
                      ? { ...s, veoTaskId: operationId, videoApiKeyId, status: 'generating' as const }
                      : s,
                  ),
                );
                // Ghi lịch sử vào bảng audit veo_task_records — fire-and-forget, lỗi (nếu
                // có) chỉ log, không chặn luồng tạo lại đang chạy.
                const supabase = supabaseRef.current;
                if (user && supabase) {
                  void insertVeoTaskRecord(supabase, {
                    userId: user.id,
                    veoTaskId: operationId,
                    provider: activeVeo.provider ?? 'veo',
                    sceneId: id,
                    projectId,
                    status: 'generating',
                    videoApiKeyId,
                  }).catch((err) => console.error('[veo_task_records] insert lỗi:', err));
                }
              },
            },
            previousSceneVideoUrl,
          );
          // regenerateSceneAssets tự bắt lỗi nội bộ (không throw): trả về status='error'
          // (cảnh chưa từng có video) HOẶC giữ nguyên status cũ kèm errorMessage (cảnh đã
          // có video thành công trước đó — giữ nguyên, không mất). Cả 2 trường hợp đều
          // cần errorMessage để hiện toast, không được xoá sạch như trước.
          finalScene = rebuilt;
          error = rebuilt.errorMessage;
          // Chỉ tự lưu Storage khi đây là kết quả MỚI thành công thật sự (không kèm
          // errorMessage rollback) — tránh persist lại nhầm video cũ vốn đã lưu từ trước.
          if (finalScene.status === 'success' && !finalScene.errorMessage && user && supabaseRef.current) {
            finalScene = await persistSceneAssetsToCloud(
              supabaseRef.current,
              user.id,
              projectId,
              finalScene,
            ).catch((err) => {
              console.error('[scene-gallery] Tự lưu video Storage thất bại:', err);
              return finalScene;
            });
          }
        } catch (err) {
          // Lưới an toàn — regenerateSceneAssets đã tự bắt lỗi nội bộ nên nhánh này hiếm
          // khi chạy, nhưng vẫn áp cùng nguyên tắc: cảnh đã có video thành công trước đó
          // (working.videoUrl) thì giữ nguyên, không tự ý xoá.
          const message = toUserMessage(err, working.videoUrl
            ? 'Tạo lại cảnh thất bại — đã giữ nguyên video cũ.'
            : 'Tạo lại cảnh thất bại — thử lại.');
          finalScene = working.videoUrl
            ? { ...working, errorMessage: message }
            : { ...working, status: 'error' as const, errorMessage: message };
          error = message;
        }

        if (error) {
          reportUserError({
            source: 'scene',
            message: error,
            projectId,
            sceneId: id,
            provider: activeVeo?.provider,
          });
        }

        onScenesChange((prev) => recalculateSceneTimings(prev.map((s) => (s.id === id ? finalScene : s))));
        setRegeneratingIds((prev) => prev.filter((x) => x !== id));
        processedCount += 1;
        firstError = firstError ?? error;
      }
    } finally {
      processingRef.current = false;
      setIsRegenerating(false);
    }

    // Cả lượt tạo lại vừa xong — nếu có cảnh lỗi, backend có thể đã hoàn credit trong lúc
    // poll (task thất bại thật sự) — tải lại số dư 1 lần nữa cho chắc.
    if (veoInput?.provider !== 'veo-gemini') notifyCreditChanged();

    if (firstError) {
      showToast(firstError);
    } else if (processedCount > 0) {
      showToast(`Đã tạo lại TTS + video cho ${processedCount} cảnh`);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [onScenesChange, ttsInput, veoInput, onEnsureGenerationInputs, onSceneFocus, projectId, user]);

  const regenerateScenes = useCallback((
    ids: string[],
    overrides?: Record<string, Pick<VideoScene, 'prompt' | 'voice'>>,
  ) => {
    if (ids.length === 0) return;

    // Cảnh báo sớm khi có thể không đủ credit cho CẢ lượt "Tạo lại" này (ids.length cảnh) —
    // KHÔNG chặn: processRegenerateQueue xử lý tuần tự từng cảnh và tự dừng đúng lúc hết
    // credit (giống scene-generation-queue.ts), nên vẫn cho chạy để những cảnh đủ credit
    // được tạo bình thường thay vì chặn hẳn cả lượt vì thiếu credit cho vài cảnh cuối.
    if ((veoInput?.provider ?? 'veo') === 'veo' && regenerateUnitCredit !== null && userCredit !== null) {
      const requiredCredit = ids.length * regenerateUnitCredit;
      if (userCredit < requiredCredit) {
        showToast(
          `Có thể không đủ credit để tạo lại cả ${ids.length} cảnh — cần ${requiredCredit} (hiện có ${userCredit}). Các cảnh không đủ credit sẽ dừng tự động.`,
        );
      }
    }

    // Cảnh đã nằm trong hàng đợi (chưa tới lượt) mà user sửa prompt/voice rồi bấm lại —
    // cập nhật override mới nhất thay vì xếp hàng trùng lặp.
    for (const id of ids) {
      const existing = queueRef.current.find((j) => j.id === id);
      if (existing && overrides?.[id]) existing.override = overrides[id];
    }

    const newIds = ids.filter((id) => !queueRef.current.some((j) => j.id === id));
    if (newIds.length === 0) return;

    queueRef.current.push(...newIds.map((id) => ({ id, override: overrides?.[id] })));
    setRegeneratingIds((prev) => [...new Set([...prev, ...newIds])]);
    onScenesChange((prev) =>
      prev.map((s) => (newIds.includes(s.id) ? { ...s, status: 'generating' as const } : s)),
    );

    void processRegenerateQueue();
  }, [onScenesChange, processRegenerateQueue, veoInput, regenerateUnitCredit, userCredit]);

  const handleSaveEdit = (id: string, data: Pick<VideoScene, 'prompt' | 'voice'>) => {
    setEditTarget(null);
    regenerateScenes([id], { [id]: data });
  };

  const handleSceneAction = (action: string) => {
    if (action === 'regen-error') {
      const targets =
        selectedIds.length > 0
          ? scenes.filter((s) =>
              selectedIds.includes(s.id) && (s.status === 'error' || s.status === 'edited'),
            ).map((s) => s.id)
          : regeneratableScenes.map((s) => s.id);

      if (targets.length === 0) {
        showToast('Không có cảnh lỗi hoặc đã sửa cần tạo lại');
        return;
      }
      regenerateScenes(targets);
      return;
    }

    if (action === 'stop') {
      const targets = scenes.filter((s) => selectedIds.includes(s.id) && s.status === 'generating');
      if (targets.length === 0) {
        showToast('Không có cảnh nào đang tạo để dừng.');
        return;
      }
      for (const s of targets) markSceneStopped(s.id);
      // "Dừng" chỉ tắt polling/theo dõi phía client (markSceneStopped) — task tạo video vẫn có
      // thể đang chạy thật ở nhà cung cấp và vẫn tính phí, KHÔNG có API huỷ task thật ở backend.
      // Message cũ ngụ ý sẽ dừng hẳn, gây hiểu lầm — sửa lại đúng bản chất thay vì hứa suông.
      showToast(`Đã dừng theo dõi ${targets.length} cảnh — video có thể vẫn được tạo ở nền và tính phí bình thường.`);
      return;
    }

    if (action === 'delete' && selectedIds.length > 0) {
      setConfirmDeleteIds([...selectedIds]);
    }
  };

  const handleBulkAction = (action: string) => {
    if (action === 'select-all') {
      setSelectedIds(scenes.map((s) => s.id));
      showToast(`Đã chọn tất cả ${scenes.length} cảnh`);
      return;
    }
    if (action === 'deselect-all') {
      setSelectedIds([]);
      return;
    }
    if (action === 'delete-bulk' && selectedIds.length > 0) {
      setConfirmDeleteIds([...selectedIds]);
    }
    if (action === 'save-videos') {
      void handleSaveVideos();
    }
  };

  const performDeleteScenes = () => {
    if (!confirmDeleteIds) return;
    const ids = confirmDeleteIds;
    const count = ids.length;
    onDeleteScenes(scenes.filter((s) => ids.includes(s.id)));
    onScenesChange((prev) => recalculateSceneTimings(prev.filter((s) => !ids.includes(s.id))));
    setSelectedIds((prev) => prev.filter((id) => !ids.includes(id)));
    setConfirmDeleteIds(null);
    showToast(`Đã xóa ${count} cảnh`);
  };

  useImperativeHandle(ref, () => ({
    sceneAction: handleSceneAction,
    bulkAction: handleBulkAction,
  }));

  // Báo state cho SceneQuickActions (render ở Header/VideoSettingsBar — nhánh cây khác,
  // không đọc trực tiếp state nội bộ ở đây được) mỗi khi các giá trị liên quan đổi.
  useEffect(() => {
    onToolbarStateChange?.({
      selectedCount: selectedIds.length,
      totalCount: scenes.length,
      errorCount: errorScenes.length,
      regeneratableCount: regeneratableScenes.length,
      allSelected,
      isRegenerating,
      unsavedCount,
      isSaving,
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedIds.length, scenes.length, errorScenes.length, regeneratableScenes.length, allSelected, isRegenerating, unsavedCount, isSaving]);

  if (scenes.length === 0) {
    return (
      <section className="space-y-4">
        <h2 className="section-label">
          3. DANH SÁCH CẢNH
        </h2>
        <div className="bg-card border border-dashed border-border rounded-2xl p-10 flex flex-col items-center text-center gap-3">
          <div className="w-14 h-14 rounded-xl bg-muted flex items-center justify-center">
            <Film className="w-7 h-7 text-muted-foreground" />
          </div>
          <div>
            <p className="text-sm font-semibold text-foreground">Chưa có cảnh video</p>
            <p className="text-xs text-muted-foreground mt-1 max-w-sm">
              Hoàn thành mục 2 — bấm <strong className="text-primary">Phân Tích &amp; Tạo Kịch Bản</strong> để AI sinh danh sách cảnh
              với số lượng tương ứng, kèm Video Prompt và Voice (TTS) cho từng cảnh.
            </p>
          </div>
        </div>
      </section>
    );
  }

  return (
    <section className="space-y-4">
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <div>
          <h2 className="section-label">
            3. DANH SÁCH CẢNH ({scenes.length})
          </h2>
          <p className="text-xs text-muted-foreground mt-1">
            {awaitingGenerationConfirm
              ? (onConfirmGeneration
                ? 'Xem lại prompt và voice từng cảnh — bấm Bắt đầu tạo video khi đã ổn'
                : 'Đang tạo giọng đọc và video — vui lòng đợi, đừng rời trang')
              : 'Sinh từ mục 2 · Sửa prompt/TTS từng cảnh · Tạo lại video sau khi chỉnh sửa'}
          </p>
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          {generatingCount > 0 && (
            <span className="flex items-center gap-1.5 text-xs text-primary bg-primary/10 border border-primary/20 px-3 py-1 rounded-full">
              <Loader2 className="w-3.5 h-3.5 animate-spin" />
              Đang tạo {doneCount}/{scenes.length} cảnh
            </span>
          )}
        </div>
      </div>

      {showSaveReminder && unsavedCount > 0 && (
        <div className="flex items-center gap-3 px-4 py-3 rounded-xl border border-green-500/30 bg-green-500/10">
          <Save className="w-4 h-4 text-green-500 shrink-0" />
          <p className="flex-1 text-xs text-foreground">
            Một số cảnh <strong>chưa lưu lên cloud</strong> — bấm Lưu ngay để thử lại (thường tự lưu sau khi tạo xong).
          </p>
          <Button
            type="button"
            variant="accent"
            size="sm"
            onClick={() => void handleSaveVideos()}
            disabled={isSaving}
            className="bg-green-600 hover:bg-green-500 shrink-0"
          >
            {isSaving ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Save className="w-3.5 h-3.5" />}
            {isSaving ? 'Đang lưu...' : 'Lưu ngay'}
          </Button>
          <Button
            type="button"
            variant="icon-ghost"
            size="icon"
            onClick={() => setShowSaveReminder(false)}
            className="shrink-0"
            aria-label="Đóng thông báo"
          >
            <X className="w-4 h-4" />
          </Button>
        </div>
      )}

      <SceneToolbar
        selectedCount={selectedIds.length}
        totalCount={scenes.length}
        errorCount={errorScenes.length}
        allSelected={allSelected}
        onBulkAction={handleBulkAction}
      />

      <div className={layout === 'rows' ? 'flex flex-col gap-3' : 'grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 gap-3'}>
        {scenes.map((scene) => {
          const isSelected = selectedIds.includes(scene.id);
          const isError = scene.status === 'error';
          const isAwaitingGeneration = isSceneAwaitingFirstGeneration(scene);
          const isEditedAfterVideo = scene.status === 'edited' && Boolean(scene.videoUrl);
          const isGenerating = scene.status === 'generating';
          const isRows = layout === 'rows';

          return (
            <div
              key={scene.id}
              role="button"
              tabIndex={0}
              onClick={() => toggleScene(scene.id)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' || e.key === ' ') {
                  e.preventDefault();
                  toggleScene(scene.id);
                }
              }}
              className={cn(
                'text-left bg-card border rounded-lg overflow-hidden transition-colors cursor-pointer select-none min-w-0',
                isRows && 'flex flex-col sm:flex-row',
                isSelected
                  ? 'border-primary ring-1 ring-primary/40'
                  : isError
                    ? 'border-destructive/50 hover:border-destructive'
                    : isEditedAfterVideo
                      ? 'border-orange-500/50 hover:border-orange-500'
                      : 'border-border hover:border-primary/50',
              )}
            >
              <div className={cn(
                'bg-muted relative overflow-hidden isolate shrink-0',
                isRows ? 'w-full sm:w-64 aspect-video' : 'w-full aspect-[4/3]',
              )}>
                {scene.videoUrl ? (
                  <>
                    <SceneVideoThumbnail videoUrl={scene.videoUrl} />
                    <div className="absolute inset-0 bg-gradient-to-t from-black/70 via-black/25 to-black/10 z-[1] pointer-events-none" />
                    <button
                      type="button"
                      onClick={(e) => {
                        e.stopPropagation();
                        setPreviewTarget(scene);
                      }}
                      className="absolute inset-0 z-[2] flex items-center justify-center group/play"
                      title="Xem video cảnh này"
                    >
                      <span className="w-11 h-11 rounded-full bg-black/50 group-hover/play:bg-primary/80 flex items-center justify-center transition-colors">
                        <Play className="w-5 h-5 text-white fill-white ml-0.5" />
                      </span>
                    </button>
                  </>
                ) : (
                  <div className="absolute inset-0 flex items-center justify-center">
                    {isGenerating ? (
                      <Loader2 className="w-10 h-10 text-primary animate-spin" />
                    ) : (
                      <ImageIcon className={cn(
                        'w-12 h-12',
                        isError ? 'text-destructive/50' : isEditedAfterVideo ? 'text-orange-400/50' : 'text-muted-foreground',
                      )} />
                    )}
                  </div>
                )}

                <div className="absolute top-2 left-2 w-6 h-6 bg-primary rounded-full flex items-center justify-center text-xs font-bold text-primary-foreground z-[2]">
                  {scene.index}
                </div>

                <div className="absolute top-2 right-2 text-xs font-semibold bg-background/80 px-2 py-1 rounded text-foreground z-[2]">
                  {formatSceneTimeRange(scene).split(' - ')[1]}
                </div>

                <StatusBadge scene={scene} />

                {isSelected && (
                  <div className="absolute bottom-2 right-2 w-5 h-5 bg-primary rounded-full flex items-center justify-center z-[2]">
                    <span className="text-primary-foreground text-xs">✓</span>
                  </div>
                )}
              </div>

              <div className={cn('p-3 space-y-2 min-w-0 overflow-hidden', isRows && 'flex-1')}>
                {isError && scene.errorMessage && (
                  <FieldError title={scene.errorMessage} className="gap-1 line-clamp-2">
                    {scene.errorMessage}
                  </FieldError>
                )}
                <div>
                  <p className="field-label mb-1">Video Prompt</p>
                  <p className={cn('text-xs text-foreground', !isRows && 'line-clamp-2')}>{scene.prompt}</p>
                </div>

                <div>
                  <p className="field-label mb-1">Voice (TTS)</p>
                  <div className="flex items-center gap-1.5">
                    <p className={cn('text-xs text-foreground flex-1', !isRows && 'line-clamp-1')}>
                      {scene.voice || '(Trống)'}
                    </p>
                    {scene.audioUrl && (
                      <Button
                        type="button"
                        variant="icon-ghost"
                        onClick={(e) => {
                          e.stopPropagation();
                          const audio = new Audio(scene.audioUrl);
                          void audio.play();
                        }}
                        className="relative shrink-0 p-1 before:absolute before:-inset-2.5 before:content-['']"
                        title="Nghe thử giọng đọc"
                      >
                        <Volume2 className="w-3.5 h-3.5" />
                      </Button>
                    )}
                  </div>
                </div>

                <div className="flex items-center justify-between pt-2 border-t border-border gap-1">
                  <span className="text-xs text-muted-foreground">{scene.durationSeconds}s</span>
                  <div className="flex items-center gap-2">
                    <Button
                      type="button"
                      variant="icon-ghost"
                      onClick={(e) => {
                        e.stopPropagation();
                        setEditTarget(scene);
                      }}
                      className="p-1.5"
                      title="Sửa prompt & TTS"
                    >
                      <Pencil className="w-3.5 h-3.5" />
                    </Button>
                    {scene.videoUrl && (
                      <Button
                        type="button"
                        variant="icon-ghost"
                        onClick={(e) => {
                          e.stopPropagation();
                          void handleDownloadScene(scene);
                        }}
                        disabled={downloadingIds.includes(scene.id)}
                        className="p-1.5"
                        title="Tải video cảnh này"
                      >
                        {downloadingIds.includes(scene.id) ? (
                          <Loader2 className="w-3.5 h-3.5 animate-spin" />
                        ) : (
                          <Download className="w-3.5 h-3.5" />
                        )}
                      </Button>
                    )}
                    {(isError || isEditedAfterVideo) && (
                      <Button
                        type="button"
                        variant="ghost"
                        onClick={(e) => {
                          e.stopPropagation();
                          regenerateScenes([scene.id]);
                        }}
                        disabled={regeneratingIds.includes(scene.id) || isGenerating}
                        className="gap-0.5 text-[10px] text-orange-400 hover:text-orange-300 hover:bg-transparent font-medium px-1"
                      >
                        <RefreshCw className={cn('w-3 h-3', regeneratingIds.includes(scene.id) && 'animate-spin')} />
                        Tạo lại
                      </Button>
                    )}
                  </div>
                </div>
              </div>
            </div>
          );
        })}
      </div>

      {/* Banner "Bắt đầu tạo video" — tĩnh, còn hiện suốt lúc generating (onConfirmGeneration
          undefined vì pendingLinkReview đã clear), chỉ ẩn khi status rời khỏi generating
          (completed/error — xem awaitingGenerationConfirm ở page.tsx). */}
      {awaitingGenerationConfirm && (
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 px-4 py-3 rounded-xl border border-primary/30 bg-primary/5">
          <p className="text-xs text-muted-foreground">
            {onConfirmGeneration ? (
              <>
                AI đã chia kịch bản thành <strong className="text-foreground">{scenes.length} cảnh</strong>.
                Kiểm tra Video Prompt và Voice ở trên — chỉnh sửa nếu cần, rồi bấm <strong className="text-primary">Bắt đầu tạo video</strong> để bắt đầu sinh giọng đọc và clip.
              </>
            ) : (
              <>Đang sinh giọng đọc và video cho <strong className="text-foreground">{scenes.length} cảnh</strong> — vui lòng đợi, đừng rời trang.</>
            )}
          </p>
          <Button
            type="button"
            variant="accent"
            size="sm"
            onClick={onConfirmGeneration}
            disabled={!onConfirmGeneration}
            className="px-4 py-2 shrink-0"
          >
            {onConfirmGeneration ? (
              <><Film className="w-3.5 h-3.5" />Bắt đầu tạo video</>
            ) : (
              <><Loader2 className="w-3.5 h-3.5 animate-spin" />Đang tạo video...</>
            )}
          </Button>
        </div>
      )}

      {editTarget && (() => {
        const live = scenes.find((s) => s.id === editTarget.id) ?? editTarget;
        return (
          <SceneEditModal
            key={live.id}
            scene={live}
            onClose={() => setEditTarget(null)}
            onConfirm={(data) => handleSaveEdit(live.id, data)}
            isRegenerating={regeneratingIds.includes(live.id)}
          />
        );
      })()}

      {previewTarget && (() => {
        const live = scenes.find((s) => s.id === previewTarget.id) ?? previewTarget;
        return <ScenePreviewModal key={live.id} scene={live} onClose={() => setPreviewTarget(null)} />;
      })()}

      <ConfirmDialog
        open={confirmDeleteIds !== null}
        title={`Xoá ${confirmDeleteIds?.length ?? 0} cảnh?`}
        message="Video/audio đã tạo cho các cảnh này sẽ bị xoá vĩnh viễn, không thể khôi phục."
        confirmLabel="Xoá cảnh"
        onCancel={() => setConfirmDeleteIds(null)}
        onConfirm={performDeleteScenes}
      />
    </section>
  );
});
