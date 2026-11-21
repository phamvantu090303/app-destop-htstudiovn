import { session } from 'electron';

/**
 * The backend only allows CORS from the web app's origin (FRONTEND_URL). The desktop UI has a
 * different origin (`htstudio://app`, or the Vite dev server), so the browser would block every
 * API call. Instead of touching the backend, rewrite the CORS header on responses coming from
 * the API origin so that it matches *our own* renderer origin — and nothing else.
 */
export function allowApiCorsFor(apiUrl: string, rendererOrigin: string): void {
  let apiOrigin: string;
  try {
    apiOrigin = new URL(apiUrl).origin;
  } catch {
    return; // Invalid VITE_API_URL: nothing to do, the renderer will show a connection error.
  }

  const replaced = new Set(['access-control-allow-origin', 'access-control-allow-credentials']);

  session.defaultSession.webRequest.onHeadersReceived({ urls: [`${apiOrigin}/*`] }, (details, callback) => {
    const headers: Record<string, string | string[]> = {};
    for (const [name, value] of Object.entries(details.responseHeaders ?? {})) {
      if (!replaced.has(name.toLowerCase())) headers[name] = value;
    }
    headers['Access-Control-Allow-Origin'] = rendererOrigin;
    headers['Access-Control-Allow-Credentials'] = 'true';
    callback({ responseHeaders: headers });
  });
}
