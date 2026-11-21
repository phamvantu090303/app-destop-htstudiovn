// ─── Cài đặt chung không gắn tài khoản (ngôn ngữ hiển thị, toggle UI) — lưu localStorage theo
// đúng pattern `lib/theme.ts` đã dùng cho theme sáng/tối. KHÔNG đồng bộ Supabase vì đây chỉ là
// tuỳ chọn hiển thị cục bộ trên thiết bị, không phải dữ liệu nghiệp vụ cần theo tài khoản.

export interface GeneralPreferences {
  language: string;
  sound: boolean;
  autosave: boolean;
  tips: boolean;
}

const STORAGE_KEY = 'web-video:general-preferences';

export const DEFAULT_PREFERENCES: GeneralPreferences = {
  language: 'vi',
  sound: true,
  autosave: true,
  tips: false,
};

export function getStoredPreferences(): GeneralPreferences {
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return DEFAULT_PREFERENCES;
    return { ...DEFAULT_PREFERENCES, ...JSON.parse(raw) };
  } catch {
    return DEFAULT_PREFERENCES;
  }
}

/** Lưu lại lựa chọn — gọi khi user bấm "Lưu thay đổi" ở GeneralSettings */
export function savePreferences(prefs: GeneralPreferences): void {
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(prefs));
  } catch {
    // localStorage có thể bị chặn (chế độ riêng tư nghiêm ngặt) — bỏ qua, lựa chọn vẫn áp dụng
    // cho phiên hiện tại, chỉ không nhớ lại lần sau.
  }
}
