'use client';

// ─── DirectVeoInput — container Scene-centric (Phase 8) ────────────────────────────────
// Xem docs/BUILD PROMPT - tối ưu V3.md. Entity trung tâm là DirectVeoScene[] (prompt bắt
// buộc + image tuỳ chọn) — không còn Image[]/DirectVeoPromptMapping/imageIndex/parser/
// auto-mapping/Quick-Advanced Mode (Phase 6/7a/7b archived/superseded). input-section.tsx
// chỉ gọi ref.current.validateAndGetPayload() khi submit — 1 điểm submit duy nhất.
//
// Phase 9 — persist: ảnh (base64) upload lên Storage ngay khi chọn (fire-and-forget, giống
// character-master.tsx upload avatar); prompt/path đẩy lên qua onPersist mỗi khi đổi, cha
// (input-section.tsx → studio/page.tsx → updateActiveItem) tự debounce 600ms trước khi ghi
// Supabase (xem video-library-context.tsx). Khôi phục lúc mount: fetch signed URL → base64
// qua fetchUrlAsBase64() — ảnh phải sẵn sàng (base64 thật) trước khi cho submit, không phải
// "trông giống có ảnh" mà thật ra rỗng.

import { forwardRef, useEffect, useImperativeHandle, useMemo, useRef, useState } from 'react';
import { Plus, ChevronDown, Loader2 } from 'lucide-react';
import { cn } from '@/lib/utils';
import { FieldError } from '@/components/ui/field-error';
import { fetchUrlAsBase64 } from '@/lib/blob-to-base64';
import { uploadDirectVeoSceneImage } from '@/lib/video-library/direct-veo-scene-storage';
import { validateDirectVeoScenes, DIRECT_VEO_MAX_SCENES } from './direct-veo-validator';
import { appendSpokenDialogueConstraint } from '@/lib/pipeline-payload';
import { buildDirectVeoFinalPrompt, buildDirectVeoInputContent } from './direct-veo-mapper';
import type { DirectVeoScene } from './direct-veo-types';
import { readDirectVeoImage, type DirectVeoResolvedImage } from './direct-veo-image';
import { DirectVeoImageUploader } from './direct-veo-image-uploader';
import { useProjectSettings } from '@/contexts/project-settings-context';
import { resolveSceneDurationSeconds } from '@/lib/veo/veo-duration';

interface ResolvedSlot extends DirectVeoResolvedImage {
  /** File gốc — vắng mặt với ảnh khôi phục từ Storage (không còn File object, chỉ còn bytes) */
  file?: File;
  /** Path Storage bucket `source-uploads` — có khi đã upload xong (mới chọn) hoặc khôi phục từ DB */
  path?: string;
}

interface SceneState {
  id: string;
  prompt: string;
  image: ResolvedSlot | null;
}

export interface DirectVeoSubmitPayload {
  scenes: DirectVeoScene[];
  globalContext: string;
}

export interface DirectVeoInputHandle {
  /** Validate lại lần cuối, hiện lỗi nếu có. null = có lỗi (đã setState hiển thị). */
  validateAndGetPayload: () => DirectVeoSubmitPayload | null;
}

/** 1 scene đã lưu — seed khôi phục lúc mount (từ VideoLibraryItem.directVeoScenes). */
export interface DirectVeoInputInitialScene {
  id: string;
  prompt: string;
  imagePath?: string;
  imageMimeType?: string;
  /** Signed URL (bucket `source-uploads`) — fetch + convert base64 lúc mount */
  imagePreviewUrl?: string;
}

/** Shape đẩy lên cha mỗi khi scenes/globalContext đổi — cha tự map sang VideoLibraryItem. */
export interface DirectVeoScenePersistData {
  id: string;
  prompt: string;
  imagePath?: string;
  imageMimeType?: string;
}

export interface DirectVeoInputProps {
  disabled?: boolean;
  /** Dùng làm prefix path Storage khi upload ảnh scene (`{userId}/{projectId}/direct-veo/...`) */
  projectId: string;
  initialScenes?: DirectVeoInputInitialScene[];
  initialGlobalContext?: string;
  onPromptChange?: (value: string) => void;
  onSceneCountChange?: (count: number) => void;
  /** Gọi mỗi khi scenes/globalContext đổi (sau khi đã khôi phục xong) — cha tự debounce lúc ghi DB */
  onPersist?: (scenes: DirectVeoScenePersistData[], globalContext: string) => void;
}

function toDirectVeoScene(scene: SceneState): DirectVeoScene {
  return {
    id: scene.id,
    prompt: scene.prompt,
    image: scene.image ? { base64: scene.image.base64, mimeType: scene.image.mimeType } : null,
  };
}

function toPersistData(scene: SceneState): DirectVeoScenePersistData {
  return { id: scene.id, prompt: scene.prompt, imagePath: scene.image?.path, imageMimeType: scene.image?.mimeType };
}

/**
 * id duy nhất TOÀN CỤC (không chỉ trong 1 lần mount) — bắt buộc vì `pushVideoLibraryToRemote`
 * gộp `directVeoScenes` của MỌI video project vào 1 lệnh upsert() duy nhất. Đếm `scene-1,2,3`
 * riêng mỗi lần mount (bug cũ) khiến 2 video khác nhau cùng có Scene id `scene-1` → Postgres
 * lỗi "ON CONFLICT DO UPDATE command cannot affect row a second time" (2 dòng trùng khoá
 * chính trong cùng 1 lệnh). Cùng khuôn với generateVideoItemId()/VideoScene id.
 */
function mintSceneId(): string {
  return `scene-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

export const DirectVeoInput = forwardRef<DirectVeoInputHandle, DirectVeoInputProps>(
  function DirectVeoInput(
    { disabled, projectId, initialScenes, initialGlobalContext, onPromptChange, onSceneCountChange, onPersist },
    ref,
  ) {
    const { settings } = useProjectSettings();

    const [scenes, setScenes] = useState<SceneState[]>(() => {
      if (initialScenes && initialScenes.length > 0) {
        return initialScenes.map((s) => ({ id: s.id, prompt: s.prompt, image: null }));
      }
      return [{ id: mintSceneId(), prompt: '', image: null }];
    });
    const [globalContext, setGlobalContext] = useState(initialGlobalContext ?? '');
    /** true khi còn ảnh đã lưu (imagePreviewUrl) chưa fetch xong thành base64 thật — chặn
     * submit trong lúc này để không gửi nhầm base64 rỗng (xem validateAndGetPayload). */
    const [isRestoring, setIsRestoring] = useState(() => Boolean(initialScenes?.some((s) => s.imagePreviewUrl)));
    const [imageErrors, setImageErrors] = useState<Record<string, string>>({});
    const [openPreviewId, setOpenPreviewId] = useState<string | null>(null);
    const [hasSubmitted, setHasSubmitted] = useState(false);
    /** Race-guard theo scene id (ổn định qua add/remove, không như index mảng cũ) — ảnh đọc
     * xong sau khi user đã đổi/xoá ảnh khác cho cùng scene thì bị bỏ qua. */
    const slotGenerationRef = useRef<Record<string, number>>({});
    /** Luôn trỏ tới scenes mới nhất — dùng ở cleanup unmount để revoke đúng blob URL hiện có,
     * không phải mảng rỗng lúc mount (closure của effect [] không tự cập nhật theo re-render). */
    const scenesRef = useRef(scenes);
    scenesRef.current = scenes;

    const durationSeconds = resolveSceneDurationSeconds(settings.sceneDuration, '', settings.videoQuality, settings.videoProvider);

    const validationErrors = useMemo(
      () => validateDirectVeoScenes(scenes.map(toDirectVeoScene)),
      [scenes],
    );

    const isPristine = !hasSubmitted && scenes.length === 1 && scenes[0].prompt.trim() === '' && scenes[0].image === null;
    const visibleErrors = isPristine ? [] : validationErrors;
    const sceneCountError = visibleErrors.find((e) => e.field === 'scenes');

    // Khôi phục ảnh đã lưu (signed URL → base64 thật) — chỉ chạy 1 lần lúc mount. Không xoá
    // prompt nếu fetch lỗi (mất mạng, signed URL hết hạn) — scene vẫn còn, chỉ mất ảnh, user
    // tự thêm lại; KHÔNG âm thầm mất luôn cả prompt user đã soạn.
    useEffect(() => {
      if (!initialScenes?.some((s) => s.imagePreviewUrl)) return;
      let cancelled = false;

      void (async () => {
        const resolved = await Promise.all(initialScenes.map(async (s): Promise<SceneState> => {
          if (!s.imagePreviewUrl) return { id: s.id, prompt: s.prompt, image: null };
          const fetched = await fetchUrlAsBase64(s.imagePreviewUrl);
          if (!fetched) return { id: s.id, prompt: s.prompt, image: null };
          return {
            id: s.id,
            prompt: s.prompt,
            image: {
              base64: fetched.base64,
              mimeType: s.imageMimeType || fetched.mimeType,
              previewUrl: s.imagePreviewUrl,
              belowRecommendedSize: false,
              path: s.imagePath,
            },
          };
        }));
        if (!cancelled) {
          setScenes(resolved);
          setIsRestoring(false);
        }
      })();

      return () => { cancelled = true; };
      // eslint-disable-next-line react-hooks/exhaustive-deps -- chỉ chạy đúng 1 lần lúc mount với seed ban đầu
    }, []);

    useEffect(() => {
      onSceneCountChange?.(scenes.length);
    }, [scenes.length, onSceneCountChange]);

    useEffect(() => {
      onPromptChange?.(buildDirectVeoInputContent(scenes.map(toDirectVeoScene), globalContext));
      // eslint-disable-next-line react-hooks/exhaustive-deps -- onPromptChange không cần trong deps, chỉ quan tâm nội dung
    }, [scenes, globalContext]);

    useEffect(() => {
      // Chưa khôi phục xong thì đừng đẩy state tạm (ảnh rỗng) đè lên dữ liệu đã lưu.
      if (isRestoring) return;
      onPersist?.(scenes.map(toPersistData), globalContext);
      // eslint-disable-next-line react-hooks/exhaustive-deps -- onPersist không cần trong deps, chỉ quan tâm nội dung
    }, [scenes, globalContext, isRestoring]);

    useEffect(() => {
      return () => {
        scenesRef.current.forEach((s) => { if (s.image) URL.revokeObjectURL(s.image.previewUrl); });
      };
    }, []);

    const addScene = () => {
      if (scenes.length >= DIRECT_VEO_MAX_SCENES) return;
      setScenes((prev) => [...prev, { id: mintSceneId(), prompt: '', image: null }]);
    };

    const removeScene = (id: string) => {
      // Không xoá object ảnh khỏi Storage ở đây — cùng cách hành xử với video_characters/
      // avatar hiện có (xem video-library-remote.ts: stale-delete chỉ xoá row DB, không đụng
      // Storage). Dọn Storage orphan là việc riêng, ngoài scope.
      setScenes((prev) => {
        const removed = prev.find((s) => s.id === id);
        if (removed?.image) URL.revokeObjectURL(removed.image.previewUrl);
        return prev.filter((s) => s.id !== id);
      });
      setImageErrors((prev) => ({ ...prev, [id]: '' }));
    };

    const updatePrompt = (id: string, prompt: string) => {
      setScenes((prev) => prev.map((s) => (s.id === id ? { ...s, prompt } : s)));
    };

    const handleImageChange = async (id: string, file: File | null) => {
      setImageErrors((prev) => ({ ...prev, [id]: '' }));

      if (file === null) {
        setScenes((prev) => prev.map((s) => {
          if (s.id !== id) return s;
          if (s.image) URL.revokeObjectURL(s.image.previewUrl);
          return { ...s, image: null };
        }));
        return;
      }

      const generation = (slotGenerationRef.current[id] ?? 0) + 1;
      slotGenerationRef.current[id] = generation;

      const result = await readDirectVeoImage(file);
      if (slotGenerationRef.current[id] !== generation) {
        // User đã đổi/xoá ảnh khác cho scene này trước khi readDirectVeoImage xong — kết quả
        // này bị bỏ, nhưng previewUrl (blob:) đã tạo rồi thì phải revoke, không thì rò rỉ.
        if (result.ok) URL.revokeObjectURL(result.previewUrl);
        return;
      }

      if (!result.ok) {
        setImageErrors((prev) => ({ ...prev, [id]: result.message }));
        return;
      }

      setScenes((prev) => prev.map((s) => {
        if (s.id !== id) return s;
        if (s.image) URL.revokeObjectURL(s.image.previewUrl);
        return { ...s, image: { ...result, file, path: undefined } };
      }));

      // Upload Storage fire-and-forget (giống character-master.tsx upload avatar) — base64 đã
      // sẵn sàng để generate NGAY, upload chỉ để sống sót qua reload/đăng xuất. Lỗi upload
      // không chặn generate phiên hiện tại, chỉ log — patch path vào state khi xong để
      // onPersist ở effect trên tự đẩy lên cha (không cần thêm state cờ riêng).
      uploadDirectVeoSceneImage(projectId, id, result.base64, result.mimeType)
        .then(({ path }) => {
          if (slotGenerationRef.current[id] !== generation) return;
          setScenes((prev) => prev.map((s) => (s.id === id && s.image ? { ...s, image: { ...s.image, path } } : s)));
        })
        .catch((err) => {
          console.error('[direct-veo] upload ảnh scene lên Storage thất bại:', err);
        });
    };

    useImperativeHandle(ref, () => ({
      validateAndGetPayload: () => {
        setHasSubmitted(true);
        if (isRestoring || validationErrors.length > 0) return null;
        return { scenes: scenes.map(toDirectVeoScene), globalContext };
      },
    }), [scenes, globalContext, validationErrors, isRestoring]);

    return (
      <div className="space-y-4">
        {isRestoring && (
          <p className="flex items-center gap-1.5 text-xs text-muted-foreground">
            <Loader2 className="w-3.5 h-3.5 animate-spin" />
            Đang khôi phục ảnh đã lưu...
          </p>
        )}

        <div>
          <label htmlFor="direct-veo-global-context" className="block text-sm font-medium text-foreground mb-1.5">
            Thiết lập chung (tuỳ chọn)
          </label>
          <textarea
            id="direct-veo-global-context"
            value={globalContext}
            disabled={disabled}
            onChange={(e) => setGlobalContext(e.target.value)}
            placeholder="Áp dụng cho mọi cảnh — ví dụ: phong cách hình ảnh, nhân vật, ánh sáng..."
            className={cn(
              'w-full min-h-20 px-4 py-3 bg-card border border-border rounded-lg text-foreground placeholder-muted-foreground',
              'text-sm resize-y focus:outline-none transition-colors focus:border-primary/50 focus:ring-1 focus:ring-primary/20',
            )}
          />
        </div>

        <div className="space-y-3">
          {scenes.map((scene, i) => {
            const finalPrompt = appendSpokenDialogueConstraint(
              buildDirectVeoFinalPrompt(globalContext, scene.prompt),
              settings.language,
            );
            const promptError = visibleErrors.find((e) => e.field === `Scene ${i + 1}`);
            const isPreviewOpen = openPreviewId === scene.id;
            return (
              <div key={scene.id} className="rounded-lg border border-border bg-card p-3">
                <div className="flex items-center justify-between mb-2">
                  <span className="text-sm font-semibold text-foreground">Scene {i + 1}</span>
                  <button
                    type="button"
                    onClick={() => removeScene(scene.id)}
                    disabled={disabled}
                    className="text-xs text-muted-foreground hover:text-destructive disabled:pointer-events-none"
                  >
                    Xoá Scene
                  </button>
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-[160px_1fr] gap-3">
                  <DirectVeoImageUploader
                    image={scene.image}
                    onChange={(file) => handleImageChange(scene.id, file)}
                    disabled={disabled || isRestoring}
                    error={imageErrors[scene.id] || undefined}
                  />

                  <div>
                    <textarea
                      value={scene.prompt}
                      disabled={disabled}
                      onChange={(e) => updatePrompt(scene.id, e.target.value)}
                      placeholder="Prompt cho cảnh này..."
                      className={cn(
                        'w-full min-h-28 px-3 py-2 bg-background border border-border rounded-lg text-foreground placeholder-muted-foreground',
                        'font-mono text-sm resize-y focus:outline-none transition-colors focus:border-primary/50 focus:ring-1 focus:ring-primary/20',
                      )}
                    />
                    {promptError && <FieldError>{promptError.message}</FieldError>}
                  </div>
                </div>

                <button
                  type="button"
                  onClick={() => setOpenPreviewId(isPreviewOpen ? null : scene.id)}
                  className="mt-2 flex items-center gap-1 text-[11px] text-primary hover:underline"
                >
                  <ChevronDown className={cn('w-3 h-3 transition-transform', isPreviewOpen && 'rotate-180')} />
                  Xem prompt cuối cùng gửi Veo
                </button>
                {isPreviewOpen && (
                  <pre className="mt-1.5 p-2 rounded bg-muted/50 text-[11px] text-foreground whitespace-pre-wrap break-words font-mono">
                    {finalPrompt}
                  </pre>
                )}
              </div>
            );
          })}
        </div>

        {scenes.length < DIRECT_VEO_MAX_SCENES && (
          <button
            type="button"
            onClick={addScene}
            disabled={disabled}
            className="w-full flex items-center justify-center gap-1.5 px-4 py-2.5 rounded-lg border border-dashed border-border text-sm text-muted-foreground hover:border-primary/40 hover:text-primary transition-colors disabled:pointer-events-none"
          >
            <Plus className="w-4 h-4" />
            Thêm Scene
          </button>
        )}

        {!isPristine && sceneCountError && <FieldError>{sceneCountError.message}</FieldError>}

        <p className="text-xs text-muted-foreground">
          {scenes.length} cảnh · {scenes.length} video · tổng ~{scenes.length * durationSeconds} giây
        </p>
      </div>
    );
  },
);
