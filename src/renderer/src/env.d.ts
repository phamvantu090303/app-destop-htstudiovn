/// <reference types="vite/client" />

import type { HtApi } from '@shared/ipc';

declare global {
  interface ImportMetaEnv {
    /** Backend API base URL, must end with /api. */
    readonly VITE_API_URL?: string;
    readonly VITE_SUPABASE_URL?: string;
    readonly VITE_SUPABASE_ANON_KEY?: string;
    /** Website opened by "Về trang chủ" links. */
    readonly VITE_SITE_URL?: string;
    /** DEV ONLY: "true" = vào Studio không cần đăng nhập (chỉ có tác dụng khi chạy `npm run dev`). */
    readonly VITE_DEV_SKIP_AUTH?: string;
  }

  /** There is no real `process` in the renderer: `process.env.NODE_ENV` is replaced at build time
   *  (`define` in electron.vite.config.ts). Only that one property may be used. */
  var process: { readonly env: { readonly NODE_ENV: 'development' | 'production' } };

  interface Window {
    /** Exposed by the preload script (src/preload/index.ts). */
    ht: HtApi;
  }
}
