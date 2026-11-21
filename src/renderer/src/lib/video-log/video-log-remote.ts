// ─── Đọc bảng audit veo_task_records cho tính năng "Nhật Ký" ───────────────────
// Thông tin cơ bản (prompt/tên project) lấy qua JOIN video_scenes/video_projects (FK sẵn
// có) — không phụ thuộc dữ liệu trả về từ kie.ai. Chỉ INSERT ở nơi khác (video-library-
// remote.ts) — file này CHỈ ĐỌC, không ghi (đúng vai trò audit append-only của bảng).

import type { SupabaseClient } from '@supabase/supabase-js';

export interface VideoLogEntry {
  id: string;
  veoTaskId: string;
  provider: string | null;
  /** id (không phải secret) Video API Key hệ thống đã tạo task này — null nếu provider khác
   *  'veo' hoặc dữ liệu cũ trước khi có cột này */
  videoApiKeyId: string | null;
  sceneId: string | null;
  projectId: string | null;
  createdAt: string;
  /** Snapshot trạng thái scene TẠI THỜI ĐIỂM tạo record — không phải trạng thái sống */
  localStatus: string | null;
  /** Từ JOIN video_scenes — undefined nếu cảnh đã bị xoá (on delete set null) */
  scenePrompt?: string;
  sceneIndex?: number;
  /** Từ JOIN video_projects — undefined nếu project đã bị xoá */
  projectTitle?: string;
  /**
   * Số credit ĐÃ TRỪ thật cho task này (đọc từ credit_transactions type='spend', đúng bằng
   * `model_pricing.system_credit` của model lúc tạo — xem backend/src/routes/veo/veo.route.ts).
   * `null` = chưa có giao dịch (dữ liệu cũ trước khi có tính năng trừ credit, hoặc model chưa
   * niêm yết giá lúc tạo).
   */
  creditAmount: number | null;
  /** true nếu task này đã được hoàn credit (kie.ai kết luận thất bại lúc poll) */
  creditRefunded: boolean;
}

interface VeoTaskRecordJoinedRow {
  id: string;
  veo_task_id: string;
  provider: string | null;
  video_api_key_id: string | null;
  scene_id: string | null;
  project_id: string | null;
  created_at: string;
  status: string | null;
  video_scenes: { prompt: string; index: number } | null;
  video_projects: { title: string } | null;
}

/** Escape `\`, `%`, `_` trước khi đưa vào ILIKE — tránh wildcard injection ngoài ý muốn
 *  nếu taskId thật chứa đúng các ký tự này. */
function escapeIlikePattern(value: string): string {
  return value.replace(/\\/g, '\\\\').replace(/[%_]/g, (c) => `\\${c}`);
}

function fromJoinedRow(
  row: VeoTaskRecordJoinedRow,
  credit?: { amount: number; refunded: boolean },
): VideoLogEntry {
  return {
    id: row.id,
    veoTaskId: row.veo_task_id,
    provider: row.provider,
    videoApiKeyId: row.video_api_key_id,
    sceneId: row.scene_id,
    projectId: row.project_id,
    createdAt: row.created_at,
    localStatus: row.status,
    scenePrompt: row.video_scenes?.prompt,
    sceneIndex: row.video_scenes?.index,
    projectTitle: row.video_projects?.title,
    creditAmount: credit?.amount ?? null,
    creditRefunded: credit?.refunded ?? false,
  };
}

interface CreditTxRow {
  reference_id: string;
  type: 'spend' | 'refund';
  amount: number;
}

/**
 * Tra `credit_transactions` (type spend/refund, reference_type='veo_task') cho đúng các
 * taskId đang hiển thị trên trang — 1 query gộp thay vì N+1. RLS `credit_transactions_
 * select_own` đã tự giới hạn đúng user đang đăng nhập.
 */
async function fetchCreditByTaskId(
  supabase: SupabaseClient,
  taskIds: string[],
): Promise<Map<string, { amount: number; refunded: boolean }>> {
  const result = new Map<string, { amount: number; refunded: boolean }>();
  if (taskIds.length === 0) return result;

  const { data, error } = await supabase
    .from('credit_transactions')
    .select('reference_id, type, amount')
    .eq('reference_type', 'veo_task')
    .in('reference_id', taskIds)
    .in('type', ['spend', 'refund']);

  if (error) {
    // Không chặn cả trang Nhật Ký chỉ vì thiếu cột Credits — log để biết, cột hiện "—".
    console.error('[video-log] Tải credit_transactions thất bại:', error.message);
    return result;
  }

  for (const row of (data ?? []) as CreditTxRow[]) {
    const existing = result.get(row.reference_id) ?? { amount: 0, refunded: false };
    if (row.type === 'spend') existing.amount = Math.abs(row.amount);
    if (row.type === 'refund') existing.refunded = true;
    result.set(row.reference_id, existing);
  }
  return result;
}

/**
 * Gom id các dòng `veo_task_records` khớp search theo NHIỀU nguồn: chính task_id, tiêu đề
 * project, hoặc prompt cảnh — hợp lại làm 1 tập `id` rồi lọc bằng `.in('id', ...)` ở query
 * chính. CHỦ Ý không dùng `.or('col.ilike.%x%,...')` dạng chuỗi DSL: giá trị search do người
 * dùng gõ có thể chứa dấu phẩy/ngoặc — những ký tự có nghĩa cú pháp trong chuỗi `.or()` của
 * PostgREST, gõ đúng ký tự đó sẽ làm gãy filter (hoặc worse, lọc sai âm thầm). Dùng `.ilike()`/
 * `.in()` qua phương thức (không phải chuỗi tự ráp) để supabase-js tự escape an toàn — id thu
 * được từ DB (UUID) không chứa ký tự đặc biệt nên ghép vào `.in()` sau đó luôn an toàn.
 */
async function findMatchingTaskIds(
  supabase: SupabaseClient,
  userId: string,
  pattern: string,
): Promise<string[]> {
  const [taskIdRes, projectRes, sceneRes] = await Promise.all([
    supabase.from('veo_task_records').select('id').eq('user_id', userId).ilike('veo_task_id', pattern),
    supabase.from('video_projects').select('id').eq('user_id', userId).ilike('title', pattern),
    supabase.from('video_scenes').select('id').eq('user_id', userId).ilike('prompt', pattern),
  ]);

  const ids = new Set<string>();
  for (const row of (taskIdRes.data ?? []) as { id: string }[]) ids.add(row.id);

  const projectIds = (projectRes.data ?? []).map((row) => (row as { id: string }).id);
  const sceneIds = (sceneRes.data ?? []).map((row) => (row as { id: string }).id);

  const lookups: Promise<{ data: { id: string }[] | null }>[] = [];
  if (projectIds.length > 0) {
    lookups.push(Promise.resolve(supabase.from('veo_task_records').select('id').eq('user_id', userId).in('project_id', projectIds)));
  }
  if (sceneIds.length > 0) {
    lookups.push(Promise.resolve(supabase.from('veo_task_records').select('id').eq('user_id', userId).in('scene_id', sceneIds)));
  }
  const extra = await Promise.all(lookups);
  for (const res of extra) for (const row of res.data ?? []) ids.add(row.id);

  return [...ids];
}

export interface FetchVideoLogPageParams {
  offset: number;
  limit: number;
  /** Tìm theo Task ID, tiêu đề project, hoặc prompt cảnh — chưa cần trim/escape, hàm tự xử lý */
  search?: string;
}

export interface FetchVideoLogPageResult {
  items: VideoLogEntry[];
  hasMore: boolean;
}

/**
 * Tải 1 trang lịch sử — chỉ `provider IN ('veo', NULL)` (loại 'veo-gemini', taskId Google
 * không tra được qua Get Task Details của kie.ai). Fetch dư 1 dòng để biết `hasMore` mà
 * không cần query đếm riêng.
 */
export async function fetchVideoLogPage(
  supabase: SupabaseClient,
  userId: string,
  { offset, limit, search }: FetchVideoLogPageParams,
): Promise<FetchVideoLogPageResult> {
  let query = supabase
    .from('veo_task_records')
    .select('id, veo_task_id, provider, video_api_key_id, scene_id, project_id, created_at, status, video_scenes(prompt, index), video_projects(title)')
    .eq('user_id', userId)
    .or('provider.eq.veo,provider.is.null')
    .order('created_at', { ascending: false })
    .range(offset, offset + limit);

  const trimmedSearch = search?.trim();
  if (trimmedSearch) {
    const pattern = `%${escapeIlikePattern(trimmedSearch)}%`;
    const matchingIds = await findMatchingTaskIds(supabase, userId, pattern);
    if (matchingIds.length === 0) return { items: [], hasMore: false };
    query = query.in('id', matchingIds);
  }

  const { data, error } = await query;
  if (error) throw error;

  const rows = (data ?? []) as unknown as VeoTaskRecordJoinedRow[];
  const hasMore = rows.length > limit;
  const pageRows = rows.slice(0, limit);

  const creditByTaskId = await fetchCreditByTaskId(supabase, pageRows.map((r) => r.veo_task_id));
  const items = pageRows.map((row) => fromJoinedRow(row, creditByTaskId.get(row.veo_task_id)));

  return { items, hasMore };
}
