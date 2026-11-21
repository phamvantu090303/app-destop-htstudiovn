// ─── FFmpeg.wasm singleton — load core từ CDN cho render client-side ───────────
//
// CHỈ dùng core ĐƠN LUỒNG — đã thử core ĐA LUỒNG (core-mt, cần SharedArrayBuffer qua header
// COOP/COEP) nhưng verify thực tế (browser thật, không chỉ đọc code) phát hiện core-mt bị TREO
// VĨNH VIỄN giữa lúc exec() ở môi trường này (dừng hẳn ở frame đầu tiên, speed=0x, không bao giờ
// tiến triển hay throw lỗi để fallback được) — đúng triệu chứng user báo cáo (render đợi >30
// phút không xong, không đổi gì). @ffmpeg/ffmpeg không gắn `worker.onerror`, nên 1 khi core-mt
// bị treo kiểu này, không có cách nào tự phục hồi/fallback — phải loại bỏ hẳn nhánh core-mt thay
// vì chỉ "thử rồi fallback nếu lỗi" như trước (fallback chỉ xử lý được lỗi NÉM RA, không xử lý
// được TREO). Core đơn luồng đã verify chạy ổn định, nhanh (exec xong trong mili-giây với clip
// test) — đủ dùng cho video ngắn (vài cảnh, vài giây/cảnh) của app này.

import { FFmpeg } from '@ffmpeg/ffmpeg';
import { fetchFile, toBlobURL } from '@ffmpeg/util';

let ffmpegInstance: FFmpeg | null = null;
let loadPromise: Promise<FFmpeg> | null = null;

const CORE_VERSION = '0.12.6';
// BẮT BUỘC dùng build /dist/esm/, KHÔNG phải /dist/umd/ — `ffmpeg.load({coreURL, ...})` truyền
// coreURL TÙY CHỈNH (không phải mặc định) nên worker.js (bên trong gói @ffmpeg/ffmpeg) sẽ luôn
// đi vào nhánh fallback `await import(coreURL)` (vì `importScripts()` KHÔNG chạy được trong
// module Worker — worker luôn được tạo với `{type:'module'}`). Nhánh fallback này lấy default
// export của module vừa import (`.default`) để gán vào `self.createFFmpegCore` — bản UMD (dist/
// umd) KHÔNG hề có `export default` (chỉ gán qua `module.exports`/`define`/`exports`, không có
// nhánh gán global khi chạy trong ES module) nên `self.createFFmpegCore` luôn `undefined` →
// ffmpeg.load() luôn throw ERROR_IMPORT_FAILURE, toàn bộ tính năng render (mục 4) không chạy
// được. Bản /dist/esm/ có `export default createFFmpegCore` nên nhánh fallback hoạt động đúng.
// Đã verify trực tiếp bằng ffmpeg.wasm thật (Worker + blob core) — xem lịch sử debug liên quan.
const CORE_BASE = `https://cdn.jsdelivr.net/npm/@ffmpeg/core@${CORE_VERSION}/dist/esm`;

// worker.js GỐC của @ffmpeg/ffmpeg (node_modules/@ffmpeg/ffmpeg/dist/esm/worker.js) chứa dòng
// `await import(/* @vite-ignore */ _coreURL)` — `_coreURL` là blob: URL runtime, không thể biết
// trước lúc build. `@vite-ignore` chỉ tắt cảnh báo của Vite; Next.js (Turbopack lúc `next dev`,
// webpack lúc `next build`) đều xử lý dynamic import này và không hiểu `@vite-ignore`, cố biến
// `import(_coreURL)` thành module tĩnh, thất bại lúc runtime với lỗi "Cannot find module as
// expression is too dynamic". Sửa bằng cách dùng 1 bản worker.js RIÊNG đặt tại
// `public/ffmpeg/ffmpeg-worker.js` — Next.js phục vụ nguyên văn (KHÔNG đưa qua bundler) nên dynamic
// import ở đó chạy đúng native. Truyền qua `classWorkerURL` (option có sẵn của FFmpeg.load(), xem
// node_modules/@ffmpeg/ffmpeg/dist/esm/classes.js) để dùng file này thay vì worker.js đóng gói sẵn.
//
// PHẢI là URL TUYỆT ĐỐI có origin (KHÔNG phải path tương đối như '/ffmpeg/...') — classes.js
// resolve qua `new URL(classWorkerURL, import.meta.url)`; với Turbopack (dev), `import.meta.url`
// của code trong node_modules được set thành 1 URL `file://` (đường dẫn nguồn thật trên đĩa),
// KHÔNG phải origin http(s) của trang. `new URL('/ffmpeg/...', 'file:///...')` do đó resolve
// nhầm thành `file:///ffmpeg/...` → tạo Worker bị trình duyệt chặn vì khác origin với trang
// (SecurityError). Truyền URL tuyệt đối (có origin) khiến `new URL(url, base)` bỏ qua hẳn `base`
// (đúng theo spec URL) — luôn resolve đúng origin thật của trang bất kể `import.meta.url` là gì.
function resolveClassWorkerURL(): string {
  return `${window.location.origin}/ffmpeg/ffmpeg-worker.js`;
}

/** Khởi tạo FFmpeg.wasm singleton — core đơn luồng, tái sử dụng giữa các lần render */
export async function getFFmpeg(onLog?: (msg: string) => void): Promise<FFmpeg> {
  if (ffmpegInstance?.loaded) return ffmpegInstance;

  if (!loadPromise) {
    loadPromise = (async () => {
      const ffmpeg = new FFmpeg();
      ffmpeg.on('log', ({ message }) => onLog?.(message));
      await ffmpeg.load({
        classWorkerURL: resolveClassWorkerURL(),
        coreURL: await toBlobURL(`${CORE_BASE}/ffmpeg-core.js`, 'text/javascript'),
        wasmURL: await toBlobURL(`${CORE_BASE}/ffmpeg-core.wasm`, 'application/wasm'),
      });
      ffmpegInstance = ffmpeg;
      return ffmpeg;
    })();
  }

  return loadPromise;
}

/** Re-export fetchFile từ @ffmpeg/util — tải URL/blob thành Uint8Array cho writeFile */
export { fetchFile };
