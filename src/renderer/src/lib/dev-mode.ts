/**
 * DEV ONLY — vào thẳng giao diện Studio mà không đăng nhập, để làm việc với giao diện/chức năng
 * trong lúc chưa có phiên Supabase thật. Cần CẢ HAI: chạy `npm run dev` (import.meta.env.DEV)
 * và `VITE_DEV_SKIP_AUTH=true` trong .env. Bản build luôn là `false` nên mọi nhánh dùng cờ này
 * bị loại bỏ khi build.
 *
 * Cách hoạt động: nếu đã có phiên Supabase THẬT (đăng nhập bằng nút trên nhãn DEV) thì dùng
 * phiên đó như bình thường. Chưa có phiên thì dùng một người dùng giả: không có access token →
 * thư viện video chỉ nằm trong bộ nhớ (mất khi tải lại), còn mọi thao tác cần tài khoản
 * (API key / kịch bản / lịch sử trên Supabase, credit, giọng đọc, nhạc nền, tạo video qua
 * backend) bị backend từ chối (401).
 */
export const DEV_SKIP_AUTH = import.meta.env.DEV && import.meta.env.VITE_DEV_SKIP_AUTH === 'true';

/** id của người dùng giả (không tồn tại trên Supabase). */
export const DEV_USER_ID = '00000000-0000-0000-0000-000000000000';

/** True nếu `user` là người dùng giả của DEV_SKIP_AUTH, tức KHÔNG có phiên Supabase thật. */
export function isDevFakeUser(user: { id: string } | null | undefined): boolean {
  return DEV_SKIP_AUTH && user?.id === DEV_USER_ID;
}
