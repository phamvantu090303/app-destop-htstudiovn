'use client';

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type Dispatch,
  type ReactNode,
  type SetStateAction,
} from 'react';
import type { PresetInput, PresetScript, PresetTimelineDemo } from '@/lib/preset/preset-scripts';
import type { SceneGenerationResult, VideoScene } from '@/lib/scene/scenes';
import { scenesFromGeminiScript } from '@/lib/scene/scenes';
import type { VideoSettings } from '@/contexts/project-settings-context';
import { DEFAULT_VIDEO_SETTINGS } from '@/contexts/project-settings-context';
import type { AnalyzePipelineRequest, PipelineCharacter, TtsInput, VeoInput } from '@/lib/pipeline-payload';
import { parseDataUrl } from '@/lib/pipeline-payload';
import { fetchUrlAsBase64 } from '@/lib/blob-to-base64';
import { runSceneGenerationQueue, scenesNeedingVeoResume } from '@/lib/scene/scene-generation-queue';
import { notifyCreditChanged } from '@/hooks/use-user-credit';
import { normalizeSceneDurationSetting } from '@/lib/saved-scripts/saved-scripts';
import { buildDemoScenesFromPreset } from '@/lib/preset/preset-demo-builder';
import { geminiService } from '@/services/gemini/gemini.service';
import {
  countScenesDone,
  createInitialVideoItem,
  createVideoItem,
  formatVideoItemTitle,
  mergeRemoteWithLocalItems,
  resolveVeoModelLabel,
  sanitizeItemsForRemotePush,
  type CreateVideoItemOptions,
  type VideoLibraryItem,
} from '@/lib/video-library/video-library';
import { normalizeItemOnLoad } from '@/lib/video-library/video-library-persist';
import { rebuildGenerationInputs } from '@/lib/video-library/rebuild-generation-inputs';
import { toUserMessage, mapAppError, type AppError } from '@/lib/error-messages';
import { useAppToast } from '@/components/ui/toast';
import { useAuth } from '@/contexts/auth-context';
import { createClient } from '@/lib/supabase/client';
import { ensureSupabaseSession, isSupabaseAuthError } from '@/lib/supabase/ensure-session';
import { isDevFakeUser } from '@/lib/dev-mode';
import { fetchRemoteVideoLibrary, insertVeoTaskRecord, pushVideoLibraryToRemote } from '@/lib/video-library/video-library-remote';
import { reportUserError } from '@/lib/user-errors/report-user-error';
import { resolveCharacterAndMasterCastSignedUrls } from '@/lib/video-library/character-image-storage';
import { resolveDirectVeoScenesSignedUrls } from '@/lib/video-library/direct-veo-scene-storage';
import {
  resolveSceneSignedUrls,
  persistSceneAssetsToCloud,
  deleteSceneAssets,
  deleteProjectStorageAssets,
  resolveSourceUploadSignedUrls,
  uploadSourceImage as uploadSourceImageToStorage,
  deleteSourceUploads,
  getSourceUploadSignedUrl,
  uploadBgm as uploadBgmToStorage,
  deleteBgm as deleteBgmFromStorage,
  getBgmSignedUrl as getBgmSignedUrlFromStorage,
} from '@/lib/video-library/video-library-storage';
import type { SupabaseClient } from '@supabase/supabase-js';

interface AnalyzeInput {
  pipeline: AnalyzePipelineRequest;
  sourceContent: string;
  sceneCount: string;
  language: string;
  /** Tab "Từ hình ảnh" — ảnh theo đúng thứ tự cảnh, ảnh[i] gắn vào scenes[i] để gửi Veo */
  sceneImages?: Array<{ base64: string; mimeType: string } | null>;
}

/**
 * Direct Veo (veo-direct) — scenes đã dựng sẵn client-side (parser + mapper, xem
 * frontend/components/features/direct-veo/), KHÔNG qua Gemini. Xem docs/BUILD PROMPT.md §2, §10.
 */
interface DirectVeoGenerationInput {
  /** Đã gắn sourceImageBase64/sourceImageMimeType theo index (Phase 1) */
  scenes: VideoScene[];
  /** Structured Prompt gốc user nhập — lưu vào inputContent để hiển thị lại ở Mục 2 */
  rawPrompt: string;
  veoInput: VeoInput;
  /** enabled PHẢI là false — bypass ElevenLabs (xem scene-generation-queue.ts skipTts) */
  ttsInput: TtsInput;
}

type GenerationMode = 'live' | 'regenerate';

interface RunSceneGenerationOptions {
  resumeOnly?: boolean;
  mode?: GenerationMode;
}

interface VideoLibraryContextValue {
  items: VideoLibraryItem[];
  activeItemId: string;
  activeItem: VideoLibraryItem;
  /** true trong lúc đang tải/đồng bộ danh sách video từ Supabase lần đầu — dùng để vẽ skeleton */
  libraryLoading: boolean;
  /** Lỗi lần đồng bộ gần nhất (đã map sẵn tiếng Việt) — null nếu chưa từng lỗi hoặc đã đồng bộ lại thành công */
  libraryError: AppError | null;
  /** Thử đồng bộ lại danh sách video từ Supabase — dùng cho nút "Thử lại" ở error state */
  retryLibrarySync: () => void;
  createItem: (options: CreateVideoItemOptions) => string;
  selectItem: (id: string) => void;
  deleteItem: (id: string) => void;
  deleteAllItems: () => void;
  updateItem: (
    id: string,
    patch: Partial<VideoLibraryItem> | ((p: VideoLibraryItem) => Partial<VideoLibraryItem>),
  ) => void;
  renameItem: (id: string, title: string) => void;
  updateActiveItem: (patch: Partial<VideoLibraryItem>) => void;
  setActiveScenes: Dispatch<SetStateAction<VideoScene[]>>;
  setActiveTimelineFocus: (sceneId: string | null) => void;
  applyPresetToActive: (input: PresetInput, timeline: PresetTimelineDemo | null) => void;
  /** Demo mục 3 & 4 không cần API key — dùng demoScenes có sẵn + video placeholder canvas */
  applyPresetAsDemo: (preset: PresetScript) => boolean;
  syncSettingsForItem: (itemId: string, settings: VideoSettings) => void;
  startAnalyze: (itemId: string, input: AnalyzeInput) => boolean;
  /** Direct Veo (veo-direct) — scenes dựng sẵn từ Structured Prompt, bỏ qua Gemini + TTS */
  startDirectVeoGeneration: (itemId: string, input: DirectVeoGenerationInput) => boolean;
  /** Sửa nội dung/settings 1 video đã có & tạo lại cảnh — giữ cảnh cũ tới khi xong */
  startRegenerate: (itemId: string, input: AnalyzeInput) => boolean;
  /** Xác nhận sau xem trước cảnh — bắt đầu TTS/Veo (alias cũ: confirmLinkGeneration) */
  confirmSceneGeneration: (itemId: string, imageDataUrl?: string) => Promise<boolean>;
  confirmLinkGeneration: (itemId: string, imageDataUrl?: string) => Promise<boolean>;
  /** Upload video/audio cảnh (blob:) của project active lên Supabase Storage */
  saveActiveSceneVideos: () => Promise<{ saved: number; failed: number }>;
  /** Xoá file Storage của các cảnh vừa bị xoá khỏi mục 3 */
  deleteSceneStorageAssets: (scenes: VideoScene[]) => void;
  /** Upload 1 ảnh nguồn (Mục 2 — tab "Từ hình ảnh") — trả path Storage, undefined nếu chưa đăng nhập */
  uploadSourceImage: (imageId: string, file: File) => Promise<string | undefined>;
  /** Xoá 1 file nguồn khỏi Storage (user xoá/thay ảnh) */
  deleteSourceUpload: (path: string) => void;
  /** Signed URL tức thời cho path nguồn — dùng khi resubmit cần fetch lại bytes thật */
  getSourceSignedUrl: (path: string) => Promise<string | undefined>;
  /** Upload nhạc nền (Mục 4) cho project active — lưu path/tên/volume vào item, trả path Storage */
  uploadBgm: (file: File, volume: number) => Promise<string | undefined>;
  /** Xoá nhạc nền đã lưu của project active */
  deleteBgm: () => Promise<void>;
  /** Chỉ cập nhật volume BGM đã lưu (không đổi file) */
  updateBgmVolume: (volume: number) => void;
  /** Signed URL tức thời cho path BGM đã lưu — dùng lúc render (fetch lại bytes thật cho FFmpeg) */
  getBgmSignedUrl: (path: string) => Promise<string | undefined>;
  /**
   * Dựng lại ttsInput/veoInput sau F5 (không lưu DB). Trả cấu hình hiện có nếu còn trong phiên,
   * hoặc dựng từ settings. null chỉ khi veo-gemini thiếu key.
   */
  ensureGenerationInputs: (itemId: string) => Promise<{ ttsInput: TtsInput; veoInput: VeoInput } | null>;
}

const VideoLibraryContext = createContext<VideoLibraryContextValue | null>(null);

function patchItem(
  items: VideoLibraryItem[],
  id: string,
  patch: Partial<VideoLibraryItem> | ((p: VideoLibraryItem) => Partial<VideoLibraryItem>),
): VideoLibraryItem[] {
  return items.map((p) => {
    if (p.id !== id) return p;
    const delta = typeof patch === 'function' ? patch(p) : patch;
    return { ...p, ...delta, updatedAt: new Date().toISOString() };
  });
}

export function VideoLibraryProvider({ children }: { children: ReactNode }) {
  const { user, loading: authLoading } = useAuth();
  const supabaseRef = useRef(createClient());
  /** userId đã đồng bộ remote — tránh fetch lại nhiều lần cho cùng 1 tài khoản */
  const remoteSyncedForUserRef = useRef<string | null>(null);
  /** Chỉ cho phép lưu lên Supabase sau khi đã fetch/migrate xong lần đầu — tránh
   *  race ghi đè dữ liệu cloud bằng state cục bộ cũ trong lúc đang đồng bộ. */
  const [remoteReady, setRemoteReady] = useState(false);
  /** Lỗi lần fetch/đồng bộ gần nhất — null nếu chưa từng lỗi/đã retry thành công */
  const [remoteSyncError, setRemoteSyncError] = useState<AppError | null>(null);
  /** Bump để buộc effect fetch chạy lại khi user bấm "Thử lại" */
  const [syncRetryTick, setSyncRetryTick] = useState(0);
  const toast = useAppToast();

  const initial = useMemo(() => [createInitialVideoItem()], []);
  const [items, setItems] = useState<VideoLibraryItem[]>(initial);
  const [activeItemId, setActiveItemId] = useState(initial[0].id);
  const itemsRef = useRef(items);
  itemsRef.current = items;
  const activeItemIdRef = useRef(activeItemId);
  activeItemIdRef.current = activeItemId;
  /** Mỗi video có epoch riêng — tránh queue cũ ghi đè khi chạy lại (luồng live) */
  const generationEpochRef = useRef<Map<string, number>>(new Map());
  /** Chống double-click / gọi startAnalyze trùng (luồng live) */
  const analyzeInFlightRef = useRef<Set<string>>(new Set());
  /** Video đã resume poll sau refresh */
  const resumedItemsRef = useRef<Set<string>>(new Set());
  /** Epoch riêng cho luồng "Sửa & tạo lại" — tách biệt hoàn toàn khỏi luồng live */
  const regenEpochRef = useRef<Map<string, number>>(new Map());
  /** Chống gọi startRegenerate trùng */
  const regenerateInFlightRef = useRef<Set<string>>(new Set());
  /** Đánh dấu đã từng đăng nhập trong phiên này — phát hiện đúng thời điểm đăng xuất */
  const wasLoggedInRef = useRef(false);
  /** Đang có 1 lượt push lên Supabase chạy — chặn gọi chồng lấn trong cùng tab */
  const pushRunningRef = useRef(false);
  /** items đổi tiếp trong lúc push đang chạy — chạy thêm đúng 1 lượt nữa sau khi xong */
  const pushDirtyRef = useRef(false);

  // Có tài khoản đăng nhập → đồng bộ Supabase: tài khoản đã có dữ liệu thì tải về
  // (Supabase thành nguồn sự thật), tài khoản mới thì đẩy dữ liệu cục bộ hiện có lên 1 lần.
  useEffect(() => {
    if (authLoading) return;
    if (!user) {
      remoteSyncedForUserRef.current = null;
      setRemoteReady(false);
      setRemoteSyncError(null);
      if (wasLoggedInRef.current) {
        // Vừa đăng xuất — xóa sạch kho video của tài khoản cũ khỏi màn hình ngay,
        // không chờ reload. Không lo mất dữ liệu vì đã đồng bộ lên Supabase, xem
        // lại được khi đăng nhập lại đúng tài khoản đó.
        wasLoggedInRef.current = false;
        const fresh = createVideoItem({ title: formatVideoItemTitle(), settings: DEFAULT_VIDEO_SETTINGS });
        setItems([fresh]);
        setActiveItemId(fresh.id);
      }
      return;
    }
    wasLoggedInRef.current = true;
    // DEV_SKIP_AUTH: người dùng giả (không có phiên Supabase) → chỉ dùng state cục bộ trong bộ
    // nhớ, coi như "đã sẵn sàng" để thư viện không quay vòng mãi và không báo lỗi đồng bộ.
    if (isDevFakeUser(user)) {
      if (remoteSyncedForUserRef.current) {
        // Vừa đăng xuất khỏi tài khoản thật → xoá kho video của tài khoản đó khỏi màn hình.
        remoteSyncedForUserRef.current = null;
        const fresh = createVideoItem({ title: formatVideoItemTitle(), settings: DEFAULT_VIDEO_SETTINGS });
        setItems([fresh]);
        setActiveItemId(fresh.id);
      }
      setRemoteReady(true);
      return;
    }
    if (remoteSyncedForUserRef.current === user.id) return;

    const supabase = supabaseRef.current;
    if (!supabase) return;

    remoteSyncedForUserRef.current = user.id;
    setRemoteReady(false);
    setRemoteSyncError(null);

    (async () => {
      try {
        const session = await ensureSupabaseSession(supabase);
        if (!session) {
          throw Object.assign(new Error('Phiên đăng nhập Supabase chưa sẵn sàng.'), { status: 401 });
        }

        const rawItems = (await fetchRemoteVideoLibrary(supabase, user.id)).map(normalizeItemOnLoad);
        const withSceneUrls = await resolveSceneSignedUrls(supabase, rawItems);
        const withSourceUrls = await resolveSourceUploadSignedUrls(supabase, withSceneUrls);
        const withCharacterUrls = await resolveCharacterAndMasterCastSignedUrls(supabase, withSourceUrls);
        const remoteItems = await resolveDirectVeoScenesSignedUrls(supabase, withCharacterUrls);
        if (remoteItems.length > 0) {
          const merged = mergeRemoteWithLocalItems(remoteItems, itemsRef.current);
          itemsRef.current = merged;
          setItems(merged);
          setActiveItemId((prev) => (merged.some((i) => i.id === prev) ? prev : merged[0]?.id ?? prev));
        } else {
          const { items: toPush, remappedIds } = sanitizeItemsForRemotePush(itemsRef.current);
          if (remappedIds.size > 0) {
            itemsRef.current = toPush;
            setItems(toPush);
            setActiveItemId((prev) => remappedIds.get(prev) ?? prev);
          }
          await pushVideoLibraryToRemote(supabase, user.id, toPush);
        }
      } catch (err) {
        // PostgrestError không phải Error instance — console.error(err) một mình hay hiện
        // "{}" ở Next overlay (serialize kém). Log rõ field thật để debug được.
        console.error('[video-library] Đồng bộ Supabase thất bại:', err, {
          message: (err as { message?: string })?.message,
          code: (err as { code?: string })?.code,
          details: (err as { details?: string })?.details,
          hint: (err as { hint?: string })?.hint,
        });
        // Không chặn hẳn app — vẫn dùng state cục bộ (có thể cũ) — nhưng lưu lại lỗi để
        // VideoLibraryView vẽ error-state + nút "Thử lại" thay vì im lặng như trước.
        remoteSyncedForUserRef.current = null;
        setRemoteSyncError(mapAppError(err));
      } finally {
        setRemoteReady(true);
      }
    })();
  }, [user, authLoading, syncRetryTick]);

  /** Thử đồng bộ lại danh sách video từ Supabase — dùng cho nút "Thử lại" ở error state của Home page */
  const retryLibrarySync = useCallback(() => {
    remoteSyncedForUserRef.current = null;
    setRemoteSyncError(null);
    setSyncRetryTick((t) => t + 1);
  }, []);

  /**
   * Chạy pushVideoLibraryToRemote tối đa 1 lượt tại 1 thời điểm cho tab này — nếu
   * items đổi tiếp trong lúc đang push, chạy thêm đúng 1 lượt nữa ngay sau khi lượt
   * hiện tại xong (dùng itemsRef.current mới nhất) thay vì để 2 lượt chạy chồng lấn.
   */
  const runPushToRemote = useCallback((supabase: SupabaseClient, userId: string) => {
    if (pushRunningRef.current) {
      pushDirtyRef.current = true;
      return;
    }
    pushRunningRef.current = true;
    void (async () => {
      try {
        do {
          pushDirtyRef.current = false;

          const session = await ensureSupabaseSession(supabase);
          if (!session) {
            console.warn('[video-library] Bỏ qua lưu Supabase — chưa có phiên đăng nhập hợp lệ.');
            return;
          }

          const { items: safeItems, remappedIds } = sanitizeItemsForRemotePush(itemsRef.current);
          if (remappedIds.size > 0) {
            itemsRef.current = safeItems;
            setItems(safeItems);
            setActiveItemId((prev) => remappedIds.get(prev) ?? prev);
          }

          await pushVideoLibraryToRemote(supabase, userId, safeItems);
        } while (pushDirtyRef.current);
      } catch (err) {
        console.error('[video-library] Lưu Supabase thất bại:', err, {
          message: (err as { message?: string })?.message,
          code: (err as { code?: string })?.code,
          details: (err as { details?: string })?.details,
          hint: (err as { hint?: string })?.hint,
        });
        if (isSupabaseAuthError(err)) {
          toast.warning('Không lưu được video', 'Phiên đăng nhập hết hạn — tải lại trang hoặc đăng nhập lại.');
          return;
        }
        // FIXME(ported from web-video): toast.error(err, options) — the 2nd argument is
        // AppErrorToastOptions, not a description, so this message is currently ignored. Same on web.
        // @ts-expect-error pre-existing type error in the web app (hidden there by ignoreBuildErrors)
        toast.error('Không lưu được video', toUserMessage(err, 'Thử lại sau vài giây.'));
      } finally {
        pushRunningRef.current = false;
      }
    })();
  }, [toast]);

  useEffect(() => {
    const supabase = supabaseRef.current;
    // Chưa đăng nhập, chưa có Supabase client, hoặc đang đồng bộ lần đầu (remote
    // chưa sẵn sàng) → bỏ qua lượt lưu này, tránh ghi đè dữ liệu cloud bằng state
    // cũ trong lúc đang race với fetch. Không còn nhánh localStorage — Supabase
    // là nguồn dữ liệu duy nhất.
    if (!user || isDevFakeUser(user) || !remoteReady || !supabase) return;

    const timer = window.setTimeout(() => {
      runPushToRemote(supabase, user.id);
    }, 600);
    return () => window.clearTimeout(timer);
  }, [items, activeItemId, user, remoteReady, runPushToRemote]);

  const activeItem = useMemo(
    () => items.find((p) => p.id === activeItemId) ?? items[0],
    [items, activeItemId],
  );

  const updateItem = useCallback((
    id: string,
    patch: Partial<VideoLibraryItem> | ((p: VideoLibraryItem) => Partial<VideoLibraryItem>),
  ) => {
    setItems((prev) => {
      const next = patchItem(prev, id, patch);
      // Đồng bộ ref ngay — confirm/Master Cast không phụ thuộc chờ re-render
      itemsRef.current = next;
      return next;
    });
  }, []);

  const renameItem = useCallback((id: string, title: string) => {
    const trimmed = title.trim();
    if (!trimmed) return;
    updateItem(id, { title: trimmed });
  }, [updateItem]);

  const createItem = useCallback((options: CreateVideoItemOptions) => {
    const item = createVideoItem(options);
    setItems((prev) => [item, ...prev]);
    setActiveItemId(item.id);
    return item.id;
  }, []);

  const selectItem = useCallback((id: string) => {
    if (itemsRef.current.some((p) => p.id === id)) {
      setActiveItemId(id);
    }
  }, []);

  /** Xoá file Storage (scene-videos/scene-audio) của 1 hoặc nhiều project — chạy nền, không chặn UI, lỗi chỉ log */
  const cleanupProjectStorage = useCallback((projectIds: string[]) => {
    const supabase = supabaseRef.current;
    if (!supabase || !user || projectIds.length === 0) return;
    void Promise.allSettled(
      projectIds.map((projectId) => deleteProjectStorageAssets(supabase, user.id, projectId)),
    ).then((results) => {
      const failed = results.filter((r) => r.status === 'rejected');
      if (failed.length === 0) return;
      failed.forEach((r) => console.error('[video-library] Xoá file Storage của project thất bại:', (r as PromiseRejectedResult).reason));
      // Video đã xoá khỏi danh sách rồi (optimistic) — đây chỉ là dọn dẹp file nền thất bại,
      // không chặn/không ảnh hưởng thao tác vừa làm, nên dùng toast info thay vì error để
      // không khiến user hoang mang tưởng thao tác xoá chính đã thất bại.
      toast.info(
        failed.length === 1 ? 'Đã xoá video' : `Đã xoá ${projectIds.length} video`,
        'Một số file lưu trữ liên quan dọn dẹp chưa xong ở nền — không ảnh hưởng tới việc dùng app.',
      );
    });
  }, [user, toast]);

  const deleteItem = useCallback((id: string) => {
    cleanupProjectStorage([id]);
    setItems((prev) => {
      const next = prev.filter((p) => p.id !== id);
      if (next.length === 0) {
        const fresh = createVideoItem({ title: formatVideoItemTitle(), settings: DEFAULT_VIDEO_SETTINGS });
        setActiveItemId(fresh.id);
        return [fresh];
      }
      if (id === activeItemId) {
        setActiveItemId(next[0].id);
      }
      return next;
    });
  }, [activeItemId, cleanupProjectStorage]);

  const deleteAllItems = useCallback(() => {
    cleanupProjectStorage(itemsRef.current.map((p) => p.id));
    const fresh = createVideoItem({ title: formatVideoItemTitle(), settings: DEFAULT_VIDEO_SETTINGS });
    setItems([fresh]);
    setActiveItemId(fresh.id);
  }, [cleanupProjectStorage]);

  const updateActiveItem = useCallback((patch: Partial<VideoLibraryItem>) => {
    updateItem(activeItemId, patch);
  }, [activeItemId, updateItem]);

  const setActiveScenes = useCallback((updater: SetStateAction<VideoScene[]>) => {
    setItems((prev) =>
      prev.map((p) => {
        if (p.id !== activeItemId) return p;
        const scenes = typeof updater === 'function' ? updater(p.scenes) : updater;
        return {
          ...p,
          scenes,
          scenesDone: countScenesDone(scenes),
          scenesTotal: scenes.length,
          updatedAt: new Date().toISOString(),
        };
      }),
    );
  }, [activeItemId]);

  /**
   * Upload video/audio (blob: URL) của các cảnh đã sinh thành công trong project
   * đang active lên Supabase Storage — dùng khi auto-save thất bại, user bấm thử lại.
   */
  const saveActiveSceneVideos = useCallback(async (): Promise<{ saved: number; failed: number }> => {
    const supabase = supabaseRef.current;
    if (!supabase || !user) {
      throw new Error('Cần đăng nhập để lưu video lên cloud.');
    }

    const item = itemsRef.current.find((p) => p.id === activeItemIdRef.current);
    if (!item) return { saved: 0, failed: 0 };

    const targets = item.scenes.filter(
      (s) => s.status === 'success' && s.videoUrl?.startsWith('blob:') && !s.videoPath,
    );
    if (targets.length === 0) return { saved: 0, failed: 0 };

    let saved = 0;
    let failed = 0;

    for (const scene of targets) {
      try {
        const persisted = await persistSceneAssetsToCloud(supabase, user.id, item.id, scene);
        setActiveScenes((prev) =>
          prev.map((s) =>
            s.id === scene.id
              ? {
                  ...s,
                  videoPath: persisted.videoPath ?? s.videoPath,
                  audioPath: persisted.audioPath ?? s.audioPath,
                }
              : s,
          ),
        );
        if (persisted.videoPath) {
          saved++;
        } else {
          failed++;
        }
      } catch (err) {
        console.error('[video-library] Lưu video Storage thất bại:', err);
        failed++;
      }
    }

    return { saved, failed };
  }, [user, setActiveScenes]);

  /** Tự upload blob lên Storage ngay sau cảnh tạo thành công — lỗi thì giữ blob, nút Lưu thử lại */
  const persistSceneAssets = useCallback(async (projectId: string, scene: VideoScene): Promise<VideoScene> => {
    const supabase = supabaseRef.current;
    if (!supabase || !user || scene.status !== 'success') return scene;
    try {
      return await persistSceneAssetsToCloud(supabase, user.id, projectId, scene);
    } catch (err) {
      console.error('[video-library] Tự lưu video Storage thất bại:', err);
      return scene;
    }
  }, [user]);

  /** Xoá file Storage của các cảnh vừa bị xoá khỏi mục 3 — chạy nền, không chặn UI, lỗi chỉ log */
  const deleteSceneStorageAssets = useCallback((scenes: VideoScene[]) => {
    const supabase = supabaseRef.current;
    if (!supabase || !user) return;
    void deleteSceneAssets(supabase, scenes).catch((err) => {
      console.error('[video-library] Xoá file Storage của cảnh thất bại:', err);
    });
  }, [user]);

  /**
   * Upload 1 ảnh nguồn (Mục 2 — tab "Từ hình ảnh") lên Storage NGAY khi user đính kèm
   * (không đợi bấm "Phân tích") — sống sót qua điều hướng/reload. Trả `undefined` nếu
   * chưa đăng nhập (giữ hành vi ephemeral như trước, nhất quán scene-videos/scene-audio).
   */
  const uploadSourceImage = useCallback(async (imageId: string, file: File): Promise<string | undefined> => {
    const supabase = supabaseRef.current;
    if (!supabase || !user) return undefined;
    return uploadSourceImageToStorage(supabase, user.id, activeItemIdRef.current, imageId, file);
  }, [user]);

  /** Xoá 1 file nguồn khỏi Storage (user xoá/thay ảnh) — chạy nền, không chặn UI, lỗi chỉ log */
  const deleteSourceUpload = useCallback((path: string) => {
    const supabase = supabaseRef.current;
    if (!supabase || !user || !path) return;
    void deleteSourceUploads(supabase, [path]).catch((err) => {
      console.error('[video-library] Xoá file nguồn Storage thất bại:', err);
    });
  }, [user]);

  /** Signed URL tức thời cho path nguồn — dùng khi resubmit cần fetch lại bytes thật */
  const getSourceSignedUrl = useCallback(async (path: string): Promise<string | undefined> => {
    const supabase = supabaseRef.current;
    if (!supabase || !user) return undefined;
    return getSourceUploadSignedUrl(supabase, path);
  }, [user]);

  /**
   * Upload nhạc nền (Mục 4) cho project active — file mới tự ghi đè file cũ (upsert), xoá
   * file cũ khỏi Storage trước để không rò rỉ dung lượng nếu đổi định dạng (đuôi file khác).
   */
  const uploadBgm = useCallback(async (file: File, volume: number): Promise<string | undefined> => {
    const supabase = supabaseRef.current;
    if (!supabase || !user) return undefined;
    const itemId = activeItemIdRef.current;
    const prevPath = itemsRef.current.find((p) => p.id === itemId)?.bgmPath;
    const path = await uploadBgmToStorage(supabase, user.id, itemId, file);
    if (prevPath && prevPath !== path) {
      void deleteBgmFromStorage(supabase, prevPath).catch((err) => {
        console.error('[video-library] Xoá BGM cũ (đổi định dạng) thất bại:', err);
      });
    }
    updateItem(itemId, { bgmPath: path, bgmFileName: file.name, bgmVolume: volume });
    return path;
  }, [user, updateItem]);

  /** Xoá nhạc nền đã lưu của project active */
  const deleteBgm = useCallback(async (): Promise<void> => {
    const supabase = supabaseRef.current;
    const itemId = activeItemIdRef.current;
    const path = itemsRef.current.find((p) => p.id === itemId)?.bgmPath;
    if (!supabase || !user || !path) return;
    try {
      await deleteBgmFromStorage(supabase, path);
    } catch (err) {
      console.error('[video-library] Xoá nhạc nền Storage thất bại:', err);
    }
    updateItem(itemId, { bgmPath: undefined, bgmFileName: undefined, bgmVolume: undefined });
  }, [user, updateItem]);

  /** Chỉ cập nhật volume BGM đã lưu (không đổi file) — vd user kéo thanh trượt sau khi đã lưu */
  const updateBgmVolume = useCallback((volume: number) => {
    updateItem(activeItemIdRef.current, { bgmVolume: volume });
  }, [updateItem]);

  /** Signed URL tức thời cho path BGM đã lưu — dùng lúc render (fetch lại bytes thật cho FFmpeg) */
  const getBgmSignedUrl = useCallback(async (path: string): Promise<string | undefined> => {
    const supabase = supabaseRef.current;
    if (!supabase || !user) return undefined;
    return getBgmSignedUrlFromStorage(supabase, path);
  }, [user]);

  const setActiveTimelineFocus = useCallback((sceneId: string | null) => {
    updateItem(activeItemId, { timelineFocusSceneId: sceneId });
  }, [activeItemId, updateItem]);

  const applyPresetToActive = useCallback((input: PresetInput, timeline: PresetTimelineDemo | null) => {
    updateItem(activeItemId, (p) => ({
      appliedInput: input,
      inputContent: input.content,
      settings: {
        ...p.settings,
        language: input.language,
        sceneCount: input.sceneCount,
        voice: input.voice,
        aspectRatio: input.aspectRatio ?? '16:9',
        sceneDuration: normalizeSceneDurationSetting(
          input.sceneDuration ?? '6',
          input.videoQuality ?? '720p',
          p.settings.videoProvider,
        ),
        videoQuality: input.videoQuality ?? '720p',
        veoModel: input.veoModel ?? '',
        voiceSpeed: input.voiceSpeed ?? p.settings.voiceSpeed,
        sceneStyle: input.sceneStyleId ?? p.settings.sceneStyle,
      },
      aspectRatio: input.aspectRatio ?? '16:9',
      pendingTimelineDemo: timeline,
      timelineDemo: null,
      scenes: [],
      ttsInput: null,
      veoInput: null,
      scenesDone: 0,
      scenesTotal: 0,
      status: 'draft' as const,
    }));
  }, [activeItemId, updateItem]);

  const syncSettingsForItem = useCallback((itemId: string, settings: VideoSettings) => {
    const item = itemsRef.current.find((p) => p.id === itemId);
    updateItem(itemId, {
      settings,
      aspectRatio: settings.aspectRatio,
      veoModelLabel: resolveVeoModelLabel(item?.veoInput ?? null, settings),
    });
  }, [updateItem]);

  const runSceneGeneration = useCallback((
    itemId: string,
    result: SceneGenerationResult,
    epoch: number,
    options?: RunSceneGenerationOptions,
  ) => {
    const mode: GenerationMode = options?.mode ?? 'live';
    const epochRef = mode === 'regenerate' ? regenEpochRef : generationEpochRef;
    const inFlightRef = mode === 'regenerate' ? regenerateInFlightRef : analyzeInFlightRef;

    const existing = itemsRef.current.find((p) => p.id === itemId);
    const pendingScenes = options?.resumeOnly && existing
      ? existing.scenes
      : result.scenes.map((s) => ({ ...s, status: 'generating' as const }));

    if (process.env.NODE_ENV !== 'production') console.log(`[video-library] runSceneGeneration cho ${itemId} — mode=${mode}, resumeOnly=${options?.resumeOnly}, pendingScenes:`, pendingScenes.map((s) => ({ id: s.id, status: s.status, hasVideoUrl: Boolean(s.videoUrl) })));

    if (mode === 'live') {
      if (!options?.resumeOnly) {
        updateItem(itemId, {
          status: 'generating',
          errorMessage: undefined,
          inputContent: result.sourceContent,
          inputType: result.inputType,
          masterCastPrompt: result.masterCastPrompt,
          ttsInput: result.ttsInput,
          veoInput: result.veoInput,
          scenes: pendingScenes,
          scenesDone: countScenesDone(pendingScenes),
          scenesTotal: pendingScenes.length,
          veoModelLabel: resolveVeoModelLabel(result.veoInput, {
            ...DEFAULT_VIDEO_SETTINGS,
            aspectRatio: result.veoInput.aspectRatio,
            videoQuality: result.veoInput.videoQuality ?? '720p',
            veoModel: result.veoInput.veoModel ?? '',
          }),
          aspectRatio: result.veoInput.aspectRatio,
        });
      } else {
        updateItem(itemId, { status: 'generating', errorMessage: undefined });
      }
    } else {
      // Tạo lại — ghi vào pendingRegeneration, KHÔNG đụng scenes/status sống
      updateItem(itemId, (p) => ({
        pendingRegeneration: {
          status: 'generating',
          errorMessage: undefined,
          scenes: pendingScenes,
          scenesDone: countScenesDone(pendingScenes),
          scenesTotal: pendingScenes.length,
          ttsInput: result.ttsInput,
          veoInput: result.veoInput,
          inputContent: result.sourceContent,
          timelineDemo: p.pendingRegeneration?.timelineDemo ?? null,
        },
      }));
    }

    const ttsInput = result.ttsInput ?? existing?.ttsInput;
    const veoInput = result.veoInput ?? existing?.veoInput;
    if (!ttsInput || !veoInput) return;

    void runSceneGenerationQueue(
      pendingScenes,
      ttsInput,
      veoInput,
      {
        shouldContinue: () => epochRef.current.get(itemId) === epoch,
        onFatalError: (message) => {
          if (epochRef.current.get(itemId) !== epoch) return;
          if (mode === 'live') {
            updateItem(itemId, { status: 'error', errorMessage: message });
          } else {
            updateItem(itemId, (p) => ({
              pendingRegeneration: p.pendingRegeneration
                ? { ...p.pendingRegeneration, errorMessage: message }
                : null,
            }));
          }
        },
        onScenesUpdate: (scenes) => {
          if (epochRef.current.get(itemId) !== epoch) return;
          if (mode === 'live') {
            updateItem(itemId, {
              scenes,
              scenesDone: countScenesDone(scenes),
              scenesTotal: scenes.length,
              status: 'generating',
            });
          } else {
            updateItem(itemId, (p) => ({
              pendingRegeneration: p.pendingRegeneration
                ? {
                    ...p.pendingRegeneration,
                    scenes,
                    scenesDone: countScenesDone(scenes),
                    scenesTotal: scenes.length,
                  }
                : null,
            }));
          }
        },
        // Ghi lịch sử vào bảng audit veo_task_records — fire-and-forget, lỗi (nếu có)
        // chỉ log, không chặn/làm fail luồng generate đang chạy.
        onTaskStarted: (sceneId, taskId, videoApiKeyId) => {
          const supabase = supabaseRef.current;
          // Provider 'veo' (kie.ai) vừa trừ credit ở backend ngay khi task được tạo (reserve-
          // on-start) — báo cho SidebarCreditsCard/mọi nơi hiển thị số dư tự tải lại.
          if (veoInput.provider !== 'veo-gemini') notifyCreditChanged();
          if (!user || !supabase) return;
          void insertVeoTaskRecord(supabase, {
            userId: user.id,
            veoTaskId: taskId,
            provider: veoInput.provider ?? 'veo',
            sceneId,
            projectId: itemId,
            status: 'generating',
            videoApiKeyId,
          }).catch((err) => console.error('[veo_task_records] insert lỗi:', err));
        },
        onPersistSceneAssets: (scene) => persistSceneAssets(itemId, scene),
        onSceneFailed: ({ sceneId, message, rawMessage }) => {
          reportUserError({
            source: 'scene',
            message,
            rawMessage,
            projectId: itemId,
            sceneId,
            provider: veoInput.provider,
          });
        },
      },
      { resumeOnly: options?.resumeOnly },
    ).then((finalScenes) => {
      // Cả lượt tạo vừa xong — nếu có cảnh lỗi ở provider 'veo', backend có thể đã hoàn credit
      // trong lúc poll (task thất bại thật sự) — tải lại số dư 1 lần nữa cho chắc.
      if (veoInput.provider !== 'veo-gemini') notifyCreditChanged();
      if (epochRef.current.get(itemId) !== epoch) return;
      const erroredScenes = finalScenes.filter((s) => s.status === 'error');
      const hasError = erroredScenes.length > 0;
      const summaryMessage = hasError
        ? erroredScenes.length === 1
          ? (erroredScenes[0].errorMessage ?? 'Một cảnh tạo thất bại — xem chi tiết ở danh sách cảnh.')
          : `${erroredScenes.length} cảnh tạo thất bại — xem chi tiết ở danh sách cảnh.`
        : undefined;

      if (mode === 'live') {
        setItems((prev) =>
          patchItem(prev, itemId, (p) => {
            const timelineDemo = p.pendingTimelineDemo ?? p.timelineDemo;
            return {
              scenes: finalScenes,
              scenesDone: countScenesDone(finalScenes),
              scenesTotal: finalScenes.length,
              status: hasError ? 'error' : 'completed',
              errorMessage: summaryMessage,
              timelineDemo,
              pendingTimelineDemo: null,
            };
          }),
        );
        return;
      }

      if (hasError) {
        // Tạo lại thất bại — giữ nguyên scenes/status sống, chỉ báo lỗi riêng
        setItems((prev) =>
          patchItem(prev, itemId, {
            isRegenerating: false,
            pendingRegeneration: null,
            regenerateError: summaryMessage,
          }),
        );
      } else {
        // Tạo lại thành công — swap vào field sống
        setItems((prev) =>
          patchItem(prev, itemId, (p) => ({
            scenes: finalScenes,
            scenesDone: countScenesDone(finalScenes),
            scenesTotal: finalScenes.length,
            ttsInput: p.pendingRegeneration?.ttsInput ?? p.ttsInput,
            veoInput: p.pendingRegeneration?.veoInput ?? p.veoInput,
            inputContent: p.pendingRegeneration?.inputContent ?? p.inputContent,
            status: 'completed',
            errorMessage: undefined,
            isRegenerating: false,
            pendingRegeneration: null,
            regenerateError: undefined,
          })),
        );
      }
    }).finally(() => {
      inFlightRef.current.delete(itemId);
    });
  }, [updateItem, user, persistSceneAssets]);

  /**
   * Demo mục 3 & 4 không cần API key — bỏ qua bước gọi Gemini, dùng thẳng
   * demoScenes có sẵn trong preset rồi chạy qua đúng hàng đợi sinh cảnh thật
   * (runSceneGeneration). Vì ttsInput/veoInput không có apiKey, hàng đợi tự
   * động bỏ qua TTS và dùng video placeholder canvas — cùng UI/logic y hệt
   * luồng tạo video thật.
   */
  const applyPresetAsDemo = useCallback((preset: PresetScript): boolean => {
    const itemId = activeItemId;
    const item = itemsRef.current.find((p) => p.id === itemId);
    if (!item) return false;
    if (item.status === 'analyzing' || item.status === 'generating') return false;
    if (item.isRegenerating) return false;
    if (analyzeInFlightRef.current.has(itemId)) return false;

    analyzeInFlightRef.current.add(itemId);
    const epoch = (generationEpochRef.current.get(itemId) ?? 0) + 1;
    generationEpochRef.current.set(itemId, epoch);

    const input = preset.input;
    const veoInput: VeoInput = {
      aspectRatio: input.aspectRatio ?? '16:9',
      sceneDuration: normalizeSceneDurationSetting(input.sceneDuration ?? '6', input.videoQuality ?? '720p', item.settings.videoProvider),
      videoQuality: input.videoQuality ?? '720p',
      veoModel: input.veoModel,
      sceneStyleId: input.sceneStyleId,
    };
    const ttsInput: TtsInput = {
      voice: input.voice,
      language: input.language,
      voiceSpeed: input.voiceSpeed ?? 1,
    };

    updateItem(itemId, (p) => ({
      appliedInput: input,
      inputContent: input.content,
      settings: {
        ...p.settings,
        language: input.language,
        sceneCount: String(preset.demoScenes.length),
        voice: input.voice,
        aspectRatio: veoInput.aspectRatio,
        sceneDuration: veoInput.sceneDuration,
        videoQuality: veoInput.videoQuality ?? '720p',
        veoModel: input.veoModel ?? '',
        voiceSpeed: input.voiceSpeed ?? p.settings.voiceSpeed,
        sceneStyle: input.sceneStyleId ?? p.settings.sceneStyle,
      },
      aspectRatio: veoInput.aspectRatio,
      pendingTimelineDemo: preset.timeline,
    }));

    runSceneGeneration(itemId, {
      scenes: buildDemoScenesFromPreset(preset),
      sourceContent: input.content,
      sceneCount: String(preset.demoScenes.length),
      language: input.language,
      aspectRatio: veoInput.aspectRatio,
      sceneDuration: veoInput.sceneDuration,
      veoInput,
      ttsInput,
    }, epoch);

    return true;
  }, [activeItemId, updateItem, runSceneGeneration]);

  /**
   * Direct Veo — nguồn VideoScene[] thứ 2 của hệ thống (song song với Gemini).
   * KHÔNG gọi /api/gemini/analyze, KHÔNG scenesFromGeminiScript(), KHÔNG ElevenLabs
   * (ttsInput.enabled=false → scene-generation-queue.ts skipTts). Xem docs/BUILD PROMPT.md §2, §10.
   * Đi thẳng parse → validate → build → queue (không có bước "xem trước" như startAnalyze —
   * preview đã nằm ở DirectVeoScenePreview TRƯỚC khi submit, xem Phase 3).
   */
  const startDirectVeoGeneration = useCallback(
    (itemId: string, input: DirectVeoGenerationInput): boolean => {
      const item = itemsRef.current.find((p) => p.id === itemId);
      if (!item) return false;
      if (item.status === 'analyzing' || item.status === 'generating') return false;
      if (item.isRegenerating) return false;
      if (analyzeInFlightRef.current.has(itemId)) return false;
      if (input.scenes.length === 0) return false;
      // §10 "bắt buộc ttsInput.enabled=false" — chặn cứng ở đây (không chỉ tin caller qua
      // type), vì đây là gateway DUY NHẤT của luồng Direct Veo tới runSceneGeneration/
      // ElevenLabs. Nếu Phase 4 lỡ quên set false, chặn sớm thay vì âm thầm gọi ElevenLabs.
      if (input.ttsInput.enabled !== false) return false;

      analyzeInFlightRef.current.add(itemId);
      const epoch = (generationEpochRef.current.get(itemId) ?? 0) + 1;
      generationEpochRef.current.set(itemId, epoch);

      updateItem(itemId, (p) => ({
        inputContent: input.rawPrompt,
        settings: {
          ...p.settings,
          sceneCount: String(input.scenes.length),
          aspectRatio: input.veoInput.aspectRatio,
          sceneDuration: input.veoInput.sceneDuration,
          videoQuality: input.veoInput.videoQuality ?? p.settings.videoQuality,
          veoModel: input.veoInput.veoModel ?? p.settings.veoModel,
        },
        aspectRatio: input.veoInput.aspectRatio,
      }));

      // status:'generating' KHÔNG set ở đây — runSceneGeneration tự làm (tránh 2 lần render).
      runSceneGeneration(itemId, {
        scenes: input.scenes,
        sourceContent: input.rawPrompt,
        sceneCount: String(input.scenes.length),
        language: input.ttsInput.language,
        aspectRatio: input.veoInput.aspectRatio,
        sceneDuration: input.veoInput.sceneDuration,
        veoInput: input.veoInput,
        ttsInput: input.ttsInput,
        // inputType CỐ TÌNH bỏ trống — giữ union 'text'|'link'|'image' không đổi ở nơi khác
        // (scenes.ts:78 SceneGenerationResult), giảm blast radius của Phase 4.
      }, epoch);

      return true;
    },
    [updateItem, runSceneGeneration],
  );

  const startAnalyze = useCallback((itemId: string, input: AnalyzeInput): boolean => {
    const item = itemsRef.current.find((p) => p.id === itemId);
    if (!item) return false;

    if (item.status === 'analyzing' || item.status === 'generating') {
      return false;
    }
    if (item.isRegenerating) {
      return false;
    }
    if (analyzeInFlightRef.current.has(itemId)) {
      return false;
    }

    analyzeInFlightRef.current.add(itemId);

    const epoch = (generationEpochRef.current.get(itemId) ?? 0) + 1;
    generationEpochRef.current.set(itemId, epoch);

    updateItem(itemId, {
      status: 'analyzing',
      errorMessage: undefined,
      inputContent: input.sourceContent,
    });

    void (async () => {
      try {
        const { script, veoInput, ttsInput } = await geminiService.analyzeScript(input.pipeline);
        if (generationEpochRef.current.get(itemId) !== epoch) return;

        //đoạn này là chia kịch bản thành các cảnh
        // script là kịch bản từ Gemini
        // sceneDurationSetting là độ dài của cảnh
        // videoQuality là chất lượng video
        // trả về mảng các cảnh
        let scenes = scenesFromGeminiScript(
          script,
          veoInput.sceneDuration,
          veoInput.videoQuality,
        );

        // Tab "Từ hình ảnh" — gắn đúng ảnh[i] vào scenes[i] theo thứ tự, để Veo
        // dùng ảnh đó làm ảnh mồi tạo video cho đúng cảnh tương ứng.
        if (input.sceneImages) {
          scenes = scenes.map((s, i) => {
            const img = input.sceneImages?.[i];
            return img ? { ...s, sourceImageBase64: img.base64, sourceImageMimeType: img.mimeType } : s;
          });
        }

        const result: SceneGenerationResult = {
          scenes,
          sourceContent: input.sourceContent,
          sceneCount: input.sceneCount,
          language: input.language,
          aspectRatio: veoInput.aspectRatio,
          sceneDuration: veoInput.sceneDuration,
          veoInput,
          ttsInput,
          inputType: input.pipeline.geminiInput.inputType,
          masterCastPrompt: script.masterCastPrompt,
        };

        // Dừng lại chờ user xem/sửa danh sách cảnh TRƯỚC khi gọi TTS/Veo (mọi loại nguồn).
        updateItem(itemId, {
          status: 'draft',
          errorMessage: undefined,
          inputContent: result.sourceContent,
          inputType: result.inputType,
          masterCastPrompt: result.masterCastPrompt,
          scenes: scenes.map((s) => ({ ...s, status: 'edited' as const })),
          scenesDone: 0,
          scenesTotal: scenes.length,
          pendingLinkReview: result,
        });
        analyzeInFlightRef.current.delete(itemId);
      } catch (err) {
        if (generationEpochRef.current.get(itemId) !== epoch) return;
        const message = toUserMessage(err, 'Phân tích kịch bản thất bại — kiểm tra lại Gemini API Key và thử lại.');
        updateItem(itemId, { status: 'error', errorMessage: message });
        reportUserError({
          source: 'project',
          message,
          rawMessage: err instanceof Error ? err.message : undefined,
          projectId: itemId,
        });
        analyzeInFlightRef.current.delete(itemId);
      }
    })();

    return true;
  }, [updateItem, runSceneGeneration]);


  const startRegenerate = useCallback((itemId: string, input: AnalyzeInput): boolean => {
    const item = itemsRef.current.find((p) => p.id === itemId);
    if (!item) return false;

    if (item.status === 'analyzing' || item.status === 'generating') {
      return false;
    }
    if (item.isRegenerating) {
      return false;
    }
    if (analyzeInFlightRef.current.has(itemId) || regenerateInFlightRef.current.has(itemId)) {
      return false;
    }

    regenerateInFlightRef.current.add(itemId);

    const epoch = (regenEpochRef.current.get(itemId) ?? 0) + 1;
    regenEpochRef.current.set(itemId, epoch);

    updateItem(itemId, {
      isRegenerating: true,
      regenerateError: undefined,
      pendingRegeneration: {
        status: 'analyzing',
        scenes: [],
        scenesDone: 0,
        scenesTotal: 0,
        ttsInput: null,
        veoInput: null,
        inputContent: input.sourceContent,
        timelineDemo: null,
      },
    });

    void (async () => {
      try {
        const { script, veoInput, ttsInput } = await geminiService.analyzeScript(input.pipeline);
        if (regenEpochRef.current.get(itemId) !== epoch) return;

        const scenes = scenesFromGeminiScript(
          script,
          veoInput.sceneDuration,
          veoInput.videoQuality,
        );

        runSceneGeneration(itemId, {
          scenes,
          sourceContent: input.sourceContent,
          sceneCount: input.sceneCount,
          language: input.language,
          aspectRatio: veoInput.aspectRatio,
          sceneDuration: veoInput.sceneDuration,
          veoInput,
          ttsInput,
        }, epoch, { mode: 'regenerate' });
      } catch (err) {
        if (regenEpochRef.current.get(itemId) !== epoch) return;
        const message = toUserMessage(err, 'Tạo lại kịch bản thất bại — kiểm tra lại Gemini API Key và thử lại.');
        updateItem(itemId, { isRegenerating: false, pendingRegeneration: null, regenerateError: message });
        reportUserError({
          source: 'project',
          message,
          rawMessage: err instanceof Error ? err.message : undefined,
          projectId: itemId,
        });
        regenerateInFlightRef.current.delete(itemId);
      }
    })();

    return true;
  }, [updateItem, runSceneGeneration]);

  /**
   * Xác nhận sau bước xem trước cảnh — bắt đầu gọi TTS/Veo.
   * Tab link: tuỳ chọn ảnh Master Cast. Các tab khác: dùng kết quả phân tích đã lưu.
   */
  const confirmSceneGeneration = useCallback(async (itemId: string, imageDataUrl?: string): Promise<boolean> => {
    const item = itemsRef.current.find((p) => p.id === itemId);
    if (!item?.pendingLinkReview) return false;
    if (item.status === 'analyzing' || item.status === 'generating') return false;
    if (analyzeInFlightRef.current.has(itemId)) return false;

    const result = item.pendingLinkReview;
    const isLinkFlow = result.inputType === 'link' || item.inputType === 'link';

    if (!isLinkFlow) {
      analyzeInFlightRef.current.add(itemId);
      const epoch = (generationEpochRef.current.get(itemId) ?? 0) + 1;
      generationEpochRef.current.set(itemId, epoch);
      updateItem(itemId, { pendingLinkReview: null });
      runSceneGeneration(itemId, result, epoch);
      return true;
    }

    // ─── Tab link — Master Cast (ảnh tuỳ chọn) ───────────────────────────────
    analyzeInFlightRef.current.add(itemId);

    // Ưu tiên ảnh truyền trực tiếp từ panel (tránh race state); fallback item đã lưu
    const rawImage = imageDataUrl?.trim() || item.masterCastImageDataUrl;
    const provider = result.veoInput.provider ?? 'veo';

    // rawImage giờ là signed URL TẠM từ Supabase Storage (hoặc base64 local lúc đang upload)
    // — không còn URL kie.ai bền vững để gửi thẳng nữa, nên LUÔN tải về + chuyển base64, bất
    // kể provider. Backend tự upload base64 này lên kie.ai (TẠM, ngay trước lúc gọi Veo) khi
    // provider='veo', hoặc gửi inline cho Google khi provider='veo-gemini'.
    let image: { base64?: string; mimeType?: string; url?: string } | undefined;
    if (rawImage?.startsWith('data:')) {
      image = parseDataUrl(rawImage);
    } else if (rawImage) {
      image = await fetchUrlAsBase64(rawImage);
    }

    if (process.env.NODE_ENV !== 'production') console.log('[master-cast/confirm]', {
      itemId,
      provider,
      hasImageArg: Boolean(imageDataUrl?.trim()),
      hasItemImage: Boolean(item.masterCastImageDataUrl),
      hasImage: Boolean(image),
      imageMime: image?.mimeType ?? null,
      hasImageUrl: Boolean(image?.url),
    });

    const epoch = (generationEpochRef.current.get(itemId) ?? 0) + 1;
    generationEpochRef.current.set(itemId, epoch);

    // masterCastPrompt là NGUỒN DUY NHẤT (user thấy + sửa được trong MasterCastPanel) —
    // chèn vào đầu prompt mọi cảnh lúc gửi Veo/Kie, dù có ảnh hay không (text vẫn hữu ích
    // để củng cố nhận diện nhân vật khi không có ảnh tham chiếu).
    const masterCharacterText = item.masterCastPrompt?.trim() || undefined;
    const veoInput: VeoInput = {
      ...result.veoInput,
      // Không có ảnh → referenceImage undefined, cảnh 1 rơi về TEXT_2_VIDEO như tab file/text.
      referenceImage: image,
      masterCharacterText,
      characters: image
        ? [
            ...(result.veoInput.characters ?? []).filter((c) => c.name !== 'Master Cast'),
            {
              name: 'Master Cast',
              role: '',
              traits: '',
              outfit: '',
              description: item.masterCastPrompt ?? '',
              style: 'Realistic',
              imageBase64: image.base64,
              imageMimeType: image.mimeType,
            } satisfies PipelineCharacter,
          ]
        : (result.veoInput.characters ?? []).filter((c) => c.name !== 'Master Cast'),
    };

    if (process.env.NODE_ENV !== 'production') console.log('[master-cast/confirm] Gắn referenceImage + Master Cast character (nếu có ảnh) — sẽ gửi kèm mỗi cảnh.', {
      characters: (veoInput.characters ?? []).map((c) => ({
        name: c.name,
        hasImage: Boolean(c.imageBase64 || c.imageUrl),
      })),
      hasReferenceImage: Boolean(veoInput.referenceImage),
      hasMasterCharacterText: Boolean(masterCharacterText),
    });

    // Một lần update: lưu ảnh (nếu có) + xoá pending + giữ prompt
    updateItem(itemId, {
      pendingLinkReview: null,
      masterCastImageDataUrl: rawImage,
    });
    // runSceneGeneration tự ghi đè item.masterCastPrompt = result.masterCastPrompt (bản GỐC
    // Gemini phân tích script lần đầu, TRƯỚC khi có ảnh). Phải override lại bằng bản HIỆN TẠI
    // (item.masterCastPrompt — đã cập nhật bởi Gemini Vision phân tích ảnh hoặc user tự sửa),
    // nếu không panel sẽ hiện lùi về prompt cũ ngay sau khi bấm xác nhận.
    runSceneGeneration(itemId, { ...result, veoInput, masterCastPrompt: item.masterCastPrompt }, epoch);
    return true;
  }, [updateItem, runSceneGeneration]);

  const confirmLinkGeneration = confirmSceneGeneration;

  const ensureGenerationInputs = useCallback(async (itemId: string) => {
    const item = itemsRef.current.find((p) => p.id === itemId);
    if (!item) return null;
    if (item.ttsInput && item.veoInput) {
      return { ttsInput: item.ttsInput, veoInput: item.veoInput };
    }
    const rebuilt = await rebuildGenerationInputs(item);
    if (!rebuilt) return null;
    updateItem(itemId, { ttsInput: rebuilt.ttsInput, veoInput: rebuilt.veoInput });
    return rebuilt;
  }, [updateItem]);

  // Resume poll Veo sau refresh — chỉ chạy sau khi Supabase (nguồn dữ liệu duy nhất)
  // đã tải xong, không gọi predictLongRunning lại dựa trên state khởi tạo rỗng/cũ.
  useEffect(() => {
    if (!user || !remoteReady) return;

    void (async () => {
      if (process.env.NODE_ENV !== 'production') console.log('[video-library] resume-check chạy — items:', itemsRef.current.map((it) => ({
        id: it.id,
        title: it.title,
        itemStatus: it.status,
        hasTtsInput: Boolean(it.ttsInput),
        hasVeoInput: Boolean(it.veoInput),
        scenes: it.scenes.map((s) => ({
          id: s.id,
          status: s.status,
          hasVideoUrl: Boolean(s.videoUrl),
          hasVideoPath: Boolean(s.videoPath),
          veoTaskId: s.veoTaskId,
        })),
      })));

      for (const item of itemsRef.current) {
        if (resumedItemsRef.current.has(item.id)) continue;
        if (analyzeInFlightRef.current.has(item.id)) continue;

        let ttsInput = item.ttsInput;
        let veoInput = item.veoInput;

        // ttsInput/veoInput KHÔNG đồng bộ Supabase (chứa apiKey cá nhân) — sau khi Supabase
        // nạp lại items (F5/đăng nhập máy khác) 2 field này luôn về null dù project đã có
        // cảnh. Dựng lại từ dữ liệu không nhạy cảm đã lưu (settings/characters/masterCast...)
        // + apiKey hiện tại — để cả resume poll lẫn nút "Tạo lại" cảnh lỗi dùng lại được.
        if ((!ttsInput || !veoInput) && item.scenes.length > 0) {
          const rebuilt = await rebuildGenerationInputs(item);
          if (rebuilt) {
            ttsInput = rebuilt.ttsInput;
            veoInput = rebuilt.veoInput;
            updateItem(item.id, { ttsInput, veoInput });
          }
        }

        if (!ttsInput || !veoInput) {
          const stuck = item.scenes.filter((s) => s.status === 'generating');
          if (stuck.length > 0) {
            const message =
              'Chưa có cấu hình cảnh — F5 đã mất cấu hình tạm. Nếu dùng Veo Gemini, kiểm tra API key rồi thử tạo lại.';
            const scenes = item.scenes.map((s) =>
              s.status === 'generating'
                ? { ...s, status: 'error' as const, errorMessage: message }
                : s,
            );
            updateItem(item.id, {
              scenes,
              scenesDone: countScenesDone(scenes),
              status: 'error',
              errorMessage: message,
            });
            reportUserError({
              source: 'client',
              message,
              projectId: item.id,
            });
          }
          continue;
        }
        const needResume = scenesNeedingVeoResume(item.scenes);
        if (needResume.length === 0) continue;

        if (process.env.NODE_ENV !== 'production') console.log(`[video-library] RESUME TRIGGERED cho project "${item.title}" (${item.id}) — cảnh cần resume:`, needResume.map((s) => ({ id: s.id, status: s.status, veoTaskId: s.veoTaskId })));

        resumedItemsRef.current.add(item.id);

        const epoch = (generationEpochRef.current.get(item.id) ?? 0) + 1;
        generationEpochRef.current.set(item.id, epoch);
        analyzeInFlightRef.current.add(item.id);

        runSceneGeneration(item.id, {
          scenes: item.scenes,
          sourceContent: item.inputContent,
          sceneCount: item.settings.sceneCount,
          language: item.settings.language,
          aspectRatio: veoInput.aspectRatio,
          sceneDuration: veoInput.sceneDuration,
          veoInput,
          ttsInput,
        }, epoch, { resumeOnly: true });
      }
    })();
  }, [remoteReady, user, runSceneGeneration, updateItem]);

  const value = useMemo(
    () => ({
      items,
      activeItemId,
      activeItem,
      libraryLoading: Boolean(user) && !remoteReady,
      libraryError: remoteSyncError,
      retryLibrarySync,
      createItem,
      selectItem,
      deleteItem,
      deleteAllItems,
      updateItem,
      renameItem,
      updateActiveItem,
      setActiveScenes,
      setActiveTimelineFocus,
      applyPresetToActive,
      applyPresetAsDemo,
      syncSettingsForItem,
      startAnalyze,
      startDirectVeoGeneration,
      startRegenerate,
      confirmSceneGeneration,
      confirmLinkGeneration,
      saveActiveSceneVideos,
      deleteSceneStorageAssets,
      uploadSourceImage,
      deleteSourceUpload,
      getSourceSignedUrl,
      uploadBgm,
      deleteBgm,
      updateBgmVolume,
      getBgmSignedUrl,
      ensureGenerationInputs,
    }),
    [
      items,
      activeItemId,
      activeItem,
      user,
      remoteReady,
      remoteSyncError,
      retryLibrarySync,
      createItem,
      selectItem,
      deleteItem,
      deleteAllItems,
      updateItem,
      renameItem,
      updateActiveItem,
      setActiveScenes,
      setActiveTimelineFocus,
      applyPresetToActive,
      applyPresetAsDemo,
      syncSettingsForItem,
      startAnalyze,
      startDirectVeoGeneration,
      startRegenerate,
      confirmSceneGeneration,
      confirmLinkGeneration,
      saveActiveSceneVideos,
      deleteSceneStorageAssets,
      uploadSourceImage,
      deleteSourceUpload,
      getSourceSignedUrl,
      uploadBgm,
      deleteBgm,
      updateBgmVolume,
      getBgmSignedUrl,
      ensureGenerationInputs,
    ],
  );

  return (
    <VideoLibraryContext.Provider value={value}>
      {children}
    </VideoLibraryContext.Provider>
  );
}

export function useVideoLibrary(): VideoLibraryContextValue {
  const ctx = useContext(VideoLibraryContext);
  if (!ctx) {
    throw new Error('useVideoLibrary must be used within VideoLibraryProvider');
  }
  return ctx;
}
