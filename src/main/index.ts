import { app, BrowserWindow, ipcMain, Menu, session, shell, type IpcMainInvokeEvent } from 'electron';
import { join } from 'node:path';
import { IPC, type AppInfo, type AuthCallbackPayload } from '../shared/ipc';
import { APP_ORIGIN, registerAppScheme, serveRenderer } from './app-protocol';
import { allowApiCorsFor } from './cors';
import { findAuthDeepLink, parseAuthCallback, registerDeepLinkHandler } from './deep-link';

// Must happen before the app is ready.
registerAppScheme();

/**
 * `protocol//host` of a URL. Not `URL.origin`: in Node that is the string "null" for any
 * non-special scheme such as htstudio://, while Chromium (and the CORS `Origin` header) use
 * `htstudio://app`.
 */
function originOf(rawUrl: string): string {
  const { protocol, host } = new URL(rawUrl);
  return `${protocol}//${host}`;
}

/** Set by electron-vite while running `npm run dev`; undefined in built/packaged app. */
const devServerUrl = process.env['ELECTRON_RENDERER_URL'];
const rendererOrigin = devServerUrl ? originOf(devServerUrl) : APP_ORIGIN;

/** Only permissions the Studio really needs; camera, mic, geolocation... are denied. */
const ALLOWED_PERMISSIONS = new Set(['clipboard-sanitized-write', 'fullscreen']);

let mainWindow: BrowserWindow | null = null;

// ── Auth deep link → renderer ────────────────────────────────────────────────────────────────
// The OAuth redirect can arrive before the renderer has subscribed (cold start, reload), so
// it is held here until the renderer announces itself with IPC.authReady.
let rendererListening = false;
let pendingAuthCallback: AuthCallbackPayload | null = null;

function flushAuthCallback(): void {
  if (!pendingAuthCallback || !rendererListening || !mainWindow) return;
  mainWindow.webContents.send(IPC.authCallback, pendingAuthCallback);
  pendingAuthCallback = null;
}

function handleDeepLink(rawUrl: string): void {
  const payload = parseAuthCallback(rawUrl);
  if (!payload) {
    console.warn('[auth] Ignored a htstudio:// link that is not the auth callback.');
    return;
  }
  // Never log the code itself.
  console.info(
    `[auth] Deep link received (code: ${payload.code ? 'yes' : 'no'}, error: ${payload.error ?? 'none'}); ` +
      `renderer ${rendererListening ? 'is listening' : 'not ready yet — queued'}.`,
  );
  pendingAuthCallback = payload;
  flushAuthCallback();
  focusMainWindow();
}

function focusMainWindow(): void {
  if (!mainWindow) return;
  if (mainWindow.isMinimized()) mainWindow.restore();
  mainWindow.show();
  mainWindow.focus();
}

// ── Helpers ──────────────────────────────────────────────────────────────────────────────────

/** Only hand well-known schemes to the OS; never open arbitrary URLs. */
function openExternalSafe(rawUrl: string): boolean {
  try {
    const { protocol } = new URL(rawUrl);
    if (protocol === 'https:' || protocol === 'http:' || protocol === 'mailto:') {
      void shell.openExternal(rawUrl);
      return true;
    }
  } catch {
    // Malformed URL — refuse.
  }
  return false;
}

/** IPC is only honoured when it comes from our own UI, never from a page that got loaded by accident. */
function isTrustedSender(event: IpcMainInvokeEvent | Electron.IpcMainEvent): boolean {
  const frameUrl = event.senderFrame?.url;
  if (!frameUrl) return false;
  try {
    return originOf(frameUrl) === rendererOrigin;
  } catch {
    return false;
  }
}

// ── Window ───────────────────────────────────────────────────────────────────────────────────

function createMainWindow(): BrowserWindow {
  const win = new BrowserWindow({
    width: 1360,
    height: 860,
    minWidth: 1024,
    minHeight: 640,
    show: false,
    title: 'HTStudio',
    backgroundColor: '#090B13',
    autoHideMenuBar: true,
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });

  win.once('ready-to-show', () => win.show());

  // A (re)load wipes the renderer's listeners; it will announce itself again.
  win.webContents.on('did-start-loading', () => {
    rendererListening = false;
  });

  // Any link leaving the app goes to the system browser.
  win.webContents.setWindowOpenHandler(({ url }) => {
    openExternalSafe(url);
    return { action: 'deny' };
  });
  win.webContents.on('will-navigate', (event, url) => {
    let sameOrigin = false;
    try {
      sameOrigin = originOf(url) === rendererOrigin;
    } catch {
      // Malformed — treat as foreign.
    }
    if (!sameOrigin) {
      event.preventDefault();
      openExternalSafe(url);
    }
  });

  win.on('closed', () => {
    mainWindow = null;
    rendererListening = false;
  });

  void win.loadURL(devServerUrl ?? `${APP_ORIGIN}/`);
  return win;
}

function registerIpcHandlers(): void {
  ipcMain.handle(IPC.appInfo, (event): AppInfo => {
    if (!isTrustedSender(event)) throw new Error('Untrusted sender');
    return {
      name: app.getName(),
      version: app.getVersion(),
      electron: process.versions.electron,
      chrome: process.versions.chrome,
      node: process.versions.node,
      platform: process.platform,
    };
  });

  ipcMain.handle(IPC.openExternal, (event, url: unknown): boolean => {
    if (!isTrustedSender(event) || typeof url !== 'string') return false;
    return openExternalSafe(url);
  });

  ipcMain.on(IPC.authReady, (event) => {
    if (!isTrustedSender(event)) return;
    rendererListening = true;
    flushAuthCallback();
  });
}

// ── App lifecycle ────────────────────────────────────────────────────────────────────────────

// macOS delivers deep links as an event (must be registered before ready).
app.on('open-url', (event, url) => {
  event.preventDefault();
  handleDeepLink(url);
});

if (!app.requestSingleInstanceLock()) {
  // Clicking `htstudio://auth/callback?...` in the browser starts a second process: it hands the
  // link to the running instance (below) and exits.
  app.quit();
} else {
  app.on('second-instance', (_event, argv) => {
    const link = findAuthDeepLink(argv);
    if (link) handleDeepLink(link);
    focusMainWindow();
  });

  app.whenReady().then(() => {
    app.setAppUserModelId('vn.htstudio.desktop');

    if (app.isPackaged && process.platform !== 'darwin') {
      Menu.setApplicationMenu(null);
    }

    session.defaultSession.setPermissionRequestHandler((_webContents, permission, callback) => {
      callback(ALLOWED_PERMISSIONS.has(permission));
    });
    session.defaultSession.setPermissionCheckHandler((_webContents, permission) =>
      ALLOWED_PERMISSIONS.has(permission),
    );

    if (!devServerUrl) serveRenderer(join(__dirname, '../renderer'));
    allowApiCorsFor(__API_URL__, rendererOrigin);
    registerDeepLinkHandler();
    registerIpcHandlers();

    mainWindow = createMainWindow();

    app.on('activate', () => {
      if (BrowserWindow.getAllWindows().length === 0) mainWindow = createMainWindow();
    });
  });

  app.on('window-all-closed', () => {
    if (process.platform !== 'darwin') app.quit();
  });
}
