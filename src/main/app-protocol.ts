import { net, protocol } from 'electron';
import { join, normalize, sep } from 'node:path';
import { pathToFileURL } from 'node:url';

/**
 * The UI is served from `htstudio://app/` instead of `file://`.
 *
 * Why: the Studio uses ffmpeg.wasm, which spawns a module Worker from
 * `${window.location.origin}/ffmpeg/ffmpeg-worker.js`. Under `file://` the origin is opaque
 * and that URL is invalid. A "standard" + "secure" custom scheme behaves like https.
 */
export const APP_SCHEME = 'htstudio';
export const APP_HOST = 'app';
export const APP_ORIGIN = `${APP_SCHEME}://${APP_HOST}`;

/**
 * Applied to every file served by the app protocol (packaged builds only).
 * - 'wasm-unsafe-eval' + blob:  ffmpeg.wasm compiles its core from a blob: URL
 * - cdn.jsdelivr.net            ffmpeg core download (see lib/video-library/ffmpeg-client.ts)
 * - https: in img/media/connect  scene thumbnails, videos and the backend/Supabase APIs
 */
const CONTENT_SECURITY_POLICY = [
  "default-src 'self'",
  "script-src 'self' 'wasm-unsafe-eval' blob: https://cdn.jsdelivr.net",
  "worker-src 'self' blob:",
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data: blob: https:",
  "media-src 'self' blob: https:",
  "font-src 'self' data:",
  // http only for loopback: lets a built app talk to a backend running on this machine.
  "connect-src 'self' blob: data: https: wss: http://localhost:* http://127.0.0.1:*",
  "object-src 'none'",
  "base-uri 'self'",
  "form-action 'none'",
].join('; ');

/** Must run before `app.whenReady()`. */
export function registerAppScheme(): void {
  protocol.registerSchemesAsPrivileged([
    {
      scheme: APP_SCHEME,
      privileges: { standard: true, secure: true, supportFetchAPI: true, corsEnabled: true, stream: true },
    },
  ]);
}

/** Serve the built renderer (`out/renderer`) over the app scheme. Call after `app.whenReady()`. */
export function serveRenderer(rendererDir: string): void {
  const root = normalize(rendererDir);

  protocol.handle(APP_SCHEME, async (request) => {
    const url = new URL(request.url);
    if (url.hostname !== APP_HOST) {
      return new Response('Not found', { status: 404 });
    }

    const pathname = decodeURIComponent(url.pathname);
    const filePath = normalize(join(root, pathname === '/' ? 'index.html' : pathname));

    // Never serve anything outside the renderer folder (e.g. `htstudio://app/..%2f..%2fsecret`).
    if (filePath !== root && !filePath.startsWith(root + sep)) {
      return new Response('Forbidden', { status: 403 });
    }

    try {
      const response = await net.fetch(pathToFileURL(filePath).toString());
      const headers = new Headers(response.headers);
      headers.set('Content-Security-Policy', CONTENT_SECURITY_POLICY);
      return new Response(response.body, { status: response.status, statusText: response.statusText, headers });
    } catch {
      return new Response('Not found', { status: 404 });
    }
  });
}
