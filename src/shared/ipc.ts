// Contract between main, preload and renderer.
// Add new channels here first; TypeScript will then force all three sides to agree.
// This file must stay environment-neutral (no Node or DOM types) — it is compiled for both sides.

/**
 * Where Supabase sends the browser after Google sign-in. The OS routes `htstudio://` links to this app.
 * REQUIRED (one-time, Supabase dashboard): Authentication → URL Configuration → Redirect URLs
 * must contain exactly this value.
 */
export const AUTH_CALLBACK_URL = 'htstudio://auth/callback';

export const IPC = {
  appInfo: 'app:info',
  openExternal: 'shell:open-external',
  /** main -> renderer: Google sign-in finished in the system browser and came back via deep link. */
  authCallback: 'auth:callback',
  /** renderer -> main: a listener is registered, flush any callback that arrived early. */
  authReady: 'auth:ready',
} as const;

export interface AppInfo {
  name: string;
  version: string;
  electron: string;
  chrome: string;
  node: string;
  /** e.g. "win32", "darwin", "linux". */
  platform: string;
}

/** Result of the OAuth redirect, parsed and sanitised by the main process. */
export interface AuthCallbackPayload {
  code?: string;
  error?: string;
  errorDescription?: string;
}

/** API exposed to the renderer as `window.ht` (see preload). */
export interface HtApi {
  getAppInfo(): Promise<AppInfo>;
  /** Open an http(s)/mailto URL in the system browser. Resolves false if the URL was refused. */
  openExternal(url: string): Promise<boolean>;
  /** Subscribe to OAuth redirects. Returns an unsubscribe function. */
  onAuthCallback(listener: (payload: AuthCallbackPayload) => void): () => void;
}
