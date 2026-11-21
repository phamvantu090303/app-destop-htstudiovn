import { useEffect, useState } from 'react';

/** Trả về `value` sau khi ngừng thay đổi `delayMs` — dùng cho search input tránh filter mỗi keystroke. */
export function useDebounce<T>(value: T, delayMs = 300): T {
  const [debounced, setDebounced] = useState(value);

  useEffect(() => {
    const timer = setTimeout(() => setDebounced(value), delayMs);
    return () => clearTimeout(timer);
  }, [value, delayMs]);

  return debounced;
}
