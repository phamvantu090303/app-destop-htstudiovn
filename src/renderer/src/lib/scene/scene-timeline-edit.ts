// ─── Trim / Split / Reorder cảnh trên Timeline (mục 4) ─────────────────────
//
// Trim ở đây CHỈ CO — kéo tay 2 đầu clip để cắt bớt, không kéo giãn thêm được. Lý do: kéo
// giãn cần biết trước độ dài THẬT của video nguồn để chặn kéo quá đà (video Veo dài hơn
// dự kiến bao nhiêu chỉ biết chắc sau khi đo lại — xem withRealVideoDurations trong
// video-composer.ts), trong khi chỉ-co không cần biết gì thêm ngoài durationSeconds hiện
// tại. Muốn khôi phục clip gốc thì tạo lại cảnh ở mục 3.

import { recalculateSceneTimings, type VideoScene } from '@/lib/scene/scenes';

export const MIN_CLIP_DURATION_SECONDS = 0.5;

export type TrimEdge = 'start' | 'end';

/** Cắt bớt clip từ đầu ('start') hoặc cuối ('end') — deltaSeconds luôn dương, chỉ co lại */
export function trimScene(
  scenes: VideoScene[],
  sceneId: string,
  edge: TrimEdge,
  deltaSeconds: number,
): VideoScene[] {
  if (deltaSeconds <= 0) return scenes;

  const next = scenes.map((scene) => {
    if (scene.id !== sceneId) return scene;

    const maxDelta = scene.durationSeconds - MIN_CLIP_DURATION_SECONDS;
    if (maxDelta <= 0) return scene;
    const applied = Math.min(deltaSeconds, maxDelta);
    const trimStart = scene.trimStartSeconds ?? 0;

    return {
      ...scene,
      trimStartSeconds: edge === 'start' ? trimStart + applied : trimStart,
      durationSeconds: scene.durationSeconds - applied,
      trimmed: true,
    };
  });

  return recalculateSceneTimings(next);
}

/** Tách 1 cảnh thành 2 tại `offsetSeconds` tính từ đầu cảnh (không phải từ đầu timeline) */
export function splitScene(
  scenes: VideoScene[],
  sceneId: string,
  offsetSeconds: number,
): VideoScene[] {
  const idx = scenes.findIndex((s) => s.id === sceneId);
  if (idx === -1) return scenes;

  const scene = scenes[idx];
  if (
    offsetSeconds < MIN_CLIP_DURATION_SECONDS ||
    scene.durationSeconds - offsetSeconds < MIN_CLIP_DURATION_SECONDS
  ) {
    return scenes;
  }

  const trimStart = scene.trimStartSeconds ?? 0;

  const first: VideoScene = {
    ...scene,
    durationSeconds: offsetSeconds,
    trimStartSeconds: trimStart,
    trimmed: true,
  };

  const second: VideoScene = {
    ...scene,
    id: `${scene.id}-split-${Date.now()}`,
    durationSeconds: scene.durationSeconds - offsetSeconds,
    trimStartSeconds: trimStart + offsetSeconds,
    trimmed: true,
    // TTS gốc chỉ khớp lời thoại cho toàn cảnh cũ — nửa sau tách ra không tự có audio
    // riêng, cần tạo lại TTS ở mục 3 nếu muốn có lời dẫn cho phần này.
    audioUrl: undefined,
    audioDurationSeconds: undefined,
    audioPath: undefined,
  };

  const next = [...scenes.slice(0, idx), first, second, ...scenes.slice(idx + 1)];
  return recalculateSceneTimings(next);
}

/** Đổi vị trí cảnh `draggedId` tới ngay vị trí cảnh `targetId` */
export function reorderScenes(
  scenes: VideoScene[],
  draggedId: string,
  targetId: string,
): VideoScene[] {
  if (draggedId === targetId) return scenes;

  const fromIndex = scenes.findIndex((s) => s.id === draggedId);
  const toIndex = scenes.findIndex((s) => s.id === targetId);
  if (fromIndex === -1 || toIndex === -1) return scenes;

  const next = [...scenes];
  const [moved] = next.splice(fromIndex, 1);
  next.splice(toIndex, 0, moved);

  return recalculateSceneTimings(next);
}
