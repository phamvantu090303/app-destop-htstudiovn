// ─── Thư viện nhạc nền (BGM) — admin quản lý qua /admin/bgm-tracks ────────────
//
// Trước đây là mảng cứng trỏ file MP3 tĩnh trong `public/nhacnen/`. Giờ lấy động từ
// `GET /api/bgm-tracks` (chỉ bài đang bật) — admin thêm/sửa/xoá không cần deploy lại.
// `assetPath` vẫn giữ tên field cũ (map từ `assetUrl` phía backend) để mọi chỗ đọc
// `.assetPath` trong timeline-editor.tsx không phải đổi gì — chỉ cần là 1 URL fetch được,
// bất kể cùng origin (`/nhacnen/...`, bài cũ) hay URL Supabase Storage (bài admin mới upload).

import { bgmService } from '@/services/bgm/bgm.service';

export interface BgmLibraryTrack {
  id: string;
  /** Tên hiển thị cho người dùng chọn */
  name: string;
  /** Tâm trạng/thể loại — hiển thị cạnh tên */
  mood: string;
  /** URL fetch được — public asset cũ hoặc URL Supabase Storage */
  assetPath: string;
  /** Tên file gốc — dùng làm tên hiển thị khi lưu/nhận diện đuôi file cho FFmpeg */
  fileName: string;
}

export async function fetchBgmLibraryTracks(): Promise<BgmLibraryTrack[]> {
  const tracks = await bgmService.list();
  return tracks.map((t) => ({
    id: t.id,
    name: t.name,
    mood: t.mood,
    assetPath: t.assetUrl,
    fileName: t.fileName,
  }));
}

export function findBgmLibraryTrack(
  tracks: BgmLibraryTrack[],
  id: string | null,
): BgmLibraryTrack | undefined {
  if (!id) return undefined;
  return tracks.find((t) => t.id === id);
}
