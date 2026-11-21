import { app } from 'electron';
import { resolve } from 'node:path';
import { AUTH_CALLBACK_URL, type AuthCallbackPayload } from '../shared/ipc';
import { APP_SCHEME } from './app-protocol';

// Google sign-in runs in the system browser and returns to the app through
// `htstudio://auth/callback?code=...` (AUTH_CALLBACK_URL, shared with the renderer).

/** Register this app as the OS handler for `htstudio://` links. */
export function registerDeepLinkHandler(): void {
  if (process.defaultApp) {
    // Running via `electron .` (dev): Windows needs the script path to relaunch correctly.
    if (process.argv.length >= 2) {
      app.setAsDefaultProtocolClient(APP_SCHEME, process.execPath, [resolve(process.argv[1])]);
    }
  } else {
    app.setAsDefaultProtocolClient(APP_SCHEME);
  }
}

/** Find an auth deep link in a command line (Windows/Linux pass it as an argument). */
export function findAuthDeepLink(argv: readonly string[]): string | undefined {
  return argv.find((arg) => arg.startsWith(AUTH_CALLBACK_URL));
}

/**
 * Parse an incoming deep link. Anything can launch `htstudio://...`, so only the exact
 * auth callback is accepted and only three known query parameters are passed on.
 * (The code itself is useless without this app's PKCE verifier.)
 */
export function parseAuthCallback(rawUrl: string): AuthCallbackPayload | null {
  let url: URL;
  try {
    url = new URL(rawUrl);
  } catch {
    return null;
  }
  if (url.protocol !== `${APP_SCHEME}:` || url.hostname !== 'auth' || url.pathname !== '/callback') {
    return null;
  }

  const cap = (value: string | null): string | undefined =>
    value === null ? undefined : value.slice(0, 2048);

  return {
    code: cap(url.searchParams.get('code')),
    error: cap(url.searchParams.get('error')),
    errorDescription: cap(url.searchParams.get('error_description')),
  };
}
