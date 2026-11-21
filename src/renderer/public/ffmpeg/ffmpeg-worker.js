// ─── Worker riêng cho @ffmpeg/ffmpeg — served RAW như static asset (KHÔNG qua webpack) ───
//
// Bản gốc: node_modules/@ffmpeg/ffmpeg/dist/esm/worker.js (đã inline const.js + errors.js vào
// đây, bỏ mọi `import` tương đối — tự chứa hoàn toàn). Lý do phải có bản riêng này thay vì
// dùng thẳng worker.js gốc của thư viện:
//
// worker.js gốc có dòng: `self.createFFmpegCore = (await import(/* @vite-ignore */ _coreURL)).default`
// — `_coreURL` là URL hoàn toàn động (blob: URL runtime, không biết trước lúc build). `@vite-ignore`
// chỉ tắt cảnh báo của Vite; Next.js dùng webpack để bundle worker.js (vì nó được nạp qua
// `new Worker(new URL("./worker.js", import.meta.url), {type:"module"})` — webpack CÓ xử lý cả
// module Worker này). Webpack không hiểu `@vite-ignore`, cố biến `import(_coreURL)` thành một
// "context module" (bảng tra module tĩnh) — vì `_coreURL` không khớp gì lúc build, ném lỗi runtime
// "Cannot find module as expression is too dynamic".
//
// Cách sửa: đặt bản sao TỰ CHỨA này trong `public/` — Next.js phục vụ nguyên văn (KHÔNG đưa qua
// webpack), nên `import(_coreURL)` ở đây không hề bị webpack đụng tới, chạy đúng như trình duyệt
// native ES module dynamic import. Truyền `classWorkerURL: '/ffmpeg/ffmpeg-worker.js'` vào
// `ffmpeg.load()` (xem ffmpeg-client.ts) để dùng file này thay vì worker.js đóng gói sẵn trong gói.
//
// PHẢI cập nhật lại nếu nâng cấp @ffmpeg/ffmpeg lên version có worker.js đổi logic.

const FFMessageType = {
  LOAD: 'LOAD',
  EXEC: 'EXEC',
  FFPROBE: 'FFPROBE',
  WRITE_FILE: 'WRITE_FILE',
  READ_FILE: 'READ_FILE',
  DELETE_FILE: 'DELETE_FILE',
  RENAME: 'RENAME',
  CREATE_DIR: 'CREATE_DIR',
  LIST_DIR: 'LIST_DIR',
  DELETE_DIR: 'DELETE_DIR',
  ERROR: 'ERROR',
  DOWNLOAD: 'DOWNLOAD',
  PROGRESS: 'PROGRESS',
  LOG: 'LOG',
  MOUNT: 'MOUNT',
  UNMOUNT: 'UNMOUNT',
};

const ERROR_UNKNOWN_MESSAGE_TYPE = new Error('unknown message type');
const ERROR_NOT_LOADED = new Error('ffmpeg is not loaded, call `await ffmpeg.load()` first');
const ERROR_IMPORT_FAILURE = new Error('failed to import ffmpeg-core.js');

let ffmpeg;

const load = async ({ coreURL: _coreURL, wasmURL: _wasmURL, workerURL: _workerURL }) => {
  const first = !ffmpeg;
  try {
    // Worker này luôn `type: "module"` — importScripts() luôn throw, rơi thẳng xuống catch.
    // Giữ nhánh này để hành vi khớp 100% với worker.js gốc, dù thực tế không bao giờ chạy tới.
    importScripts(_coreURL);
  } catch {
    // ffmpeg-client.ts LUÔN truyền coreURL riêng (blob: URL trỏ tới bản /dist/esm/ — có
    // `export default`) — .default ở đây luôn lấy được giá trị hợp lệ.
    self.createFFmpegCore = (await import(/* webpackIgnore: true */ _coreURL)).default;
    if (!self.createFFmpegCore) {
      throw ERROR_IMPORT_FAILURE;
    }
  }
  const coreURL = _coreURL;
  const wasmURL = _wasmURL ? _wasmURL : _coreURL.replace(/.js$/g, '.wasm');
  const workerURL = _workerURL ? _workerURL : _coreURL.replace(/.js$/g, '.worker.js');
  ffmpeg = await self.createFFmpegCore({
    mainScriptUrlOrBlob: `${coreURL}#${btoa(JSON.stringify({ wasmURL, workerURL }))}`,
  });
  ffmpeg.setLogger((data) => self.postMessage({ type: FFMessageType.LOG, data }));
  ffmpeg.setProgress((data) => self.postMessage({ type: FFMessageType.PROGRESS, data }));
  return first;
};

const exec = ({ args, timeout = -1 }) => {
  ffmpeg.setTimeout(timeout);
  ffmpeg.exec(...args);
  const ret = ffmpeg.ret;
  ffmpeg.reset();
  return ret;
};

const ffprobe = ({ args, timeout = -1 }) => {
  ffmpeg.setTimeout(timeout);
  ffmpeg.ffprobe(...args);
  const ret = ffmpeg.ret;
  ffmpeg.reset();
  return ret;
};

const writeFile = ({ path, data }) => {
  ffmpeg.FS.writeFile(path, data);
  return true;
};

const readFile = ({ path, encoding }) => ffmpeg.FS.readFile(path, { encoding });

const deleteFile = ({ path }) => {
  ffmpeg.FS.unlink(path);
  return true;
};

const rename = ({ oldPath, newPath }) => {
  ffmpeg.FS.rename(oldPath, newPath);
  return true;
};

const createDir = ({ path }) => {
  ffmpeg.FS.mkdir(path);
  return true;
};

const listDir = ({ path }) => {
  const names = ffmpeg.FS.readdir(path);
  const nodes = [];
  for (const name of names) {
    const stat = ffmpeg.FS.stat(`${path}/${name}`);
    const isDir = ffmpeg.FS.isDir(stat.mode);
    nodes.push({ name, isDir });
  }
  return nodes;
};

const deleteDir = ({ path }) => {
  ffmpeg.FS.rmdir(path);
  return true;
};

const mount = ({ fsType, options, mountPoint }) => {
  const fs = ffmpeg.FS.filesystems[fsType];
  if (!fs) return false;
  ffmpeg.FS.mount(fs, options, mountPoint);
  return true;
};

const unmount = ({ mountPoint }) => {
  ffmpeg.FS.unmount(mountPoint);
  return true;
};

self.onmessage = async ({ data: { id, type, data: _data } }) => {
  const trans = [];
  let data;
  try {
    if (type !== FFMessageType.LOAD && !ffmpeg) throw ERROR_NOT_LOADED;
    switch (type) {
      case FFMessageType.LOAD:
        data = await load(_data);
        break;
      case FFMessageType.EXEC:
        data = exec(_data);
        break;
      case FFMessageType.FFPROBE:
        data = ffprobe(_data);
        break;
      case FFMessageType.WRITE_FILE:
        data = writeFile(_data);
        break;
      case FFMessageType.READ_FILE:
        data = readFile(_data);
        break;
      case FFMessageType.DELETE_FILE:
        data = deleteFile(_data);
        break;
      case FFMessageType.RENAME:
        data = rename(_data);
        break;
      case FFMessageType.CREATE_DIR:
        data = createDir(_data);
        break;
      case FFMessageType.LIST_DIR:
        data = listDir(_data);
        break;
      case FFMessageType.DELETE_DIR:
        data = deleteDir(_data);
        break;
      case FFMessageType.MOUNT:
        data = mount(_data);
        break;
      case FFMessageType.UNMOUNT:
        data = unmount(_data);
        break;
      default:
        throw ERROR_UNKNOWN_MESSAGE_TYPE;
    }
  } catch (e) {
    self.postMessage({ id, type: FFMessageType.ERROR, data: e.toString() });
    return;
  }
  if (data instanceof Uint8Array) {
    trans.push(data.buffer);
  }
  self.postMessage({ id, type, data }, trans);
};
