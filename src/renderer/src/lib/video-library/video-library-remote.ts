// ─── Đồng bộ Kho video (video_projects/video_characters/video_scenes) với Supabase ───
//
// Chỉ đồng bộ dữ liệu văn bản/cấu hình (không phải blob video/audio — vẫn ở
// `blob:` URL tạm trong RAM như hiện tại, mất khi F5, chưa upload lên Storage).
// KHÔNG đồng bộ ttsInput/veoInput vì hai object này chứa apiKey cá nhân của
// người dùng — apiKey lưu riêng ở bảng user_api_keys (frontend/lib/api-keys/api-keys-store.ts).

import type { SupabaseClient } from '@supabase/supabase-js';
import type { DirectVeoPersistedScene, SourceImageItem, VideoLibraryItem } from '@/lib/video-library/video-library';
import type { VideoScene } from '@/lib/scene/scenes';
import type { SavedCharacter } from '@/lib/character/saved-characters';
import { createEmptyCharacter } from '@/lib/character/saved-characters';
import type { VideoSettings } from '@/contexts/project-settings-context';
import { DEFAULT_VIDEO_SETTINGS } from '@/contexts/project-settings-context';

interface ProjectRow {
  id: string;
  user_id: string;
  title: string;
  status: VideoLibraryItem['status'];
  error_message: string | null;
  veo_model_label: string | null;
  aspect_ratio: string;
  scenes_done: number;
  scenes_total: number;
  input_content: string;
  input_type: VideoLibraryItem['inputType'] | null;
  initial_input_type: VideoLibraryItem['initialInputType'] | null;
  link_url: string | null;
  link_description: string | null;
  image_master_brief: string | null;
  image_mode: VideoLibraryItem['imageMode'] | null;
  source_images: SourceImageItem[] | null;
  settings: VideoSettings;
  applied_input: VideoLibraryItem['appliedInput'];
  timeline: VideoLibraryItem['timelineDemo'];
  bgm_path: string | null;
  bgm_file_name: string | null;
  bgm_volume: number | null;
  // Prompt mô tả dàn nhân vật (tab link) + URL ảnh tham chiếu (đã upload kie.ai — KHÔNG base64)
  master_cast_prompt: string | null;
  master_cast_image_url: string | null;
  // Tab "Veo trực tiếp" (Phase 9) — Thiết lập chung, riêng từng project
  direct_veo_global_context: string;
  created_at: string;
  updated_at: string;
}

interface CharacterRow {
  id: string;
  project_id: string;
  user_id: string;
  position: number;
  name: string;
  role: string;
  traits: string;
  outfit: string;
  description: string;
  style: string;
  /** URL ảnh nhân vật đã upload kie.ai (file-base64-upload) — KHÔNG phải base64 */
  avatar_url: string | null;
  created_at: string;
  updated_at: string;
}

interface DirectVeoSceneRow {
  id: string;
  project_id: string;
  user_id: string;
  position: number;
  prompt: string;
  /** Path Storage bucket `source-uploads` — NULL = scene không có ảnh (Text-to-Video) */
  image_path: string | null;
  image_mime_type: string | null;
}

interface SceneRow {
  id: string;
  project_id: string;
  user_id: string;
  index: number;
  time_start: number;
  time_end: number;
  duration_seconds: number;
  prompt: string;
  voice: string;
  status: VideoScene['status'];
  error_message: string | null;
  audio_duration_seconds: number | null;
  video_path: string | null;
  audio_path: string | null;
}

function toProjectRow(userId: string, item: VideoLibraryItem): ProjectRow {
  return {
    id: item.id,
    user_id: userId,
    title: item.title,
    status: item.status,
    error_message: item.errorMessage ?? null,
    veo_model_label: item.veoModelLabel || null,
    aspect_ratio: item.aspectRatio,
    scenes_done: item.scenesDone,
    scenes_total: item.scenesTotal,
    input_content: item.inputContent,
    input_type: item.inputType ?? null,
    initial_input_type: item.initialInputType ?? null,
    link_url: item.linkUrl ?? null,
    link_description: item.linkDescription ?? null,
    image_master_brief: item.imageMasterBrief ?? null,
    image_mode: item.imageMode ?? null,
    // previewUrl là signed URL tạm — không lưu DB, chỉ lưu {id,path,fileName,mimeType,prompt,label,voiceHint}
    source_images: item.sourceImages?.map(({ previewUrl: _previewUrl, ...rest }) => rest) ?? null,
    settings: item.settings,
    applied_input: item.appliedInput,
    timeline: item.timelineDemo,
    bgm_path: item.bgmPath ?? null,
    bgm_file_name: item.bgmFileName ?? null,
    bgm_volume: item.bgmVolume ?? null,
    master_cast_prompt: item.masterCastPrompt ?? null,
    // Path Supabase Storage (bucket `source-uploads`, KHÔNG phải URL kie.ai — đã hết hạn nên
    // đổi sang lưu path bền vững). masterCastImageDataUrl chỉ là signed URL/base64 hiển thị
    // tạm, không lưu DB.
    master_cast_image_url: item.masterCastImagePath ?? null,
    direct_veo_global_context: item.directVeoGlobalContext ?? '',
    created_at: item.createdAt,
    updated_at: item.updatedAt,
  };
}

/** Row upsert — không gửi created_at/updated_at để DB giữ ngày tạo thật. */
function toProjectUpsertRow(userId: string, item: VideoLibraryItem): Omit<ProjectRow, 'created_at' | 'updated_at'> {
  const { created_at: _c, updated_at: _u, ...row } = toProjectRow(userId, item);
  return row;
}

function fromProjectRow(row: ProjectRow): Omit<VideoLibraryItem, 'characters' | 'scenes'> {
  return {
    id: row.id,
    title: row.title,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    status: row.status,
    errorMessage: row.error_message ?? undefined,
    veoModelLabel: row.veo_model_label ?? '',
    aspectRatio: row.aspect_ratio,
    scenesDone: row.scenes_done,
    scenesTotal: row.scenes_total,
    inputContent: row.input_content,
    inputType: row.input_type ?? undefined,
    initialInputType: row.initial_input_type ?? undefined,
    linkUrl: row.link_url ?? undefined,
    linkDescription: row.link_description ?? undefined,
    imageMasterBrief: row.image_master_brief ?? undefined,
    imageMode: row.image_mode ?? undefined,
    // previewUrl (signed URL) được resolveSourceUploadSignedUrls gán sau, ngay sau khi fetch
    sourceImages: row.source_images ?? undefined,
    settings: { ...DEFAULT_VIDEO_SETTINGS, ...(row.settings ?? {}) },
    appliedInput: row.applied_input ?? null,
    timelineDemo: row.timeline ?? null,
    // bgmUrl (signed URL) được resolveBgmSignedUrls gán sau, ngay sau khi fetch — giống sourceImages
    bgmPath: row.bgm_path ?? undefined,
    bgmFileName: row.bgm_file_name ?? undefined,
    bgmVolume: row.bgm_volume ?? undefined,
    masterCastPrompt: row.master_cast_prompt ?? undefined,
    // masterCastImageDataUrl (signed URL) được resolveCharacterImageSignedUrls gán sau, ngay
    // sau khi fetch — giống sourceImages/bgm
    masterCastImagePath: row.master_cast_image_url ?? undefined,
    directVeoGlobalContext: row.direct_veo_global_context ?? '',
    // Không đồng bộ — chỉ tồn tại trong phiên làm việc hiện tại
    ttsInput: null,
    veoInput: null,
    pendingTimelineDemo: null,
    timelineFocusSceneId: null,
    isRegenerating: false,
    pendingRegeneration: null,
    regenerateError: undefined,
  };
}

function toCharacterRow(userId: string, projectId: string, position: number, c: SavedCharacter): CharacterRow {
  return {
    id: c.id,
    project_id: projectId,
    user_id: userId,
    position,
    name: c.name,
    role: c.role,
    traits: c.traits,
    outfit: c.outfit,
    description: c.description,
    style: c.style,
    // Path Supabase Storage (bucket `source-uploads`, KHÔNG phải URL kie.ai — đã hết hạn nên
    // đổi sang lưu path bền vững). avatarDataUrl chỉ là signed URL/base64 hiển thị tạm, không lưu DB.
    avatar_url: c.avatarPath ?? null,
    created_at: c.createdAt,
    updated_at: c.updatedAt,
  };
}

function fromCharacterRow(row: CharacterRow): SavedCharacter {
  return {
    id: row.id,
    name: row.name,
    role: row.role,
    traits: row.traits,
    outfit: row.outfit,
    description: row.description,
    style: row.style,
    // avatarDataUrl (signed URL) được resolveCharacterImageSignedUrls gán sau, ngay sau khi fetch
    avatarPath: row.avatar_url ?? undefined,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function toDirectVeoSceneRow(userId: string, projectId: string, position: number, s: DirectVeoPersistedScene): DirectVeoSceneRow {
  return {
    id: s.id,
    project_id: projectId,
    user_id: userId,
    position,
    prompt: s.prompt,
    // imagePreviewUrl là signed URL tạm — không lưu DB, chỉ lưu path bền vững
    image_path: s.imagePath ?? null,
    image_mime_type: s.imageMimeType ?? null,
  };
}

function fromDirectVeoSceneRow(row: DirectVeoSceneRow): DirectVeoPersistedScene {
  return {
    id: row.id,
    prompt: row.prompt,
    // imagePreviewUrl (signed URL) được resolveDirectVeoScenesSignedUrls gán sau, ngay sau khi fetch
    imagePath: row.image_path ?? undefined,
    imageMimeType: row.image_mime_type ?? undefined,
  };
}

function toSceneRow(userId: string, projectId: string, s: VideoScene): SceneRow {
  return {
    id: s.id,
    project_id: projectId,
    user_id: userId,
    index: s.index,
    time_start: s.timeStart,
    time_end: s.timeEnd,
    duration_seconds: s.durationSeconds,
    prompt: s.prompt,
    voice: s.voice,
    status: s.status,
    error_message: s.errorMessage ?? null,
    audio_duration_seconds: s.audioDurationSeconds ?? null,
    video_path: s.videoPath ?? null,
    audio_path: s.audioPath ?? null,
  };
}

/**
 * `veoTaskId`/`videoApiKeyId` KHÔNG còn nằm trên `video_scenes` — hydrate từ bản ghi mới nhất
 * trong `veo_task_records` (xem `fetchLatestVeoTaskIdByScene`), truyền vào qua tham số thứ 2.
 */
function fromSceneRow(row: SceneRow, latest?: { veoTaskId: string; videoApiKeyId?: string; createdAt?: string }): VideoScene {
  return {
    id: row.id,
    index: row.index,
    timeStart: row.time_start,
    timeEnd: row.time_end,
    prompt: row.prompt,
    voice: row.voice,
    durationSeconds: row.duration_seconds,
    status: row.status,
    errorMessage: row.error_message ?? undefined,
    // videoUrl/audioUrl chưa upload lên Storage — cảnh hiển thị lại icon placeholder
    videoUrl: undefined,
    audioUrl: undefined,
    audioDurationSeconds: row.audio_duration_seconds ?? undefined,
    veoTaskId: latest?.veoTaskId,
    videoApiKeyId: latest?.videoApiKeyId,
    veoTaskStartedAt: latest?.createdAt,
    videoPath: row.video_path ?? undefined,
    audioPath: row.audio_path ?? undefined,
  };
}

// ─── veo_task_records — audit trail riêng (xem docs/KIE_AI_API_ANALYSIS.md và migration
// 0010_veo_task_records.sql). Append-only: chỉ INSERT, không bao giờ UPDATE/DELETE — RLS
// của bảng này cũng chỉ cho phép select + insert nên update/delete từ client sẽ bị chặn.

interface VeoTaskRecordRow {
  scene_id: string | null;
  veo_task_id: string;
  /** id (không phải secret) Video API Key hệ thống đã tạo task này — chỉ có ở provider 'veo' */
  video_api_key_id: string | null;
  created_at: string;
}

/** Lấy veo_task_id (+ videoApiKeyId) MỚI NHẤT cho mỗi scene_id (dùng để hydrate VideoScene khi load) */
async function fetchLatestVeoTaskIdByScene(
  supabase: SupabaseClient,
  userId: string,
): Promise<Map<string, { veoTaskId: string; videoApiKeyId?: string; createdAt?: string }>> {
  const { data, error } = await supabase
    .from('veo_task_records')
    .select('scene_id, veo_task_id, video_api_key_id, created_at')
    .eq('user_id', userId)
    .order('created_at', { ascending: false });
  if (error) throw error;

  const latestByScene = new Map<string, { veoTaskId: string; videoApiKeyId?: string; createdAt?: string }>();
  for (const row of (data ?? []) as VeoTaskRecordRow[]) {
    // Đã sort desc — bản ghi đầu tiên gặp cho mỗi scene_id chính là mới nhất, bỏ qua
    // các bản ghi sau (lịch sử cũ hơn) và các row không gắn scene_id (scene_id null).
    if (!row.scene_id || latestByScene.has(row.scene_id)) continue;
    latestByScene.set(row.scene_id, {
      veoTaskId: row.veo_task_id,
      videoApiKeyId: row.video_api_key_id ?? undefined,
      createdAt: row.created_at,
    });
  }
  return latestByScene;
}

export interface InsertVeoTaskRecordParams {
  userId: string;
  veoTaskId: string;
  provider?: string;
  sceneId: string;
  projectId: string;
  /** Snapshot trạng thái scene tại thời điểm tạo record — không đồng bộ lại sau đó */
  status?: string;
  /** id (không phải secret) Video API Key hệ thống đã tạo task này — chỉ có ở provider 'veo' */
  videoApiKeyId?: string;
}

/**
 * Ghi 1 dòng lịch sử mới — gọi đúng lúc 1 lượt generate/regenerate THẬT SỰ bắt đầu
 * (khi vừa có taskId mới từ kie.ai/Google). Fire-and-forget ở phía gọi — không await,
 * không được chặn luồng generate/poll. `unique(scene_id, veo_task_id)` ở DB tự chặn
 * trùng nếu callback lỡ bắn 2 lần cho cùng 1 taskId.
 */
export async function insertVeoTaskRecord(
  supabase: SupabaseClient,
  params: InsertVeoTaskRecordParams,
): Promise<void> {
  const { error } = await supabase.from('veo_task_records').upsert(
    {
      user_id: params.userId,
      veo_task_id: params.veoTaskId,
      provider: params.provider ?? null,
      scene_id: params.sceneId,
      project_id: params.projectId,
      status: params.status ?? null,
      video_api_key_id: params.videoApiKeyId ?? null,
    },
    { onConflict: 'scene_id,veo_task_id', ignoreDuplicates: true },
  );
  if (error) throw error;
}

/**
 * Bảng `direct_veo_scenes` + cột `video_projects.direct_veo_global_context` (Phase 9,
 * migration 0048_direct_veo_scenes_persist.sql) CHƯA chắc đã chạy trên mọi môi trường —
 * migration của dự án luôn chạy thủ công, không tự động. Lỗi "undefined_table"/
 * "undefined_column" (Postgrest 42P01/42703) từ riêng phần Direct Veo KHÔNG được phép làm
 * hỏng toàn bộ đồng bộ Kho video (project/nhân vật/cảnh) của user — chỉ Direct Veo persist
 * tạm thời không hoạt động cho tới khi migration được chạy.
 * TODO: xoá helper + các nhánh fallback dùng nó sau khi xác nhận 0048 đã chạy ở mọi môi trường.
 */
function isMissingDirectVeoSchema(error: unknown): boolean {
  const code = (error as { code?: string } | null | undefined)?.code;
  const message = (error as { message?: string } | null | undefined)?.message ?? '';
  return code === '42P01' || code === '42703'
    || /direct_veo_scenes|direct_veo_global_context/.test(message);
}

/** Tải toàn bộ Kho video của user hiện tại từ Supabase (project + nhân vật + cảnh) */
export async function fetchRemoteVideoLibrary(
  supabase: SupabaseClient,
  userId: string,
): Promise<VideoLibraryItem[]> {
  const [
    { data: projects, error: pErr },
    { data: characters, error: cErr },
    { data: scenes, error: sErr },
    directVeoResult,
    latestVeoTaskIdByScene,
  ] = await Promise.all([
    supabase.from('video_projects').select('*').eq('user_id', userId).order('updated_at', { ascending: false }),
    supabase.from('video_characters').select('*').eq('user_id', userId).order('position', { ascending: true }),
    supabase.from('video_scenes').select('*').eq('user_id', userId).order('index', { ascending: true }),
    supabase.from('direct_veo_scenes').select('*').eq('user_id', userId).order('position', { ascending: true }),
    fetchLatestVeoTaskIdByScene(supabase, userId),
  ]);

  if (pErr) throw pErr;
  if (cErr) throw cErr;
  if (sErr) throw sErr;

  let directVeoScenes = directVeoResult.data;
  if (directVeoResult.error) {
    if (!isMissingDirectVeoSchema(directVeoResult.error)) throw directVeoResult.error;
    console.warn('[video-library] Bảng direct_veo_scenes chưa tồn tại — chạy migration 0048_direct_veo_scenes_persist.sql. Bỏ qua Direct Veo persist lần tải này.', directVeoResult.error);
    directVeoScenes = [];
  }

  const charsByProject = new Map<string, SavedCharacter[]>();
  for (const row of (characters ?? []) as CharacterRow[]) {
    const list = charsByProject.get(row.project_id) ?? [];
    list.push(fromCharacterRow(row));
    charsByProject.set(row.project_id, list);
  }

  const scenesByProject = new Map<string, VideoScene[]>();
  for (const row of (scenes ?? []) as SceneRow[]) {
    const list = scenesByProject.get(row.project_id) ?? [];
    list.push(fromSceneRow(row, latestVeoTaskIdByScene.get(row.id)));
    scenesByProject.set(row.project_id, list);
  }

  const directVeoScenesByProject = new Map<string, DirectVeoPersistedScene[]>();
  for (const row of (directVeoScenes ?? []) as DirectVeoSceneRow[]) {
    const list = directVeoScenesByProject.get(row.project_id) ?? [];
    list.push(fromDirectVeoSceneRow(row));
    directVeoScenesByProject.set(row.project_id, list);
  }

  return ((projects ?? []) as ProjectRow[]).map((row) => ({
    ...fromProjectRow(row),
    characters: charsByProject.get(row.id) ?? [createEmptyCharacter()],
    scenes: scenesByProject.get(row.id) ?? [],
    directVeoScenes: directVeoScenesByProject.get(row.id) ?? [],
  }));
}

/**
 * Ghi đè toàn bộ Kho video của user lên Supabase — xoá project không còn tồn tại
 * cục bộ, upsert project hiện có; nhân vật/cảnh dùng upsert + xoá theo diff id
 * (không phải xoá-sạch-rồi-ghi-lại) để idempotent — an toàn khi 2 lượt push chạy
 * chồng lấn nhau (nhiều tab cùng tài khoản, hoặc debounce bắn liên tiếp lúc đang sinh cảnh).
 */
export async function pushVideoLibraryToRemote(
  supabase: SupabaseClient,
  userId: string,
  items: VideoLibraryItem[],
): Promise<void> {
  const { data: existing, error: listErr } = await supabase
    .from('video_projects')
    .select('id')
    .eq('user_id', userId);
  if (listErr) throw listErr;

  const localIds = new Set(items.map((i) => i.id));
  const remoteIds = ((existing ?? []) as { id: string }[]).map((r) => r.id);
  const toDelete = remoteIds.filter((id) => !localIds.has(id));

  if (toDelete.length > 0) {
    const { error } = await supabase.from('video_projects').delete().in('id', toDelete);
    if (error) throw error;
  }

  if (items.length === 0) return;

  const projectRows = items.map((item) => toProjectUpsertRow(userId, item));
  const { error: upsertErr } = await supabase.from('video_projects').upsert(projectRows);
  if (upsertErr) {
    if (isMissingDirectVeoSchema(upsertErr)) {
      // Cột direct_veo_global_context chưa tồn tại (migration 0048 chưa chạy) — KHÔNG được để
      // 1 cột mới làm hỏng toàn bộ lưu Kho video. Lưu lại không kèm cột đó, cảnh báo rõ ràng.
      console.warn('[video-library] Cột direct_veo_global_context chưa tồn tại — chạy migration 0048_direct_veo_scenes_persist.sql. Lưu project tạm không kèm Direct Veo Global Context.', upsertErr);
      const { error: retryErr } = await supabase
        .from('video_projects')
        .upsert(projectRows.map((row) => {
          const { direct_veo_global_context: _omit, ...rest } = row;
          return rest;
        }));
      if (retryErr) throw retryErr;
    } else {
      console.error('[video-library] upsert video_projects thất bại:', {
        code: upsertErr.code,
        message: upsertErr.message,
        details: upsertErr.details,
        hint: upsertErr.hint,
        userId,
        projectIds: projectRows.map((r) => r.id),
      });
      throw upsertErr;
    }
  }

  const projectIds = items.map((i) => i.id);
  const characterRows = items.flatMap((item) =>
    item.characters.map((c, i) => toCharacterRow(userId, item.id, i, c)),
  );
  const sceneRows = items.flatMap((item) => item.scenes.map((s) => toSceneRow(userId, item.id, s)));
  const directVeoSceneRows = items.flatMap((item) =>
    (item.directVeoScenes ?? []).map((s, i) => toDirectVeoSceneRow(userId, item.id, i, s)),
  );
  const localCharacterIds = new Set(characterRows.map((r) => r.id));
  const localSceneIds = new Set(sceneRows.map((r) => r.id));
  const localDirectVeoSceneIds = new Set(directVeoSceneRows.map((r) => r.id));

  // So id đang có trên Supabase với id local hiện tại — chỉ những id đã biến mất
  // khỏi local mới bị coi là "stale" (người dùng xoá thật), không xoá theo project_id.
  const [
    { data: remoteChars, error: remoteCharsErr },
    { data: remoteScenes, error: remoteScenesErr },
    remoteDirectVeoScenesRes,
  ] = await Promise.all([
    supabase.from('video_characters').select('id').in('project_id', projectIds),
    supabase.from('video_scenes').select('id').in('project_id', projectIds),
    supabase.from('direct_veo_scenes').select('id').in('project_id', projectIds),
  ]);
  if (remoteCharsErr) throw remoteCharsErr;
  if (remoteScenesErr) throw remoteScenesErr;

  // Bảng direct_veo_scenes chưa tồn tại (migration 0048 chưa chạy) — bỏ qua riêng phần này,
  // KHÔNG để ảnh hưởng tới việc lưu project/nhân vật/cảnh (xem isMissingDirectVeoSchema).
  let directVeoSchemaMissing = false;
  if (remoteDirectVeoScenesRes.error) {
    if (!isMissingDirectVeoSchema(remoteDirectVeoScenesRes.error)) throw remoteDirectVeoScenesRes.error;
    console.warn('[video-library] Bảng direct_veo_scenes chưa tồn tại — chạy migration 0048_direct_veo_scenes_persist.sql. Bỏ qua Direct Veo persist lần lưu này.', remoteDirectVeoScenesRes.error);
    directVeoSchemaMissing = true;
  }

  const staleCharacterIds = ((remoteChars ?? []) as { id: string }[])
    .map((r) => r.id)
    .filter((id) => !localCharacterIds.has(id));
  const staleSceneIds = ((remoteScenes ?? []) as { id: string }[])
    .map((r) => r.id)
    .filter((id) => !localSceneIds.has(id));
  const staleDirectVeoSceneIds = directVeoSchemaMissing ? [] : ((remoteDirectVeoScenesRes.data ?? []) as { id: string }[])
    .map((r) => r.id)
    .filter((id) => !localDirectVeoSceneIds.has(id));

  // Upsert (không xoá-sạch-rồi-ghi-lại) — 2 lượt push chồng lấn ghi cùng id không
  // còn báo lỗi duplicate-key, tự hội tụ an toàn.
  if (process.env.NODE_ENV !== 'production') console.log(
    '[video-library] push scenes:',
    sceneRows.map((r) => ({ id: r.id, video_path: r.video_path, audio_path: r.audio_path })),
  );

  const [upsertCharsRes, upsertScenesRes, upsertDirectVeoScenesRes] = await Promise.all([
    characterRows.length > 0
      ? supabase.from('video_characters').upsert(characterRows)
      : Promise.resolve({ error: null }),
    sceneRows.length > 0
      ? supabase.from('video_scenes').upsert(sceneRows)
      : Promise.resolve({ error: null }),
    !directVeoSchemaMissing && directVeoSceneRows.length > 0
      ? supabase.from('direct_veo_scenes').upsert(directVeoSceneRows)
      : Promise.resolve({ error: null }),
  ]);
  if (upsertCharsRes.error) throw upsertCharsRes.error;
  if (upsertScenesRes.error) {
    console.error('[video-library] upsert video_scenes thất bại:', upsertScenesRes.error);
    throw upsertScenesRes.error;
  }
  if (upsertDirectVeoScenesRes.error) {
    if (!isMissingDirectVeoSchema(upsertDirectVeoScenesRes.error)) throw upsertDirectVeoScenesRes.error;
    console.warn('[video-library] upsert direct_veo_scenes bỏ qua — chạy migration 0048_direct_veo_scenes_persist.sql.', upsertDirectVeoScenesRes.error);
  }
  if (process.env.NODE_ENV !== 'production') console.log('[video-library] push scenes: upsert thành công.');

  // Chỉ xoá đúng id đã tính stale ở trên — id vừa được 1 lượt push khác insert
  // xong sẽ không nằm trong danh sách này nên không bao giờ bị xoá nhầm.
  const [delCharsRes, delScenesRes, delDirectVeoScenesRes] = await Promise.all([
    staleCharacterIds.length > 0
      ? supabase.from('video_characters').delete().in('id', staleCharacterIds)
      : Promise.resolve({ error: null }),
    staleSceneIds.length > 0
      ? supabase.from('video_scenes').delete().in('id', staleSceneIds)
      : Promise.resolve({ error: null }),
    staleDirectVeoSceneIds.length > 0
      ? supabase.from('direct_veo_scenes').delete().in('id', staleDirectVeoSceneIds)
      : Promise.resolve({ error: null }),
  ]);
  if (delCharsRes.error) throw delCharsRes.error;
  if (delScenesRes.error) throw delScenesRes.error;
  if (delDirectVeoScenesRes.error && !isMissingDirectVeoSchema(delDirectVeoScenesRes.error)) {
    throw delDirectVeoScenesRes.error;
  }
}
