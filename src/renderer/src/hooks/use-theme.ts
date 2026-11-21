import { useCallback, useEffect, useState } from 'react';
import { applyTheme, getStoredTheme, type Theme } from '@/lib/theme';

/** Đọc theme đã lưu (đồng bộ với class .light mà THEME_INIT_SCRIPT đã gắn sẵn trước hydrate)
 *  + hàm đổi theme áp dụng ngay lập tức (không cần "Lưu rồi tải lại trang" như trước). */
export function useTheme() {
  const [theme, setThemeState] = useState<Theme>('dark');

  useEffect(() => {
    setThemeState(getStoredTheme());
  }, []);

  const setTheme = useCallback((next: Theme) => {
    setThemeState(next);
    applyTheme(next);
  }, []);

  return { theme, setTheme };
}
