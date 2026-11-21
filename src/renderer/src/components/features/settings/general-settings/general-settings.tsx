'use client';

import { useState, useEffect } from 'react';
import { CheckCircle2 } from 'lucide-react';
import { cn } from '@/lib/utils';
import { useAuth } from '@/contexts/auth-context';
import { useTheme } from '@/hooks/use-theme';
import { DEFAULT_PREFERENCES, getStoredPreferences, savePreferences } from '@/lib/general-preferences';
import { Button } from '@/components/ui/button';
import { ConfirmDialog } from '@/components/ui/confirm-dialog';

export function GoogleIcon({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" aria-hidden="true">
      <path fill="#4285F4" d="M23.52 12.27c0-.85-.08-1.67-.22-2.45H12v4.63h6.47a5.54 5.54 0 0 1-2.4 3.63v3h3.88c2.27-2.09 3.57-5.17 3.57-8.81Z" />
      <path fill="#34A853" d="M12 24c3.24 0 5.96-1.07 7.95-2.92l-3.88-3c-1.08.72-2.45 1.15-4.07 1.15-3.13 0-5.78-2.11-6.73-4.96H1.26v3.11A12 12 0 0 0 12 24Z" />
      <path fill="#FBBC05" d="M5.27 14.27a7.2 7.2 0 0 1 0-4.54v-3.11H1.26a12 12 0 0 0 0 10.76l4.01-3.11Z" />
      <path fill="#EA4335" d="M12 4.75c1.77 0 3.35.61 4.6 1.8l3.44-3.44C17.95 1.19 15.24 0 12 0 7.31 0 3.26 2.69 1.26 6.62l4.01 3.11C6.22 6.86 8.87 4.75 12 4.75Z" />
    </svg>
  );
}

interface Toggle {
  id: string;
  label: string;
  description?: string;
  value: boolean;
}

export function GeneralSettings() {
  const { theme, setTheme } = useTheme();
  const [saved, setSaved] = useState(false);
  // Khởi tạo bằng giá trị mặc định (khớp SSR) rồi mới đọc localStorage thật sau khi mount —
  // đọc thẳng localStorage trong useState initializer sẽ lệch giữa server (không có window) và
  // client, gây hydration mismatch. Xem lib/general-preferences.ts (cùng pattern lib/theme.ts).
  const [preferences, setPreferences] = useState(DEFAULT_PREFERENCES);

  useEffect(() => {
    setPreferences(getStoredPreferences());
  }, []);

  const toggles: Toggle[] = [
    { id: 'sound', label: 'Thông báo âm thanh', description: 'Phát âm thanh khi render hoàn tất', value: preferences.sound },
    { id: 'autosave', label: 'Tự động lưu', description: 'Lưu project mỗi 5 phút', value: preferences.autosave },
    { id: 'tips', label: 'Hiện gợi ý', description: 'Hiển thị hướng dẫn và gợi ý khi dùng app', value: preferences.tips },
  ];

  const flipToggle = (id: string) => {
    setPreferences((prev) => ({ ...prev, [id]: !prev[id as 'sound' | 'autosave' | 'tips'] }));
    setSaved(false);
  };

  const handleSave = () => {
    savePreferences(preferences);
    setSaved(true);
    setTimeout(() => setSaved(false), 2500);
  };

  return (
    <div className="bg-card border border-border rounded-lg p-6 space-y-6">
      <h4 className="text-sm font-semibold text-foreground">Cài đặt chung</h4>

      {/* Language — chỉ "Tiếng Việt" vì app chưa có hệ thống dịch (i18n) thật, ẩn English/中文
          thay vì hiện 2 lựa chọn không có tác dụng gì khi chọn (UX_UI_AUDIT.md, mục 15.5) */}
      <div>
        <label className="text-xs font-medium text-muted-foreground block mb-2">Ngôn ngữ hiển thị</label>
        <select
          value={preferences.language}
          onChange={(e) => { setPreferences((prev) => ({ ...prev, language: e.target.value })); setSaved(false); }}
          disabled
          className="w-full px-3 py-2 bg-background border border-border rounded-lg text-sm text-foreground disabled:opacity-60 disabled:cursor-not-allowed transition-colors"
        >
          <option value="vi">Tiếng Việt</option>
        </select>
        <p className="text-xs text-muted-foreground mt-1.5">Sắp hỗ trợ thêm ngôn ngữ khác.</p>
      </div>

      {/* Theme */}
      <div>
        <label className="text-xs font-medium text-muted-foreground block mb-2">Chủ đề giao diện</label>
        <div className="flex gap-2">
          {(['dark', 'light'] as const).map((t) => (
            <button
              key={t}
              type="button"
              onClick={() => setTheme(t)}
              className={cn(
                'flex-1 px-3 py-2 rounded-lg text-xs font-medium border transition-all',
                theme === t
                  ? 'bg-primary/20 border-primary/50 text-primary'
                  : 'bg-border/30 border-border text-muted-foreground hover:border-primary/30 hover:text-foreground',
              )}
            >
              {t === 'dark' ? '🌙 Tối' : '☀️ Sáng'}
            </button>
          ))}
        </div>
        <p className="text-xs text-muted-foreground mt-2">
          Áp dụng ngay, không cần lưu hay tải lại trang.
        </p>
      </div>

      {/* Toggles */}
      <div className="space-y-3 pt-1 border-t border-border">
        {toggles.map((toggle) => (
          <div key={toggle.id} className="flex items-center justify-between gap-4 py-1">
            <div>
              <p className="text-xs font-medium text-foreground">{toggle.label}</p>
              {toggle.description && (
                <p className="text-xs text-muted-foreground mt-0.5">{toggle.description}</p>
              )}
            </div>
            <button
              type="button"
              role="switch"
              aria-checked={toggle.value}
              onClick={() => flipToggle(toggle.id)}
              className={cn(
                'relative inline-flex h-5 w-9 items-center rounded-full transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-primary/50 flex-shrink-0',
                toggle.value ? 'bg-primary' : 'bg-muted',
              )}
            >
              <span
                className={cn(
                  'inline-block h-4 w-4 transform rounded-full bg-white shadow transition-transform',
                  toggle.value ? 'translate-x-4' : 'translate-x-0.5',
                )}
              />
              <span className="sr-only">{toggle.label}</span>
            </button>
          </div>
        ))}
      </div>

      {/* Account */}
      <AccountSection />

      {/* Actions */}
      <div className="flex items-center justify-end border-t border-border pt-5">
        <Button
          type="button"
          variant="accent"
          onClick={handleSave}
          className={cn(
            saved
              ? 'bg-green-600/20 hover:bg-green-600/20 border border-green-600/40 text-green-400 cursor-default'
              : 'bg-primary/10 border border-primary/30 text-primary hover:bg-primary/20',
          )}
        >
          {saved ? (
            <><CheckCircle2 className="w-4 h-4" /> Đã lưu</>
          ) : 'Lưu thay đổi'}
        </Button>
      </div>
    </div>
  );
}

function AccountSection() {
  const { user, loading, signingIn, signingOut, signInWithGoogle, signOut } = useAuth();
  const [confirmSignOut, setConfirmSignOut] = useState(false);

  return (
    <div className="border-t border-border pt-5 space-y-3">
      <h5 className="text-xs font-semibold text-foreground uppercase tracking-wider">Tài khoản</h5>

      {loading ? (
        <div className="flex items-center gap-3 py-1 animate-pulse">
          <div className="w-10 h-10 rounded-full bg-muted" />
          <div className="space-y-1.5">
            <div className="h-3 w-32 rounded bg-muted" />
            <div className="h-2.5 w-40 rounded bg-muted" />
          </div>
        </div>
      ) : user ? (
        <div className="flex items-center justify-between gap-3">
          <div className="flex items-center gap-3 min-w-0">
            {user.user_metadata?.avatar_url ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                src={user.user_metadata.avatar_url}
                alt=""
                className="w-10 h-10 rounded-full object-cover border border-border shrink-0"
              />
            ) : (
              <div className="w-10 h-10 rounded-full bg-primary/15 border border-primary/30 flex items-center justify-center text-sm font-bold text-primary shrink-0">
                {(user.user_metadata?.full_name?.[0] ?? user.email?.[0] ?? '?').toUpperCase()}
              </div>
            )}
            <div className="min-w-0">
              <p className="text-sm font-semibold text-foreground truncate">
                {user.user_metadata?.full_name ?? user.email}
              </p>
              <p className="text-xs text-muted-foreground truncate">{user.email}</p>
            </div>
          </div>
          <Button
            type="button"
            variant="ghost-danger"
            size="sm"
            onClick={() => setConfirmSignOut(true)}
            loading={signingOut}
            className="bg-destructive/10 hover:bg-destructive/20 shrink-0"
          >
            Đăng xuất
          </Button>

          <ConfirmDialog
            open={confirmSignOut}
            title="Đăng xuất khỏi tài khoản?"
            message="Bạn sẽ cần đăng nhập lại bằng Google để tiếp tục dùng API Key và video đã lưu."
            confirmLabel="Đăng xuất"
            onCancel={() => setConfirmSignOut(false)}
            onConfirm={() => { setConfirmSignOut(false); void signOut(); }}
          />
        </div>
      ) : (
        <Button
          type="button"
          variant="outline"
          onClick={() => signInWithGoogle()}
          loading={signingIn}
          className="w-full py-2.5 bg-background hover:border-primary/40 hover:bg-muted/30"
        >
          {!signingIn && <GoogleIcon className="w-4 h-4" />}
          {signingIn ? 'Đang chuyển tới Google...' : 'Đăng nhập bằng Google'}
        </Button>
      )}
    </div>
  );
}
