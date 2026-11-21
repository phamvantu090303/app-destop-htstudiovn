// ─── Phụ đề burn-in tự động từ lời thoại (drawtext qua FFmpeg) ─────────────
//
// drawtext của FFmpeg BẮT BUỘC phải có `fontfile` — core FFmpeg.wasm mặc định không kèm
// sẵn font nào (không có fontconfig/hệ thống font như máy thật). Các font .ttf thật đặt sẵn
// tại `frontend/public/fonts/` (tải từ kho google/fonts, kèm OFL.txt license đi cùng). Thiếu
// file font → `loadCaptionFont` trả về false, composeVideo tự bỏ qua phụ đề (không chặn
// render, không throw).

import { fetchFile } from '@/lib/video-library/ffmpeg-client';

interface FFmpegWriteFile {
  writeFile: (path: string, data: Uint8Array | string) => Promise<boolean>;
}

export interface CaptionFontOption {
  id: string;
  label: string;
  /** Đường dẫn public asset (Next.js `public/`) */
  assetPath: string;
}

/** Tên file dùng chung trong FS ảo của FFmpeg — luôn ghi đè font đã chọn vào đúng 1 tên này */
const CAPTION_FONT_FS_NAME = 'caption-font.ttf';
const MAX_CAPTION_CHARS = 220;

/** 6 font phổ biến hay dùng để phụ đề video — đều đã xác nhận có subset "vietnamese" (trừ khi ghi chú) */
export const CAPTION_FONTS: CaptionFontOption[] = [
  { id: 'be-vietnam-pro', label: 'Be Vietnam Pro (mặc định)', assetPath: '/fonts/captions.ttf' },
  { id: 'montserrat', label: 'Montserrat', assetPath: '/fonts/montserrat.ttf' },
  { id: 'oswald', label: 'Oswald (gọn, kiểu tin tức)', assetPath: '/fonts/oswald.ttf' },
  { id: 'anton', label: 'Anton (đậm, nổi bật)', assetPath: '/fonts/anton.ttf' },
  { id: 'bangers', label: 'Bangers (comic, vui nhộn)', assetPath: '/fonts/bangers.ttf' },
  { id: 'kanit-bold', label: 'Kanit Bold', assetPath: '/fonts/kanit-bold.ttf' },
];

export const DEFAULT_CAPTION_FONT_ID = CAPTION_FONTS[0].id;

export function resolveCaptionFont(id?: string): CaptionFontOption {
  return CAPTION_FONTS.find((f) => f.id === id) ?? CAPTION_FONTS[0];
}

/** Tải font TTF (public asset) vào FS ảo của FFmpeg — false nếu thiếu file, không throw */
export async function loadCaptionFont(ffmpeg: FFmpegWriteFile, font: CaptionFontOption): Promise<boolean> {
  try {
    const bytes = await fetchFile(font.assetPath);
    await ffmpeg.writeFile(CAPTION_FONT_FS_NAME, bytes);
    return true;
  } catch {
    return false;
  }
}

/** Xuống dòng thô theo số ký tự — drawtext không tự word-wrap như canvas */
function wrapCaptionText(text: string, maxCharsPerLine: number): string {
  const words = text.split(/\s+/);
  const lines: string[] = [];
  let line = '';

  for (const word of words) {
    const candidate = line ? `${line} ${word}` : word;
    if (candidate.length > maxCharsPerLine && line) {
      lines.push(line);
      line = word;
    } else {
      line = candidate;
    }
  }
  if (line) lines.push(line);

  return lines.join('\n');
}

/** Số dòng tối đa hiển thị — vượt quá thì cắt bớt + thêm "…", tránh khung phụ đề cao lấn video */
const MAX_CAPTION_LINES = 2;
/** Chừa lề 2 bên — dòng chữ không bao giờ chạm sát mép trái/phải khung hình */
const SAFE_WIDTH_RATIO = 0.92;
/** Bề rộng trung bình 1 ký tự ≈ tỉ lệ này × fontSize — ước lượng cho font đậm dùng làm phụ đề */
const AVG_CHAR_WIDTH_FACTOR = 0.55;

/** Cỡ chữ phụ đề theo chiều cao khung hình — dùng chung cho buildCaptionText (ước lượng bề rộng dòng) và captionDrawtextFilter (fontsize thật) để 2 nơi luôn khớp nhau */
export function resolveCaptionFontSize(frameHeight: number): number {
  return Math.max(18, Math.round(frameHeight / 26));
}

/** Chuẩn hoá lời thoại → nội dung phụ đề hiển thị: RỘNG "co giãn" theo đúng độ dài nội dung
 * (không phải 1 tỉ lệ cố định) để hiện đủ chữ, chỉ CẮT BỚT khi nội dung dài tới mức không còn
 * cách nào gói gọn trong 2 dòng dù đã dùng hết bề rộng an toàn của khung hình. */
export function buildCaptionText(voice: string, frameWidth: number, frameHeight: number): string {
  const trimmed = voice.trim();
  if (!trimmed) return '';
  const content = trimmed.length > MAX_CAPTION_CHARS
    ? `${trimmed.slice(0, MAX_CAPTION_CHARS - 1)}…`
    : trimmed;

  const fontSize = resolveCaptionFontSize(frameHeight);
  // Giới hạn AN TOÀN duy nhất — số ký tự tối đa/dòng mà khung hình còn chứa được. Không phải
  // đích cần đạt: nội dung ngắn sẽ dùng ít hơn số này rất nhiều (khung hẹp lại đúng theo câu),
  // nội dung dài mới cần dùng gần hết mức này.
  const maxLineWidth = Math.max(16, Math.floor((frameWidth * SAFE_WIDTH_RATIO) / (fontSize * AVG_CHAR_WIDTH_FACTOR)));

  if (content.length <= maxLineWidth) return content; // vừa gọn 1 dòng, không cần bẻ dòng

  // Bẻ CÂN 2 dòng theo đúng độ dài nội dung thật (thay vì luôn ép theo 1 tỉ lệ cố định) — khung
  // rộng vừa đủ cho câu này, không hẹp-thiếu chữ cũng không rộng-thừa quá mức cần thiết.
  const balancedWidth = Math.ceil(content.length / MAX_CAPTION_LINES);
  const wrapped = wrapCaptionText(content, Math.min(maxLineWidth, balancedWidth));
  if (wrapped.split('\n').length <= MAX_CAPTION_LINES) return wrapped;

  // Vẫn dư dòng dù đã bẻ cân — thử lại với bề rộng an toàn TỐI ĐA của khung hình.
  const wrappedAtMax = wrapCaptionText(content, maxLineWidth);
  const linesAtMax = wrappedAtMax.split('\n');
  if (linesAtMax.length <= MAX_CAPTION_LINES) return wrappedAtMax;

  // Nội dung vẫn không gói gọn nổi trong 2 dòng dù đã dùng hết bề rộng khung hình — chỉ còn
  // cách cắt bớt (không thể "co giãn" vượt quá mép khung hình được nữa).
  const clipped = linesAtMax.slice(0, MAX_CAPTION_LINES);
  const lastLine = clipped[MAX_CAPTION_LINES - 1].replace(/[.,!?…]*$/, '');
  clipped[MAX_CAPTION_LINES - 1] = `${lastLine}…`;
  return clipped.join('\n');
}

/**
 * Filter drawtext nối vào cuối `-vf` của clip — đọc text từ file riêng (`textfile=`) thay vì
 * nhúng thẳng vào chuỗi filter, tránh toàn bộ vấn đề escape ký tự `:`/`'`/`,` trong lời thoại.
 * KHÔNG dùng box nền (box=1) — chỉ viền đen quanh chữ (borderw/bordercolor) để đọc được trên
 * mọi nền video, không che khuất hình phía sau như khung nền mờ trước đây.
 */
export function captionDrawtextFilter(captionFileName: string, frameHeight: number): string {
  const fontSize = resolveCaptionFontSize(frameHeight);
  // Đặt gần mép dưới khung hình hơn (trước đây cách đáy fontSize*1.4 → nhiều khoảng trống
  // thừa bên dưới phụ đề).
  return `drawtext=textfile=${captionFileName}:fontfile=${CAPTION_FONT_FS_NAME}:fontsize=${fontSize}:fontcolor=white:line_spacing=6:borderw=4:bordercolor=black@0.9:x=(w-text_w)/2:y=h-th-(${fontSize}*0.5)`;
}
