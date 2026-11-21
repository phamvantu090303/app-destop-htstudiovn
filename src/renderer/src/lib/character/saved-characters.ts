// ─── Kiểu dữ liệu nhân vật đã lưu ───────────────────────────────────────────

export interface SavedCharacter {
  id: string;
  name: string;
  role: string;
  traits: string;
  outfit: string;
  description: string;
  style: string;
  createdAt: string;
  updatedAt: string;
  /**
   * Ảnh tham chiếu nhân vật hiển thị trên UI — signed URL từ Supabase Storage (tạo lại mỗi
   * lần load, KHÔNG lưu DB) hoặc base64 local tạm trong lúc đang upload (xem
   * CharacterMaster.handleAvatarChange). Nguồn bền vững thật sự là `avatarPath`.
   */
  avatarDataUrl?: string;
  /**
   * Path ảnh nhân vật trong Supabase Storage bucket `source-uploads` — nguồn bền vững DUY
   * NHẤT, lưu vào `video_characters.avatar_url`, còn lại sau F5/đăng nhập máy khác. KHÔNG
   * dùng URL kie.ai để lưu lâu dài — kie.ai chỉ host ảnh tạm, hết hạn sau một thời gian.
   */
  avatarPath?: string;
}

/** Style nhân vật — dropdown mục 1 (value gửi API giữ tiếng Anh; UI hiện thêm tiếng Việt) */
export interface CharacterStyleOption {
  value: string;
  labelVi: string;
}

export const STYLE_OPTIONS: CharacterStyleOption[] = [
  { value: 'Realistic', labelVi: 'Chân thực' },
  { value: 'Anime / Manga', labelVi: 'Hoạt hình Nhật' },
  { value: 'Cartoon', labelVi: 'Hoạt hình' },
  { value: 'Cinematic', labelVi: 'Điện ảnh' },
  { value: 'Oil Painting', labelVi: 'Tranh sơn dầu' },
  { value: 'Watercolor', labelVi: 'Màu nước' },
  { value: 'Flat Design', labelVi: 'Thiết kế phẳng' },
  { value: 'Cyberpunk', labelVi: 'Tương lai' },
];

/** Nhãn hiển thị trên UI — ví dụ: Realistic (Chân thực) */
export function formatCharacterStyleLabel(value: string): string {
  const option = STYLE_OPTIONS.find((o) => o.value === value);
  return option ? `${option.value} (${option.labelVi})` : value;
}

/** Giới hạn số nhân vật tối đa trong một project */
export const MAX_CHARACTERS = 8;

/** Sinh id nhân vật duy nhất: `char-{timestamp}-{random}` */
export function generateCharacterId(): string {
  return `char-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
}

/** Tạo SavedCharacter rỗng với style Realistic và timestamp hiện tại */
export function createEmptyCharacter(): SavedCharacter {
  const now = new Date().toISOString();
  return {
    id: generateCharacterId(),
    name: '',
    role: '',
    traits: '',
    outfit: '',
    description: '',
    style: 'Realistic',
    createdAt: now,
    updatedAt: now,
  };
}

/** Tên hiển thị trên UI — fallback "Nhân vật mới" nếu trống */
export function characterDisplayName(name: string): string {
  const trimmed = name.trim();
  return trimmed || 'Nhân vật mới';
}

export interface CharacterFieldErrors {
  name?: string;
  description?: string;
}

/** Validate tên và mô tả nhân vật — trả object lỗi theo field */
export function validateCharacterFields(
  name: string,
  description: string,
): CharacterFieldErrors {
  const errors: CharacterFieldErrors = {};
  const trimmedName = name.trim();

  if (!trimmedName) {
    errors.name = 'Tên nhân vật không được để trống.';
  } else if (trimmedName.length < 2) {
    errors.name = `Tên quá ngắn — cần ít nhất 2 ký tự (hiện tại: ${trimmedName.length}).`;
  } else if (trimmedName.length > 60) {
    errors.name = `Tên quá dài — tối đa 60 ký tự (hiện tại: ${trimmedName.length}).`;
  }

  return errors;
}
