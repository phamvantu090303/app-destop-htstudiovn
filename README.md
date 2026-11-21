# HTStudio Desktop

Bản app desktop (Electron) của **HTStudio** — phần **Studio tạo video** được port từ dự án web
`web-video` (`frontend/app/studio`). App dùng lại đúng backend và Supabase của web, không có backend riêng.

Công nghệ: Electron 45 · electron-vite · React 19 · Tailwind CSS 4 · TypeScript.

## Chạy thử

```bash
npm install
cp .env.example .env     # Windows: copy .env.example .env  — rồi điền giá trị
npm run dev              # chế độ phát triển (HMR)
```

| Lệnh | Việc làm |
| --- | --- |
| `npm run dev` | Chạy app với dev server, sửa code là cập nhật ngay |
| `npm run build` | Build main, preload, renderer vào `out/` |
| `npm start` | Chạy bản đã build (`npm run build` trước) |
| `npm run typecheck` | Kiểm tra kiểu cho cả main/preload và renderer |

### Cấu hình `.env`

Các biến trùng với `NEXT_PUBLIC_*` trong `web-video/frontend/.env`, chỉ đổi tên tiền tố:

| `.env` của app desktop | `.env` của web |
| --- | --- |
| `VITE_API_URL` | `NEXT_PUBLIC_API_URL` |
| `VITE_SUPABASE_URL` | `NEXT_PUBLIC_SUPABASE_URL` |
| `VITE_SUPABASE_ANON_KEY` | `NEXT_PUBLIC_SUPABASE_ANON_KEY` |
| `VITE_SITE_URL` | `NEXT_PUBLIC_SITE_URL` |

Các giá trị được nhúng lúc **build**, nên đổi `.env` thì phải chạy lại `npm run dev` / `npm run build`.
`.env` đã nằm trong `.gitignore`.

### Chế độ dev không cần đăng nhập

Đặt `VITE_DEV_SKIP_AUTH=true` trong `.env` rồi chạy `npm run dev`: nếu chưa có phiên đăng nhập, app vào thẳng
Studio với một người dùng giả, có nút **DEV · chưa đăng nhập — bấm để đăng nhập thật** ở góc dưới bên phải. Chỉ hoạt
động khi chạy `npm run dev`; bản build bỏ qua biến này hoàn toàn (`src/renderer/src/lib/dev-mode.ts`).

- **Chưa đăng nhập (người dùng giả):** kho video nằm trong bộ nhớ (mất khi tải lại). Backend từ chối (401) mọi thứ cần
  tài khoản — giọng đọc, nhạc nền, credit, API key / kịch bản / lịch sử trên Supabase, tạo video. Chỉ các endpoint
  công khai (ví dụ gói credit) chạy được.
- **Bấm nút DEV để đăng nhập thật:** phiên được lưu lại, các lần `npm run dev` sau app tự dùng phiên đó và mọi chức
  năng hoạt động như bản web. Không có phiên (hoặc đăng xuất) thì quay về người dùng giả.

Bản `.env` hiện trỏ `VITE_API_URL` vào backend **đã deploy** (tài khoản và credit thật). Muốn dùng backend local
thì đổi lại thành `http://localhost:4000/api` và chạy `npm run dev:be` trong web-video.

### Việc cần làm một lần trên Supabase

Đăng nhập Google chạy trong trình duyệt hệ thống rồi quay lại app qua đường dẫn `htstudio://auth/callback`.
Thêm đúng giá trị này vào **Supabase Dashboard → Authentication → URL Configuration → Redirect URLs**.
Nếu chưa thêm, Supabase sẽ từ chối và đăng nhập không quay về được app.

## Cấu trúc

```
src/
  main/        Tiến trình chính (Node): cửa sổ, giao thức htstudio://, deep link, CORS, IPC
  preload/     Cầu nối an toàn, expose `window.ht` cho renderer
  renderer/    Giao diện React
    public/      ffmpeg worker, font phụ đề, ảnh nền, logo
    src/         Code Studio port từ web (components, contexts, hooks, lib, services)
  shared/      Hợp đồng IPC dùng chung (kênh, kiểu, URL callback)
electron.vite.config.ts
```

### Vì sao UI chạy ở `htstudio://app` thay vì `file://`

Studio dùng ffmpeg.wasm, và nó tạo Worker từ `window.location.origin`. Với `file://` origin không hợp lệ.
Bản build phục vụ `out/renderer` qua giao thức riêng (`src/main/app-protocol.ts`), kèm CSP.

### CORS

Backend của web chỉ cho phép origin của website. Thay vì sửa backend, main process viết lại header
`Access-Control-Allow-Origin` trên phản hồi **chỉ từ origin của `VITE_API_URL`**, về đúng origin của
app (`src/main/cors.ts`). Origin khác vẫn bị trình duyệt chặn như bình thường.

## Đồng bộ với web-video

Code trong `src/renderer/src/` được **copy** từ `web-video/frontend` (không phải liên kết), nên sửa ở
web không tự cập nhật sang đây. Những chỗ khác bản gốc:

| File | Khác biệt |
| --- | --- |
| `App.tsx` | Là `app/studio/page.tsx`, giữ nguyên nội dung |
| `main.tsx`, `env.d.ts` | Mới: thay `app/layout.tsx` của Next |
| `contexts/auth-context.tsx` | Đăng nhập Google qua trình duyệt hệ thống + deep link, bỏ xử lý `?code=` trên URL |
| `lib/supabase/client.ts` | Dùng `@supabase/supabase-js` (localStorage) thay `@supabase/ssr` (cookie), singleton |
| `services/http.ts` | Đọc `VITE_API_URL` |
| `components/layout/sidebar/sidebar.tsx` | `next/link` → `components/ui/app-link` (mở website ngoài app) |
| `contexts/video-library-context.tsx` | Thêm `@ts-expect-error` cho 1 lỗi kiểu có sẵn ở web (xem `FIXME`) |
| `globals.css` | Thêm biến font Geist (dùng `@fontsource`, thay `next/font`) |

Để xem toàn bộ khác biệt khi đồng bộ lại, so sánh thư mục tương ứng của hai dự án.

## Bảo mật

Renderer chạy với `contextIsolation`, `sandbox`, không bật `nodeIntegration`, có CSP, và chỉ chạm hệ thống
qua `window.ht`. IPC chỉ nhận từ chính UI của app; `openExternal` chỉ mở `http(s)`/`mailto`. Deep link chỉ
nhận đúng `htstudio://auth/callback`, và callback bị bỏ qua nếu app không đang chờ đăng nhập.
Đừng nới các thiết lập này.

## Lưu ý

- Nếu app báo `Cannot read properties of undefined (reading 'isPackaged')`, biến môi trường
  `ELECTRON_RUN_AS_NODE` đang được đặt trong terminal (thường do chạy từ extension VS Code). Xóa nó
  (`Remove-Item Env:ELECTRON_RUN_AS_NODE` trên PowerShell) rồi chạy lại.
- `npm audit` báo `zod@3` (nguy cơ cạn bộ nhớ khi validate collection cực lớn). Web đang dùng cùng bản này
  và chỉ validate dữ liệu form do người dùng nhập; nâng lên zod 4 là thay đổi phá vỡ, nên chưa làm.
