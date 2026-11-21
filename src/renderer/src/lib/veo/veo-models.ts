// ─── Gợi ý model Veo theo chất lượng video (danh sách lấy từ API) ───────────

import { API_KEY_IDS, getApiKey } from '@/lib/api-keys/api-keys-store';

export interface VeoModelOption {
  id: string;
  displayName: string;
  description?: string;
}

/**
 * Model của nhà cung cấp 'veo' (mặc định, qua kie.ai) — danh sách CỐ ĐỊNH, mirror
 * `STATIC_VEO_MODELS` ở backend/src/services/veo/veo-models.service.ts. kie.ai không có
 * endpoint discovery thật (route /api/veo/models trước đây luôn trả cứng đúng 3 model này bất
 * kể giá trị key) nên khai tĩnh ở đây luôn — bỏ được vòng gọi mạng + không còn cần key thật ở
 * client để hiển thị danh sách (Video API Key giờ là key hệ thống, không còn ở phía user).
 */
export const KIE_VEO_MODEL_OPTIONS: VeoModelOption[] = [
  { id: 'veo3', displayName: 'Veo 3.1 Quality', description: 'Chất lượng cao nhất, không hỗ trợ Master Cast reference' },
  { id: 'veo3_fast', displayName: 'Veo 3.1 Fast', description: 'Cân bằng tốc độ/chi phí, hỗ trợ Master Cast reference' },
  { id: 'veo3_lite', displayName: 'Veo 3.1 Lite', description: 'Rẻ nhất, phù hợp khối lượng lớn' },
];

/**
 * Model của nhà cung cấp "Veo3.1 Gemini" (gọi thẳng Google) — id chính thức của Google,
 * KHÁC hoàn toàn id kie.ai (veo3/veo3_fast/veo3_lite). Danh sách cố định nên khai ở
 * frontend, không cần gọi /api/veo/models (endpoint đó chỉ phục vụ model kie.ai).
 * Đồng bộ thủ công với KIE_TO_GEMINI_MODEL trong backend/src/lib/veo-config.ts.
 */
export const VEO_GEMINI_MODEL_OPTIONS: VeoModelOption[] = [
  {
    id: 'veo-3.1-generate-preview',
    displayName: 'Veo 3.1 (Google)',
    description: 'Chất lượng cao nhất, hỗ trợ ảnh tham chiếu giữ nhân vật',
  },
  {
    id: 'veo-3.1-fast-generate-preview',
    displayName: 'Veo 3.1 Fast (Google)',
    description: 'Cân bằng tốc độ/chi phí, hỗ trợ ảnh tham chiếu giữ nhân vật',
  },
  {
    id: 'veo-3.1-lite-generate-preview',
    displayName: 'Veo 3.1 Lite (Google)',
    description: 'Rẻ nhất, KHÔNG hỗ trợ ảnh tham chiếu giữ nhân vật',
  },
];

/**
 * Gợi ý model Veo mặc định cho project MỚI (chưa từng chọn model) — luôn ưu tiên Lite,
 * bất kể "Chất lượng" đang chọn gì. Lite rẻ nhất trong 3 tier ở CÙNG độ phân giải (vd
 * kie.ai: 30 credit/video so với 250 credit/video của Quality ở 720p — cả 3 tier đều ra
 * video 720p y hệt nhau, chỉ khác chất lượng chuyển động/coherence, không phải độ nét).
 * Nếu Lite không hỗ trợ 1 tính năng đang dùng (vd referenceImages ở nhà cung cấp Google —
 * xem supportsGeminiReferenceMode), backend đã tự nâng lên Fast khi cần, không cần lo gãy.
 * User vẫn tự đổi được sang Quality/Fast ở ô "Model Veo" bất cứ lúc nào — đây chỉ là giá
 * trị điền sẵn ban đầu để tránh vô tình tốn gấp nhiều lần credit mỗi cảnh mà không hay biết.
 */
export function suggestVeoModelForQuality(
  _quality: string,
  models: VeoModelOption[],
): string {
  if (models.length === 0) return '';

  const lite = models.find((m) => m.id.includes('lite'));
  if (lite) return lite.id;

  const fast = models.find((m) => m.id.includes('fast'));
  if (fast) return fast.id;

  const standard = models.find((m) => m.id === 'veo3');
  return standard?.id ?? models[0].id;
}

/**
 * Key dùng để TẠO VIDEO theo nhà cung cấp — CHỈ 'veo-gemini' cần key phía client, dùng key
 * RIÊNG "Gemini Key Veo 3.1" (API_KEY_IDS.veoGemini), KHÔNG dùng chung với Gemini API Key vốn
 * chỉ để tạo kịch bản/phân cảnh/lời thoại. Nhà cung cấp 'veo' (mặc định, qua kie.ai) dùng key
 * hệ thống do admin quản lý — backend tự chọn, trả `''` ở đây vì không còn ý nghĩa "thiếu key"
 * cho nhánh này (xem input-section.tsx: chỉ chặn submit khi thiếu key cho 'veo-gemini').
 */
export function getVideoApiKeyForProvider(provider: string | undefined): string {
  return provider === 'veo-gemini' ? getApiKey(API_KEY_IDS.veoGemini).trim() : '';
}

/**
 * Scene Continuity (nối cảnh bằng khung hình cuối cảnh trước → /veo/generate
 * FIRST_AND_LAST_FRAMES_2_VIDEO) áp dụng cho mọi model Veo 3.1 — không giới hạn.
 */
export function supportsVideoExtension(_modelId: string | undefined): boolean {
  return true;
}
