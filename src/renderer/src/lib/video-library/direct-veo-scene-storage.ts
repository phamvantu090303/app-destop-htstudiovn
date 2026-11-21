// ─── Ảnh Direct Veo (tab "Veo trực tiếp") — lưu Supabase Storage (bucket `source-uploads`) ──
// Cùng bucket + policy với tab "Từ hình ảnh"/Master Cast (xem character-image-storage.ts) —
// path riêng theo prefix `direct-veo/` để không đụng ảnh của 2 tính năng kia. Trước Phase 9,
// ảnh Direct Veo chỉ tồn tại trong RAM (base64) và mất sau F5/đăng xuất — xem plan.md insight 7.

import type { SupabaseClient } from '@supabase/supabase-js';
import { createClient } from '@/lib/supabase/client';
import type { VideoLibraryItem } from '@/lib/video-library/video-library';

const BUCKET = 'source-uploads';
/** Signed URL sống 1 giờ — đủ cho 1 phiên làm việc, tự tạo lại ở lần load sau */
const SIGNED_URL_TTL_SECONDS = 60 * 60;

function extFromMimeType(mimeType: string): string {
  const sub = mimeType.split('/')[1]?.split(';')[0]?.trim();
  return sub || 'bin';
}

function directVeoScenePath(userId: string, projectId: string, sceneId: string, mimeType: string): string {
  return `${userId}/${projectId}/direct-veo/${sceneId}.${extFromMimeType(mimeType)}`;
}

async function requireUserId(supabase: SupabaseClient): Promise<string> {
  const { data, error } = await supabase.auth.getUser();
  if (error || !data.user) throw new Error('Cần đăng nhập để lưu ảnh.');
  return data.user.id;
}

export interface UploadedDirectVeoSceneImage {
  /** Path trong Storage — lưu bền vững vào DB (direct_veo_scenes.image_path) */
  path: string;
  /** Signed URL tạm để hiển thị ngay sau khi upload — KHÔNG lưu DB, hết hạn sau 1 giờ */
  url: string;
}

/** Upload ảnh 1 scene Direct Veo lên Storage — trả path (lưu DB) + signed URL (hiển thị ngay).
 * `base64`/`mimeType` là ảnh ĐÃ qua readDirectVeoImage() (resize + strip EXIF + JPEG hoá). */
export async function uploadDirectVeoSceneImage(
  projectId: string,
  sceneId: string,
  base64: string,
  mimeType: string,
): Promise<UploadedDirectVeoSceneImage> {
  const supabase = createClient();
  if (!supabase) throw new Error('Chưa cấu hình Supabase.');
  const userId = await requireUserId(supabase);
  const path = directVeoScenePath(userId, projectId, sceneId, mimeType);

  const bytes = Uint8Array.from(atob(base64), (c) => c.charCodeAt(0));
  const { error } = await supabase.storage
    .from(BUCKET)
    .upload(path, bytes, { contentType: mimeType, upsert: true });
  if (error) throw error;

  const { data: signed, error: signedErr } = await supabase.storage
    .from(BUCKET)
    .createSignedUrl(path, SIGNED_URL_TTL_SECONDS);
  if (signedErr || !signed?.signedUrl) throw new Error('Không tạo được URL xem ảnh.');

  return { path, url: signed.signedUrl };
}

/** Xoá 1 ảnh scene khỏi Storage — gọi khi user xoá ảnh khỏi scene hoặc xoá cả scene. */
export async function deleteDirectVeoSceneImage(supabase: SupabaseClient, path: string): Promise<void> {
  const { error } = await supabase.storage.from(BUCKET).remove([path]);
  if (error) throw error;
}

/** Signed URL hàng loạt cho path đã lưu — gọi 1 lần khi load Kho video. */
export async function resolveDirectVeoSceneSignedUrls(
  supabase: SupabaseClient,
  paths: string[],
): Promise<Map<string, string>> {
  const clean = [...new Set(paths.filter(Boolean))];
  if (clean.length === 0) return new Map();

  const { data, error } = await supabase.storage.from(BUCKET).createSignedUrls(clean, SIGNED_URL_TTL_SECONDS);
  if (error) {
    console.error('[direct-veo-scene-storage] Tạo signed URL ảnh scene thất bại:', error);
    return new Map();
  }
  return new Map(
    (data ?? []).filter((r) => r.path && r.signedUrl).map((r) => [r.path as string, r.signedUrl as string]),
  );
}

/** Gán signed URL cho imagePath của mọi Direct Veo scene — gọi 1 lần khi load Kho video,
 * giống resolveCharacterAndMasterCastSignedUrls/resolveSourceUploadSignedUrls. */
export async function resolveDirectVeoScenesSignedUrls(
  supabase: SupabaseClient,
  items: VideoLibraryItem[],
): Promise<VideoLibraryItem[]> {
  const paths = items.flatMap((item) => (item.directVeoScenes ?? []).map((s) => s.imagePath).filter(Boolean) as string[]);
  if (paths.length === 0) return items;

  const urlByPath = await resolveDirectVeoSceneSignedUrls(supabase, paths);

  return items.map((item) => ({
    ...item,
    directVeoScenes: item.directVeoScenes?.map((s) => ({
      ...s,
      imagePreviewUrl: s.imagePath ? urlByPath.get(s.imagePath) ?? s.imagePreviewUrl : s.imagePreviewUrl,
    })),
  }));
}
