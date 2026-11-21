// ─── Zod schema cho field "Tên video" (tạo mới / đổi tên / sửa) ─────────────
// Trước đây validate thủ công (presence-check only) trong video-item-modal.tsx —
// tách ra schema riêng để dùng chung với react-hook-form (zodResolver), type suy
// ra từ schema thay vì định nghĩa tay 2 lần.

import { z } from 'zod';

export const VIDEO_TITLE_MIN = 3;
export const VIDEO_TITLE_MAX = 80;

/**
 * Không giới hạn ký tự đặc biệt/emoji — đây là tên hiển thị tự do (không phải slug/filename),
 * giữ đúng hành vi hiện có (trước đây cũng không có regex nào chặn ký tự). Chỉ validate độ dài.
 *
 * `existingTitles` (tuỳ chọn): truyền vào nếu cần chặn trùng tên trong 1 ngữ cảnh cụ thể — mặc
 * định KHÔNG bật kiểm tra trùng, vì hiện tại app cho phép nhiều video cùng tên (vd nhiều video
 * để mặc định "Video mới" chưa đổi tên) — bật kiểm tra trùng ở đây sẽ đổi luồng nghiệp vụ hiện
 * có mà không có yêu cầu rõ ràng.
 */
export function createVideoTitleSchema(existingTitles?: string[]) {
  return z
    .string()
    .trim()
    .superRefine((val, ctx) => {
      if (val.length === 0) {
        ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'Vui lòng đặt tên cho video.' });
        return;
      }
      if (val.length < VIDEO_TITLE_MIN || val.length > VIDEO_TITLE_MAX) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: `Tên video cần từ ${VIDEO_TITLE_MIN} đến ${VIDEO_TITLE_MAX} ký tự (hiện tại ${val.length}).`,
        });
        return;
      }
      if (existingTitles?.some((t) => t.trim().toLowerCase() === val.toLowerCase())) {
        ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'Tên video này đã được dùng — chọn tên khác.' });
      }
    });
}

export const videoItemFormSchema = z.object({
  title: createVideoTitleSchema(),
});

export type VideoItemFormValues = z.infer<typeof videoItemFormSchema>;
