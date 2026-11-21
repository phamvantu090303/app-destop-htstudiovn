import { contextBridge, ipcRenderer, type IpcRendererEvent } from 'electron';
import { IPC, type AuthCallbackPayload, type HtApi } from '../shared/ipc';

const api: HtApi = {
  getAppInfo: () => ipcRenderer.invoke(IPC.appInfo),

  openExternal: (url) => ipcRenderer.invoke(IPC.openExternal, url),

  onAuthCallback: (listener) => {
    const handler = (_event: IpcRendererEvent, payload: AuthCallbackPayload): void => listener(payload);
    ipcRenderer.on(IPC.authCallback, handler);
    // Tell main we are listening so it can deliver a redirect that arrived earlier.
    ipcRenderer.send(IPC.authReady);
    return () => {
      ipcRenderer.removeListener(IPC.authCallback, handler);
    };
  },
};

contextBridge.exposeInMainWorld('ht', api);
