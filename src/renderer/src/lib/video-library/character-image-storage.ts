// ─── Ảnh Master Cast / avatar nhân vật — lưu Supabase Storage (bucket `source-uploads`) ──
// kie.ai chỉ host ảnh TẠM THỜI (dùng để feed vào Veo generate ngay lúc đó, URL hết hạn sau
// một thời gian) — KHÔNG phải chỗ lưu lâu dài. Ảnh giờ lưu vĩnh viễn trong Storage của
// chính app (RLS theo `{userId}/...`, bucket có sẵn từ supabase-data/migrations/0002),
// kie.ai chỉ còn dùng để upload TẠM ngay trước mỗi lần gọi Veo (xem backend veo.service.ts).

import type { SupabaseClient } from '@supabase/supabase-js';
import { createClient } from '@/lib/supabase/client';
import type { VideoLibraryItem } from '@/lib/video-library/video-library';

const BUCKET = 'source-uploads';
/** Signed URL sống 1 giờ — đủ cho 1 phiên làm việc, tự tạo lại ở lần load sau */
const SIGNED_URL_TTL_SECONDS = 60 * 60;
const MAX_REFERENCE_IMAGE_MB = 5;

function extFromMimeType(mimeType: string): string {
  const sub = mimeType.split('/')[1]?.split(';')[0]?.trim();
  return sub || 'bin';
}

function characterAvatarPath(userId: string, characterId: string, mimeType: string): string {
  return `${userId}/characters/${characterId}.${extFromMimeType(mimeType)}`;
}

function masterCastImagePath(userId: string, projectId: string, mimeType: string): string {
  return `${userId}/${projectId}/master-cast.${extFromMimeType(mimeType)}`;
}

/** Validate loại/dung lượng file ảnh — dùng trước khi đọc/upload */
export function validateReferenceImageFile(file: File): string | undefined {
  if (!file.type.startsWith('image/')) {
    return 'File phải là hình ảnh (JPG, PNG, WebP...).';
  }
  if (file.size > MAX_REFERENCE_IMAGE_MB * 1024 * 1024) {
    return `Ảnh quá lớn — tối đa ${MAX_REFERENCE_IMAGE_MB}MB.`;
  }
  return undefined;
}

export interface UploadedCharacterImage {
  /** Path trong Storage — lưu bền vững vào DB (avatar_url/master_cast_image_url) */
  path: string;
  /** Signed URL tạm để hiển thị ngay sau khi upload — KHÔNG lưu DB, hết hạn sau 1 giờ */
  url: string;
}

async function requireUserId(supabase: SupabaseClient): Promise<string> {
  const { data, error } = await supabase.auth.getUser();
  if (error || !data.user) throw new Error('Cần đăng nhập để lưu ảnh.');
  return data.user.id;
}

async function uploadAndSign(supabase: SupabaseClient, path: string, file: File): Promise<UploadedCharacterImage> {
  const { error } = await supabase.storage
    .from(BUCKET)
    .upload(path, file, { contentType: file.type || 'image/jpeg', upsert: true });
  if (error) throw error;

  const { data: signed, error: signedErr } = await supabase.storage
    .from(BUCKET)
    .createSignedUrl(path, SIGNED_URL_TTL_SECONDS);
  if (signedErr || !signed?.signedUrl) throw new Error('Không tạo được URL xem ảnh.');

  return { path, url: signed.signedUrl };
}

/** Upload avatar nhân vật (mục 1) lên Storage — trả path (lưu DB) + signed URL (hiển thị ngay) */
export async function uploadCharacterAvatarFile(characterId: string, file: File): Promise<UploadedCharacterImage> {
  const supabase = createClient();
  if (!supabase) throw new Error('Chưa cấu hình Supabase.');
  const userId = await requireUserId(supabase);
  return uploadAndSign(supabase, characterAvatarPath(userId, characterId, file.type || 'image/jpeg'), file);
}

/** Upload ảnh Master Cast (dàn nhân vật, tab link) lên Storage — trả path (lưu DB) + signed URL */
export async function uploadMasterCastImageFile(projectId: string, file: File): Promise<UploadedCharacterImage> {
  const supabase = createClient();
  if (!supabase) throw new Error('Chưa cấu hình Supabase.');
  const userId = await requireUserId(supabase);
  return uploadAndSign(supabase, masterCastImagePath(userId, projectId, file.type || 'image/jpeg'), file);
}

/** Signed URL hàng loạt cho path đã lưu — gọi 1 lần khi load Kho video (characters + master cast) */
export async function resolveCharacterImageSignedUrls(
  supabase: SupabaseClient,
  paths: string[],
): Promise<Map<string, string>> {
  const clean = [...new Set(paths.filter(Boolean))];
  if (clean.length === 0) return new Map();

  const { data, error } = await supabase.storage.from(BUCKET).createSignedUrls(clean, SIGNED_URL_TTL_SECONDS);
  if (error) {
    console.error('[character-image-storage] Tạo signed URL ảnh nhân vật/master cast thất bại:', error);
    return new Map();
  }
  return new Map(
    (data ?? []).filter((r) => r.path && r.signedUrl).map((r) => [r.path as string, r.signedUrl as string]),
  );
}

/** Xoá 1 ảnh khỏi Storage — gọi khi user xoá nhân vật hoặc thay ảnh Master Cast khác */
export async function deleteCharacterImage(supabase: SupabaseClient, path: string): Promise<void> {
  const { error } = await supabase.storage.from(BUCKET).remove([path]);
  if (error) throw error;
}

/**
 * Gán signed URL cho avatarPath (nhân vật) + masterCastImagePath (mỗi project) — gọi 1 lần
 * khi load Kho video, giống resolveSourceUploadSignedUrls/resolveSceneSignedUrls.
 */
export async function resolveCharacterAndMasterCastSignedUrls(
  supabase: SupabaseClient,
  items: VideoLibraryItem[],
): Promise<VideoLibraryItem[]> {
  const paths: string[] = [];
  for (const item of items) {
    if (item.masterCastImagePath) paths.push(item.masterCastImagePath);
    for (const c of item.characters) {
      if (c.avatarPath) paths.push(c.avatarPath);
    }
  }
  if (paths.length === 0) return items;

  const urlByPath = await resolveCharacterImageSignedUrls(supabase, paths);

  return items.map((item) => ({
    ...item,
    masterCastImageDataUrl: item.masterCastImagePath
      ? urlByPath.get(item.masterCastImagePath) ?? item.masterCastImageDataUrl
      : item.masterCastImageDataUrl,
    characters: item.characters.map((c) => ({
      ...c,
      avatarDataUrl: c.avatarPath ? urlByPath.get(c.avatarPath) ?? c.avatarDataUrl : c.avatarDataUrl,
    })),
  }));
}
