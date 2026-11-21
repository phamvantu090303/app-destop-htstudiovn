// ─── Build VideoScene[] từ DirectVeoScene[] (Scene-centric, Phase 8) ───────────────────
// Xem docs/BUILD PROMPT - tối ưu V3.md §8, §9. Adapter mỏng: gom scene + Global Context rồi
// gọi scenesFromDirectVeoPrompt() (frontend/lib/scene/scenes.ts) — nơi thực sự dựng VideoScene.

import type { VideoScene } from '@/lib/scene/scenes';
import { scenesFromDirectVeoPrompt } from '@/lib/scene/scenes';
import type { DirectVeoScene } from './direct-veo-types';

/**
 * Final prompt = Global Context (nếu có) + Scene Prompt. Khi Global Context rỗng → chỉ
 * scene.prompt, không separator lơ lửng.
 */
export function buildDirectVeoFinalPrompt(globalContext: string, scenePrompt: string): string {
  const global = globalContext.trim();
  const prompt = scenePrompt.trim();
  return global.length === 0 ? prompt : `${global}\n\n${prompt}`;
}

/**
 * Human-readable representation cho `inputContent` (spec tối ưu V3 §11) — CHỈ để hiển
 * thị/lịch sử ở Mục 2, tuyệt đối không dùng làm nguồn parse ngược lại DirectVeoScene[].
 */
export function buildDirectVeoInputContent(scenes: DirectVeoScene[], globalContext: string): string {
  const sections: string[] = [];
  if (globalContext.trim()) sections.push(`Thiết lập chung:\n${globalContext.trim()}`);
  scenes.forEach((scene, i) => sections.push(`Scene ${i + 1}:\n${scene.prompt.trim()}`));
  return sections.join('\n\n');
}

export function mapDirectVeoScenesToVideoScenes(params: {
  scenes: DirectVeoScene[];
  globalContext: string;
  sceneDurationSetting?: string;
  videoQuality?: string;
  provider?: string;
}): VideoScene[] {
  const { scenes, globalContext, sceneDurationSetting, videoQuality, provider } = params;

  const input = scenes.map((scene) => ({
    prompt: buildDirectVeoFinalPrompt(globalContext, scene.prompt),
    image: scene.image,
  }));

  return scenesFromDirectVeoPrompt(input, sceneDurationSetting, videoQuality, provider);
}
