// ─── Theme sáng/tối — bật qua class `.light` trên <html> (mặc định = tối, xem globals.css) ──

export type Theme = 'dark' | 'light';

export const THEME_STORAGE_KEY = 'web-video:theme';

/** Chuỗi JS chạy trước hydrate (xem app/layout.tsx, next/script beforeInteractive) — đọc
 *  localStorage và gắn class .light NGAY, tránh flash sáng→tối (hoặc ngược lại) lúc tải trang. */
export const THEME_INIT_SCRIPT = `
(function () {
  try {
    if (localStorage.getItem('${THEME_STORAGE_KEY}') === 'light') {
      document.documentElement.classList.add('light');
    }
  } catch (e) {}
})();
`;

export function getStoredTheme(): Theme {
  try {
    return window.localStorage.getItem(THEME_STORAGE_KEY) === 'light' ? 'light' : 'dark';
  } catch {
    return 'dark';
  }
}

/** Áp dụng theme lên <html> + lưu lại — gọi khi user đổi lựa chọn */
export function applyTheme(theme: Theme): void {
  document.documentElement.classList.toggle('light', theme === 'light');
  try {
    window.localStorage.setItem(THEME_STORAGE_KEY, theme);
  } catch {
    // localStorage có thể bị chặn (chế độ riêng tư nghiêm ngặt) — bỏ qua, theme vẫn áp dụng
    // cho phiên hiện tại, chỉ không nhớ lại lần sau
  }
}
