// ─── Validation Direct Veo — Scene-centric (Phase 8) ───────────────────────────────────
// Xem docs/BUILD PROMPT - tối ưu V3.md §10. Q1 đã chốt: KHÔNG character limit (cũ hay mới),
// không backstop payload — chỉ giữ đúng 2 rule bên dưới. Không tự ý thêm lại cap ký tự.

import type { DirectVeoError, DirectVeoScene } from './direct-veo-types';

export const DIRECT_VEO_MIN_SCENES = 1;
export const DIRECT_VEO_MAX_SCENES = 3;

/**
 * Rule duy nhất (V3 §10): 1 ≤ scenes.length ≤ 3, và mỗi scene phải có prompt không rỗng.
 * Image KHÔNG phải điều kiện — 1 scene không ảnh vẫn hợp lệ (Text-to-Video).
 */
export function validateDirectVeoScenes(scenes: DirectVeoScene[]): DirectVeoError[] {
  const errors: DirectVeoError[] = [];

  if (scenes.length < DIRECT_VEO_MIN_SCENES || scenes.length > DIRECT_VEO_MAX_SCENES) {
    errors.push({
      field: 'scenes',
      message: `Số lượng Scene phải từ ${DIRECT_VEO_MIN_SCENES} đến ${DIRECT_VEO_MAX_SCENES} — hiện có ${scenes.length}.`,
    });
  }

  scenes.forEach((scene, i) => {
    if (scene.prompt.trim().length === 0) {
      errors.push({ field: `Scene ${i + 1}`, message: `Scene ${i + 1}: Prompt là bắt buộc.` });
    }
  });

  return errors;
}
