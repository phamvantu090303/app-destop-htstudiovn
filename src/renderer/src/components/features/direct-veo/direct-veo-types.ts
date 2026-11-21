// ─── Direct Veo — Scene-centric data model (Phase 8) ───────────────────────────────────
// Xem docs/BUILD PROMPT - tối ưu V3.md. Scene là entity trung tâm duy nhất — thay thế
// PromptSegment/DirectVeoPromptMapping/imageIndex (Phase 5-7b, archived/superseded).

export interface DirectVeoError {
  /** 'prompt' | 'images' | tên field cụ thể (vd 'Scene 2') */
  field: string;
  message: string;
}

/**
 * 1 Scene = 1 Prompt bắt buộc + 1 Image tuỳ chọn = 1 Video. Không phân biệt
 * Image-to-Video/Text-to-Video ở tầng dữ liệu — suy ra từ `image !== null`.
 */
export interface DirectVeoScene {
  /** mint 1 lần khi tạo scene, ổn định qua thêm/xoá scene khác */
  id: string;
  /** REQUIRED — verbatim, chỉ trim đầu/cuối khi build final prompt */
  prompt: string;
  /** OPTIONAL */
  image: { base64: string; mimeType: string } | null;
}
