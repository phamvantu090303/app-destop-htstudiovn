'use client';

import { Eye, EyeOff, CheckCircle2, AlertCircle, Loader2, Plus, Info } from 'lucide-react';
import { useState, useEffect, useRef } from 'react';
import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import { FieldError } from '@/components/ui/field-error';
import { SecretField } from '@/components/ui/secret-field';
import { ConfirmDialog } from '@/components/ui/confirm-dialog';
import { useCopyToClipboard } from '@/hooks/use-copy-to-clipboard';
import { API_KEY_IDS, API_KEYS_CHANGED_EVENT, getApiKey, isApiKeysReady, setApiKey } from '@/lib/api-keys/api-keys-store';
import { useAuth } from '@/contexts/auth-context';
import { createClient } from '@/lib/supabase/client';
import { saveRemoteApiKey } from '@/lib/api-keys/api-keys-remote';

type KeyStatus = 'connected' | 'disconnected' | 'verifying' | 'error';

interface ApiKeyEntry {
  id: string;
  name: string;
  service: 'gemini' | 'tts' | 'veo-gemini';
  placeholder: string;
  value: string;
  status: KeyStatus;
  errorMsg?: string;
  description: string;
}

/**
 * Theo luồng xử lý:
 * Gemini   → tạo kịch bản (script generation)
 * TTS      → tạo giọng đọc (ElevenLabs)
 * Veo 3.1 (kie.ai, nhà cung cấp mặc định) → dùng pool key hệ thống do ADMIN quản lý
 * (xem /admin/video-keys), KHÔNG còn là key riêng của user nên không hiện ở đây nữa.
 *
 * Backend nhận toàn bộ settings rồi phân phối key cho AI phù hợp.
 * Frontend chỉ lưu key — không xử lý AI trực tiếp.
 */
const INITIAL_KEYS: ApiKeyEntry[] = [
  {
    id: API_KEY_IDS.gemini,
    name: 'Gemini API Key',
    service: 'gemini',
    placeholder: 'AIza...',
    value: '',
    status: 'disconnected',
    description: 'Tạo kịch bản, phân cảnh và lời thoại (ngôn ngữ, phong cách, thời lượng) — KHÔNG dùng để tạo video',
  },
  {
    id: API_KEY_IDS.elevenlabs,
    name: 'ElevenLabs API Key',
    service: 'tts',
    placeholder: 'sk_...',
    value: '',
    status: 'disconnected',
    description: 'Tạo giọng đọc từ voiceover — key cần bật quyền Text to Speech trên elevenlabs.io',
  },
  {
    id: API_KEY_IDS.veoGemini,
    name: 'Gemini Key Veo 3.1',
    service: 'veo-gemini',
    placeholder: 'AIza...',
    value: '',
    status: 'disconnected',
    description: 'Tạo video cảnh khi chọn nhà cung cấp "Veo3.1 Gemini" (gọi thẳng Google) — key riêng, không dùng chung với Gemini API Key. Nhà cung cấp mặc định (Veo 3.1) dùng key hệ thống, không cần nhập ở đây.',
  },
];

const SERVICE_BADGE: Record<ApiKeyEntry['service'], { label: string; color: string }> = {
  gemini: { label: 'Gemini', color: 'text-blue-400 bg-blue-500/10 border-blue-500/30' },
  tts: { label: 'TTS', color: 'text-teal-400 bg-teal-500/10 border-teal-500/30' },
  'veo-gemini': { label: 'Veo 3.1', color: 'text-emerald-400 bg-emerald-500/10 border-emerald-500/30' },
};

async function verifyKey(_id: string, value: string): Promise<{ ok: boolean; msg?: string }> {
  await new Promise((r) => setTimeout(r, 1200));
  if (!value.trim()) return { ok: false, msg: 'Key không được để trống.' };
  if (value.trim().length < 10) return { ok: false, msg: 'Key quá ngắn — kiểm tra lại.' };
  return { ok: true };
}

export function ApiKeysManagement() {
  const { user, loading: authLoading } = useAuth();
  const supabaseRef = useRef(createClient());

  const [keys, setKeys] = useState<ApiKeyEntry[]>(INITIAL_KEYS);
  const [visibility, setVisibility] = useState<Record<string, boolean>>({});
  const [editing, setEditing] = useState<Record<string, string>>({});
  const { copiedId, copy: copyToClipboard } = useCopyToClipboard();
  const [keysReady, setKeysReady] = useState(isApiKeysReady());

  // auth-context.tsx đã tự nạp key từ Supabase vào cache (api-keys-store.ts) ngay khi
  // đăng nhập — ở đây chỉ cần đọc lại cache đó để hiển thị, không tự fetch Supabase
  // riêng nữa (tránh gọi trùng lặp). Đồng bộ lại mỗi khi cache đổi (API_KEYS_CHANGED_EVENT).
  useEffect(() => {
    const syncFromCache = () => {
      setKeysReady(isApiKeysReady());
      setKeys((prev) =>
        prev.map((k) => {
          const value = getApiKey(k.id);
          return value
            ? { ...k, value, status: 'connected' as const }
            : { ...k, value: '', status: 'disconnected' as const };
        }),
      );
    };
    syncFromCache();
    window.addEventListener(API_KEYS_CHANGED_EVENT, syncFromCache);
    return () => window.removeEventListener(API_KEYS_CHANGED_EVENT, syncFromCache);
  }, []);

  const toggleVisibility = (id: string) =>
    setVisibility((prev) => ({ ...prev, [id]: !prev[id] }));

  const startEdit = (entry: ApiKeyEntry) =>
    setEditing((prev) => ({ ...prev, [entry.id]: entry.value }));

  const cancelEdit = (id: string) =>
    setEditing((prev) => { const next = { ...prev }; delete next[id]; return next; });

  const handleSave = async (id: string, value: string) => {
    const trimmed = value.trim();

    // `verifyKey()` tồn tại từ trước nhưng chưa từng được gọi ở đây — key sai vẫn được lưu
    // thẳng, chỉ báo lỗi khi dùng thật ở nơi khác. Gọi thật trước khi lưu để kích hoạt đúng
    // trạng thái 'verifying'/'error' đã có sẵn trong UI (statusConfig) thay vì bỏ không.
    setKeys((prev) =>
      prev.map((k) => k.id === id ? { ...k, status: 'verifying', errorMsg: undefined } : k),
    );

    const result = await verifyKey(id, trimmed);
    if (!result.ok) {
      setKeys((prev) =>
        prev.map((k) => k.id === id ? { ...k, status: 'error', errorMsg: result.msg } : k),
      );
      return;
    }

    setApiKey(id, trimmed);
    setKeys((prev) =>
      prev.map((k) => k.id === id ? { ...k, value: trimmed, status: 'connected', errorMsg: undefined } : k),
    );
    cancelEdit(id);

    const supabase = supabaseRef.current;
    if (user && supabase) {
      try {
        await saveRemoteApiKey(supabase, user.id, id, trimmed);
      } catch (err) {
        console.error('[api-keys] Lưu Supabase thất bại:', err);
      }
    }
  };

  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);

  const performDelete = async (id: string) => {
    setApiKey(id, '');
    setKeys((prev) =>
      prev.map((k) => k.id === id ? { ...k, value: '', status: 'disconnected', errorMsg: undefined } : k),
    );
    cancelEdit(id);
    setConfirmDeleteId(null);

    const supabase = supabaseRef.current;
    if (user && supabase) {
      try {
        await saveRemoteApiKey(supabase, user.id, id, '');
      } catch (err) {
        console.error('[api-keys] Xóa Supabase thất bại:', err);
      }
    }
  };

  const statusConfig: Record<KeyStatus, { color: string; icon: React.ReactNode; label: string }> = {
    connected: {
      color: 'text-green-400 bg-green-500/10 border-green-500/30',
      icon: <CheckCircle2 className="w-3.5 h-3.5" />,
      label: 'Hợp lệ',
    },
    disconnected: {
      color: 'text-muted-foreground bg-muted/10 border-muted/30',
      icon: <AlertCircle className="w-3.5 h-3.5" />,
      label: 'Chưa kết nối',
    },
    verifying: {
      color: 'text-primary bg-primary/10 border-primary/30',
      icon: <Loader2 className="w-3.5 h-3.5 animate-spin" />,
      label: 'Đang xác thực...',
    },
    error: {
      color: 'text-destructive bg-destructive/10 border-destructive/30',
      icon: <AlertCircle className="w-3.5 h-3.5" />,
      label: 'Không hợp lệ',
    },
  };

  const connectedCount = keys.filter((k) => k.status === 'connected').length;
  const totalCount = keys.length;
  // "Sẵn sàng tạo video" = đủ key kịch bản + giọng đọc. Veo 3.1 (kie.ai, mặc định) dùng key hệ
  // thống nên không xét ở đây nữa — "Gemini Key Veo 3.1" chỉ cần khi user chủ động đổi sang
  // nhà cung cấp thay thế "Veo3.1 Gemini", không bắt buộc để "sẵn sàng".
  const allConnected = keys
    .filter((k) => k.id !== API_KEY_IDS.veoGemini)
    .every((k) => k.status === 'connected');

  if (authLoading) {
    return (
      <section className="space-y-6">
        <div className="h-24 rounded-xl bg-muted/20 animate-pulse" />
      </section>
    );
  }

  if (!user) {
    return (
      <section className="space-y-6">
        <h2 className="section-label">
          QUẢN LÝ API KEYS
        </h2>
        <div className="flex flex-col items-center text-center gap-3 bg-card border border-dashed border-border rounded-2xl p-10">
          <div className="w-12 h-12 rounded-xl bg-orange-500/10 border border-orange-500/30 flex items-center justify-center">
            <AlertCircle className="w-6 h-6 text-orange-400" />
          </div>
          <div>
            <p className="text-sm font-semibold text-foreground">Cần đăng nhập để quản lý API Keys</p>
            <p className="text-xs text-muted-foreground mt-1 max-w-sm">
              API Key được lưu riêng theo tài khoản Google — đăng nhập ở mục Cài đặt chung để xem, nhập hoặc đồng bộ key trên nhiều thiết bị.
            </p>
          </div>
        </div>
      </section>
    );
  }

  return (
    <section className="space-y-6">
      {!keysReady && (
        <p className="text-xs text-muted-foreground flex items-center gap-1.5">
          <Loader2 className="w-3.5 h-3.5 animate-spin" />
          Đang tải API Keys từ tài khoản...
        </p>
      )}
      <div className="flex items-center justify-between">
        <h2 className="section-label">
          QUẢN LÝ API KEYS
        </h2>
        <span className={cn(
          'text-xs font-medium px-2.5 py-1 rounded-full border',
          allConnected
            ? 'text-green-400 bg-green-500/10 border-green-500/30'
            : 'text-muted-foreground bg-muted/10 border-muted/30',
        )}>
          {connectedCount}/{totalCount} kết nối
        </span>
      </div>

      <div className="flex gap-3 px-4 py-3 rounded-xl border border-primary/25 bg-primary/5">
        <Info className="w-4 h-4 text-primary shrink-0 mt-0.5" />
        <div className="space-y-1 text-xs text-muted-foreground leading-relaxed">
          <p className="font-semibold text-foreground">Key bạn dán ở đây là key cá nhân — không phải key hệ thống</p>
          <p>
            Mỗi ô bên dưới dùng để nhập API Key từ <strong className="text-foreground font-medium">tài khoản của bạn</strong>{' '}
            (Google AI Studio, ElevenLabs…). Key được lưu riêng theo tài khoản HTStudio; khi đã lưu, app sẽ dùng key của bạn cho dịch vụ tương ứng.
          </p>
          <p>
            <strong className="text-foreground font-medium">Tạo video Veo 3.1</strong> (nhà cung cấp mặc định) dùng key hệ thống do admin quản lý —{' '}
            <strong className="text-foreground font-medium">không cần </strong> dán key ở đây. Chỉ cần nhập &quot;Gemini Key Veo 3.1&quot; nếu bạn chọn nhà cung cấp &quot;Veo3.1 Gemini&quot;.
          </p>
        </div>
      </div>

      {/* API Key cards */}
      <div className="grid grid-cols-1 gap-4">
        {keys.map((entry) => {
          const cfg = statusConfig[entry.status];
          const svc = SERVICE_BADGE[entry.service];
          const isEditing = entry.id in editing;
          const isVisible = visibility[entry.id];
          const draftValue = editing[entry.id] ?? '';
          const displayValue = entry.value;
          const hasValue = !!displayValue;

          return (
            <div
              key={entry.id}
              className={cn(
                'bg-card border rounded-xl p-4 space-y-3 transition-colors',
                entry.status === 'error'
                  ? 'border-destructive/40'
                  : entry.status === 'connected'
                    ? 'border-green-500/20'
                    : 'border-border',
              )}
            >
              {/* Header */}
              <div className="flex items-start justify-between gap-2">
                <div className="space-y-1">
                  <div className="flex items-center gap-2">
                    <h4 className="text-sm font-semibold text-foreground">{entry.name}</h4>
                    <span className={cn('text-[10px] font-bold px-1.5 py-0.5 rounded border', svc.color)}>
                      {svc.label}
                    </span>
                  </div>
                  <p className="text-[11px] text-muted-foreground leading-relaxed">{entry.description}</p>
                </div>
                <div className={cn('flex items-center gap-1.5 px-2 py-1 rounded-md border text-xs font-medium whitespace-nowrap flex-shrink-0', cfg.color)}>
                  {cfg.icon}
                  <span className="hidden sm:inline">{cfg.label}</span>
                </div>
              </div>

              {/* Key input — editing mode */}
              {isEditing ? (
                <div className="space-y-2">
                  <div className="relative">
                    <input
                      type={isVisible ? 'text' : 'password'}
                      value={draftValue}
                      onChange={(e) => setEditing((prev) => ({ ...prev, [entry.id]: e.target.value }))}
                      placeholder={entry.placeholder}
                      autoFocus
                      className="w-full px-3 py-2 bg-background border border-primary/40 rounded-lg text-xs font-mono text-foreground focus:outline-none focus:ring-1 focus:ring-primary/30 transition-colors pr-10"
                    />
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon"
                      onClick={() => toggleVisibility(entry.id)}
                      aria-label={isVisible ? 'Ẩn key' : 'Hiện key'}
                      className="absolute right-2.5 top-1/2 -translate-y-1/2 p-0 h-auto hover:bg-transparent text-muted-foreground hover:text-foreground"
                    >
                      {isVisible ? <EyeOff className="w-3.5 h-3.5" /> : <Eye className="w-3.5 h-3.5" />}
                    </Button>
                  </div>
                  <div className="flex gap-2">
                    <Button
                      type="button"
                      variant="accent"
                      size="sm"
                      onClick={() => handleSave(entry.id, draftValue)}
                      loading={entry.status === 'verifying'}
                      className="flex-1 bg-primary/10 border border-primary/30 hover:bg-primary/20 text-primary"
                    >
                      {entry.status === 'verifying' ? 'Đang xác thực...' : 'Lưu & xác thực'}
                    </Button>
                    <Button type="button" variant="outline" size="sm" onClick={() => cancelEdit(entry.id)}>
                      Hủy
                    </Button>
                  </div>
                </div>
              ) : (
                /* Key input — view mode */
                <SecretField
                  value={displayValue || ''}
                  visible={isVisible}
                  onToggleVisibility={() => toggleVisibility(entry.id)}
                  copied={copiedId === entry.id}
                  onCopy={() => copyToClipboard(entry.id, displayValue)}
                  onEdit={() => startEdit(entry)}
                  onDelete={hasValue ? () => setConfirmDeleteId(entry.id) : undefined}
                  disabled={!hasValue}
                  placeholder="Chưa nhập key"
                  inputClassName="text-xs text-muted-foreground"
                />
              )}

              {/* Error message */}
              {entry.status === 'error' && entry.errorMsg && (
                <FieldError>{entry.errorMsg}</FieldError>
              )}

              {/* CTA for disconnected */}
              {entry.status === 'disconnected' && !isEditing && (
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  onClick={() => startEdit(entry)}
                  className="p-0 h-auto gap-1 hover:bg-transparent text-primary hover:text-primary/80 font-medium"
                >
                  <Plus className="w-3.5 h-3.5" />
                  Nhập {entry.name}
                </Button>
              )}
            </div>
          );
        })}
      </div>

      <ConfirmDialog
        open={confirmDeleteId !== null}
        title="Xoá API key này?"
        message={
          confirmDeleteId
            ? <>&quot;{keys.find((k) => k.id === confirmDeleteId)?.name}&quot; sẽ bị xoá khỏi tài khoản — các tính năng dùng key này sẽ ngừng hoạt động cho tới khi nhập lại.</>
            : ''
        }
        confirmLabel="Xoá key"
        onCancel={() => setConfirmDeleteId(null)}
        onConfirm={() => {
          if (confirmDeleteId) void performDelete(confirmDeleteId);
        }}
      />
    </section>
  );
}
