import { useEffect, useState } from 'react';
import { API_KEY_IDS, API_KEYS_CHANGED_EVENT, getApiKey, isApiKeysReady } from '@/lib/api-keys/api-keys-store';

/** true nếu tài khoản đã đăng nhập xong nhưng CHƯA cấu hình bất kỳ API key nào (gemini/kie/
 *  elevenlabs/veo-gemini) — dùng cho chấm cảnh báo cạnh mục "API Keys" trong sidebar. */
export function useMissingApiKeyWarning(): boolean {
  const [missing, setMissing] = useState(false);

  useEffect(() => {
    const check = () => {
      if (!isApiKeysReady()) {
        setMissing(false);
        return;
      }
      const hasAny = Object.values(API_KEY_IDS).some((id) => getApiKey(id).length > 0);
      setMissing(!hasAny);
    };
    check();
    window.addEventListener(API_KEYS_CHANGED_EVENT, check);
    return () => window.removeEventListener(API_KEYS_CHANGED_EVENT, check);
  }, []);

  return missing;
}
