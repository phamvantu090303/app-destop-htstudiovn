// ─── Hằng số style dùng chung cho trang chủ (site-header/site-footer/page) ───
// Gradient xanh→tím tách riêng để đổi 1 chỗ là đồng bộ khắp trang, thay vì lặp lại chuỗi
// class ở nhiều component.

export const SITE_NAME = 'HTStudio';
export const TAGLINE = 'Video • Content • Creative';

// Icon mark (chỉ chữ "HT" + nút play, KHÔNG có chữ "HT STUDIO..." bên dưới — chữ đó không đọc
// được ở size nhỏ và mọi nơi dùng logo đều đã có sẵn chữ "HTStudio" cạnh bên) — nền trong suốt,
// crop tay từ public/logo/logo1.png (file gốc đầy đủ, giữ nguyên trong public/logo/).
export const LOGO_URL = '/logo/logo-mark.png';

export const GRADIENT = 'bg-gradient-to-r from-blue-500 to-purple-500';
export const GRADIENT_HOVER = 'hover:from-blue-600 hover:to-purple-600';
export const GRADIENT_TEXT = 'bg-gradient-to-r from-blue-400 to-purple-400 bg-clip-text text-transparent';
