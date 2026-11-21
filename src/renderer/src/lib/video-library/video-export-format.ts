// ─── Kích thước xuất video theo tỷ lệ khung hình + chất lượng ──────────────
// Dùng chung cho clip placeholder (mục 3) và render FFmpeg (mục 4) — đảm bảo
// mọi clip trong 1 project luôn cùng kích thước khớp aspectRatio đã chọn lúc
// generate (16:9 / 9:16 / 1:1), tránh bị scale méo về mặc định 1280x720.

export interface ExportDimensions {
  width: number;
  height: number;
}

function longEdgeForQuality(videoQuality?: string): number {
  return videoQuality === '1080p' ? 1920 : 1280;
}

function shortEdgeForQuality(videoQuality?: string): number {
  return videoQuality === '1080p' ? 1080 : 720;
}

/** Kích thước khung hình xuất (luôn chẵn — tương thích yuv420p) theo aspectRatio dự án */
export function resolveExportDimensions(aspectRatio = '16:9', videoQuality?: string): ExportDimensions {
  const long = longEdgeForQuality(videoQuality);
  const short = shortEdgeForQuality(videoQuality);

  switch (aspectRatio) {
    case '9:16':
      return { width: short, height: long };
    case '1:1':
      return { width: short, height: short };
    case '16:9':
    default:
      return { width: long, height: short };
  }
}

/** Filter scale + pad viền đen — giữ nguyên tỷ lệ gốc của clip, không kéo méo hình */
export function scalePadFilter(width: number, height: number): string {
  return `scale=${width}:${height}:force_original_aspect_ratio=decrease,pad=${width}:${height}:(ow-iw)/2:(oh-ih)/2:color=black,setsar=1`;
}
