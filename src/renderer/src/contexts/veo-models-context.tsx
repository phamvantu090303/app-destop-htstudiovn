'use client';

import {
  createContext,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react';
import { API_KEY_IDS, API_KEYS_CHANGED_EVENT, getApiKey } from '@/lib/api-keys/api-keys-store';
import { KIE_VEO_MODEL_OPTIONS, type VeoModelOption } from '@/lib/veo/veo-models';

interface VeoModelsContextValue {
  models: VeoModelOption[];
  loading: boolean;
  error: string | null;
  /**
   * Nhà cung cấp 'veo' (mặc định, qua kie.ai) — LUÔN `true`: key giờ do admin quản lý ở server,
   * không còn phụ thuộc key phía client nữa. Danh sách model là hằng số `KIE_VEO_MODEL_OPTIONS`
   * (kie.ai không có endpoint discovery thật), không cần fetch/loading/error.
   */
  hasKey: boolean;
  /** Đã có "Gemini Key Veo 3.1" — key riêng của nhà cung cấp 'veo-gemini' */
  hasVeoGeminiKey: boolean;
  refetch: () => Promise<void>;
}

const VeoModelsContext = createContext<VeoModelsContextValue | null>(null);

/** Provider duy nhất — toàn app chỉ 1 nguồn model Veo */
export function VeoModelsProvider({ children }: { children: ReactNode }) {
  const [hasVeoGeminiKey, setHasVeoGeminiKey] = useState(false);

  useEffect(() => {
    const check = () => setHasVeoGeminiKey(Boolean(getApiKey(API_KEY_IDS.veoGemini).trim()));
    check();
    window.addEventListener(API_KEYS_CHANGED_EVENT, check);
    return () => window.removeEventListener(API_KEYS_CHANGED_EVENT, check);
  }, []);

  const value = useMemo(
    () => ({
      models: KIE_VEO_MODEL_OPTIONS,
      loading: false,
      error: null,
      hasKey: true,
      hasVeoGeminiKey,
      refetch: async () => {},
    }),
    [hasVeoGeminiKey],
  );

  return (
    <VeoModelsContext.Provider value={value}>
      {children}
    </VeoModelsContext.Provider>
  );
}

export function useVeoModels(): VeoModelsContextValue {
  const ctx = useContext(VeoModelsContext);
  if (!ctx) {
    throw new Error('useVeoModels must be used within VeoModelsProvider');
  }
  return ctx;
}
