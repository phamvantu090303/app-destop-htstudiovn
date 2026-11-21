// ─── Xử lý ảnh Direct Veo — validate + resize (Canvas API) + base64 hoá ────────────────
// Xem docs/BUILD PROMPT.md §8. Client-side only, không thêm dependency mới.
//
// LƯU Ý BẢO MẬT: check MIME allowlist + magic bytes dưới đây là UX/an toàn nhẹ PHÍA CLIENT,
// KHÔNG phải kiểm soát bảo mật thật — hoàn toàn có thể bypass bằng cách sửa request trực tiếp
// (vd DevTools/curl). Backend hiện chỉ chuyển tiếp base64 đã nhận tới Veo, không tự re-validate.
// Nếu sau này cần kiểm soát bảo mật thật, phải validate lại ở SERVER — việc đó nằm ngoài scope
// của Direct Veo (§2: không sửa backend).

export const DIRECT_VEO_MAX_IMAGE_MB = 5;
export const DIRECT_VEO_IMAGE_MIME = ['image/jpeg', 'image/png', 'image/webp'] as const;
export const DIRECT_VEO_MAX_DIMENSION = 1920;
export const DIRECT_VEO_MIN_RECOMMENDED_EDGE = 720;

export interface DirectVeoResolvedImage {
  base64: string;
  mimeType: string;
  previewUrl: string;
  /** Ảnh gốc nhỏ hơn khuyến nghị — không chặn, chỉ để UI cảnh báo nhẹ nếu muốn */
  belowRecommendedSize: boolean;
}

export type DirectVeoImageResult =
  | ({ ok: true } & DirectVeoResolvedImage)
  | { ok: false; message: string };

const MAGIC_BYTES: Array<{ mime: string; check: (bytes: Uint8Array) => boolean }> = [
  { mime: 'image/jpeg', check: (b) => b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff },
  { mime: 'image/png', check: (b) => b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47 },
  {
    mime: 'image/webp',
    check: (b) => b[0] === 0x52 && b[1] === 0x49 && b[2] === 0x46 && b[3] === 0x46
      && b[8] === 0x57 && b[9] === 0x45 && b[10] === 0x42 && b[11] === 0x50,
  },
];

async function readMagicBytes(file: File): Promise<Uint8Array> {
  const buf = await file.slice(0, 12).arrayBuffer();
  return new Uint8Array(buf);
}

function loadImageBitmapOrElement(file: File): Promise<{ width: number; height: number; draw: (ctx: CanvasRenderingContext2D, w: number, h: number) => void; cleanup: () => void }> {
  if (typeof createImageBitmap === 'function') {
    return createImageBitmap(file).then((bitmap) => ({
      width: bitmap.width,
      height: bitmap.height,
      draw: (ctx, w, h) => ctx.drawImage(bitmap, 0, 0, w, h),
      cleanup: () => bitmap.close(),
    }));
  }
  // Fallback Safari cũ / môi trường không có createImageBitmap
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => {
      resolve({
        width: img.naturalWidth,
        height: img.naturalHeight,
        draw: (ctx, w, h) => ctx.drawImage(img, 0, 0, w, h),
        cleanup: () => URL.revokeObjectURL(url),
      });
    };
    img.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error('decode-failed'));
    };
    img.src = url;
  });
}

/**
 * Đọc + validate + resize (maxWidth/maxHeight 1920, giữ tỷ lệ) + re-encode JPEG q0.9 + base64
 * hoá 1 ảnh. Re-encode tự strip EXIF (GPS/thiết bị) — bảo mật miễn phí, không cần lib riêng.
 */
export async function readDirectVeoImage(file: File): Promise<DirectVeoImageResult> {
  if (!DIRECT_VEO_IMAGE_MIME.includes(file.type as (typeof DIRECT_VEO_IMAGE_MIME)[number])) {
    return { ok: false, message: `Định dạng "${file.type || 'không xác định'}" không được hỗ trợ — chỉ nhận JPEG, PNG hoặc WebP.` };
  }

  const maxBytes = DIRECT_VEO_MAX_IMAGE_MB * 1024 * 1024;
  if (file.size > maxBytes) {
    return { ok: false, message: `Ảnh "${file.name}" nặng ${(file.size / 1024 / 1024).toFixed(1)}MB, vượt giới hạn ${DIRECT_VEO_MAX_IMAGE_MB}MB.` };
  }

  const magic = await readMagicBytes(file);
  const matched = MAGIC_BYTES.some((m) => m.check(magic));
  if (!matched) {
    return { ok: false, message: `File "${file.name}" không phải ảnh hợp lệ (nội dung không khớp định dạng khai báo).` };
  }

  let source: Awaited<ReturnType<typeof loadImageBitmapOrElement>>;
  try {
    source = await loadImageBitmapOrElement(file);
  } catch {
    return { ok: false, message: `Không đọc được ảnh "${file.name}" — thử ảnh khác.` };
  }

  const scale = Math.min(1, DIRECT_VEO_MAX_DIMENSION / Math.max(source.width, source.height));
  const targetW = Math.round(source.width * scale);
  const targetH = Math.round(source.height * scale);

  const canvas = document.createElement('canvas');
  canvas.width = targetW;
  canvas.height = targetH;
  const ctx = canvas.getContext('2d');
  if (!ctx) {
    source.cleanup();
    return { ok: false, message: 'Trình duyệt không hỗ trợ xử lý ảnh (Canvas 2D không khả dụng).' };
  }
  // Flatten nền trắng trước khi vẽ — tránh mất alpha của PNG khi re-encode ra JPEG.
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, targetW, targetH);
  source.draw(ctx, targetW, targetH);
  source.cleanup();

  const dataUrl = canvas.toDataURL('image/jpeg', 0.9);
  const commaIndex = dataUrl.indexOf(',');
  const base64 = dataUrl.slice(commaIndex + 1);

  const previewUrl = URL.createObjectURL(file);
  const belowRecommendedSize = Math.min(source.width, source.height) < DIRECT_VEO_MIN_RECOMMENDED_EDGE;

  return { ok: true, base64, mimeType: 'image/jpeg', previewUrl, belowRecommendedSize };
}
