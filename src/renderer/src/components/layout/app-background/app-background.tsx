import { cn } from '@/lib/utils';

interface AppBackgroundProps {
  /** Đường dẫn ảnh trong public/ — mặc định anh1.webp (public/backgroud/anh1.webp) */
  src?: string;
  /** Độ mờ ảnh 0-100 — dùng khi KHÔNG bật darkOverlay (nền chính, ảnh phải mờ để không
   * đè lên độ dễ đọc của bảng/chữ dày đặc bên trong app) */
  opacity?: number;
  /** Phủ thêm gradient tối phía trên ảnh (thay vì làm mờ nguyên ảnh) — dùng cho màn hình
   * ít nội dung hơn (đăng nhập/loading) nơi ảnh cần rõ nhưng vẫn phải đủ tương phản cho chữ. */
  darkOverlay?: boolean;
  className?: string;
}

/** Lớp ảnh nền trang trí — absolute phủ kín phần tử cha (cha cần `relative`/`isolate`),
 * `-z-10` đảm bảo luôn nằm sau nội dung thật dù nội dung không tự đặt z-index. Dùng chung
 * cho mọi màn hình cần ảnh nền (main app, màn đăng nhập, màn loading) thay vì mỗi nơi tự
 * viết lại style riêng. */
export function AppBackground({
  src = '/backgroud/anh1.webp',
  opacity = 35,
  darkOverlay = false,
  className,
}: AppBackgroundProps) {
  return (
    <div
      className={cn('absolute inset-0 -z-10 pointer-events-none', className)}
      style={{
        backgroundImage: darkOverlay
          ? `linear-gradient(to bottom, rgba(10,8,20,0.55), rgba(10,8,20,0.85)), url('${src}')`
          : `url('${src}')`,
        backgroundSize: 'cover',
        backgroundPosition: 'center',
        opacity: darkOverlay ? 1 : opacity / 100,
      }}
      aria-hidden
    />
  );
}
