'use client';

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import { CheckCircle2, AlertCircle, Loader2, X } from 'lucide-react';
import type { User } from '@supabase/supabase-js';
import { createClient } from '@/lib/supabase/client';
import { toUserMessage, ACCOUNT_BLOCKED_EVENT } from '@/lib/error-messages';
import { clearAllApiKeys, loadApiKeysFromRemote } from '@/lib/api-keys/api-keys-store';
import { setAccessToken as setGlobalAccessToken } from '@/lib/auth/access-token';
import { getDeviceFingerprint } from '@/lib/device-fingerprint';
import { creditService } from '@/services/credit/credit.service';
import { AUTH_CALLBACK_URL, type AuthCallbackPayload } from '@shared/ipc';
import { DEV_SKIP_AUTH, DEV_USER_ID, isDevFakeUser } from '@/lib/dev-mode';

/** Nếu user bỏ dở đăng nhập trong trình duyệt, sau chừng này ms thì nút "Đăng nhập" được mở lại. */
const SIGN_IN_TIMEOUT_MS = 3 * 60 * 1000;
/** Sau chừng này ms mà trình duyệt chưa quay về app, banner gợi ý nguyên nhân thường gặp (chỉ ở dev). */
const REDIRECT_HINT_DELAY_MS = 20 * 1000;

/** Người dùng giả cho chế độ DEV_SKIP_AUTH (xem lib/dev-mode.ts). */
const DEV_USER = {
  id: DEV_USER_ID,
  aud: 'authenticated',
  email: 'dev@local',
  app_metadata: {},
  user_metadata: { full_name: 'Dev (chưa đăng nhập)' },
  created_at: '1970-01-01T00:00:00.000Z',
} as User;

/**
 * Lấy `code` / `error` từ thứ user dán vào: đường dẫn trên thanh địa chỉ trình duyệt (khi Supabase
 * chưa cho phép `htstudio://auth/callback` nên trình duyệt rơi về Site URL kèm `?code=...`) hoặc
 * chính mã code. Trả null nếu không nhận ra.
 */
function parsePastedCallback(raw: string): AuthCallbackPayload | null {
  const text = raw.trim();
  if (!text) return null;
  try {
    const url = new URL(text);
    // Lỗi của Supabase đôi khi nằm ở phần #fragment thay vì ?query.
    const sources = [url.searchParams, new URLSearchParams(url.hash.replace(/^#/, ''))];
    for (const params of sources) {
      const code = params.get('code') ?? undefined;
      const error = params.get('error') ?? undefined;
      if (code || error) {
        return { code, error, errorDescription: params.get('error_description') ?? undefined };
      }
    }
    return null;
  } catch {
    return /^[\w.~-]{8,}$/.test(text) ? { code: text } : null;
  }
}

interface AuthContextValue {
  user: User | null;
  /** Supabase access token — dùng gọi API backend cần xác thực */
  accessToken: string | null;
  loading: boolean;
  signInError: string | null;
  signingIn: boolean;
  signingOut: boolean;
  /** Desktop: mở trang đăng nhập Google trong trình duyệt hệ thống; phiên quay lại app qua deep
   *  link `htstudio://auth/callback` (main process chuyển tiếp, xem effect nhận callback bên dưới). */
  signInWithGoogle: () => Promise<void>;
  signOut: () => Promise<void>;
  clearSignInError: () => void;
}

const AuthContext = createContext<AuthContextValue | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const supabaseRef = useRef(createClient());
  const [user, setUser] = useState<User | null>(DEV_SKIP_AUTH ? DEV_USER : null);
  const [accessToken, setAccessToken] = useState<string | null>(null);
  const [loading, setLoading] = useState(!DEV_SKIP_AUTH);
  const [signingIn, setSigningIn] = useState(false);
  const [signingOut, setSigningOut] = useState(false);
  const [signInError, setSignInError] = useState<string | null>(null);
  const [justSignedIn, setJustSignedIn] = useState(false);
  /** Đã nạp API Keys từ Supabase cho đúng user này chưa — tránh nạp lặp mỗi lần user object đổi tham chiếu */
  const apiKeysLoadedForRef = useRef<string | null>(null);
  /** Đã gọi claim-free-credit cho user này trong tab hiện tại chưa — gọi lại vẫn AN TOÀN
   *  (backend chỉ đánh giá 1 lần/user), ref này chỉ để tránh gọi lặp vô ích mỗi lần re-render. */
  const freeCreditClaimedForRef = useRef<string | null>(null);
  /** Đã hiện toast "Đã đăng nhập" cho lượt redirect OAuth này chưa — chỉ hiện ĐÚNG 1 LẦN, dù
   *  `onAuthStateChange` có bắn thêm SIGNED_IN sau đó (đổi tab, refresh token...) */
  const oauthToastShownRef = useRef(false);
  /** True trong lúc signOut() đang chạy DO tài khoản vừa bị khoá — nếu chính signOut() này lại
   *  lỗi (vd mất mạng ngay lúc đó), catch của signOut() không được ghi đè thông báo "bị khoá"
   *  bằng "Đăng xuất thất bại", kẻo mất lý do thật user cần biết (UX_UI_AUDIT.md, mục 15.10). */
  const accountBlockedRef = useRef(false);
  /** Đang chờ user đăng nhập xong trong trình duyệt. Deep link `htstudio://` ai cũng gọi được,
   *  nên callback không do chính app này khởi tạo sẽ bị bỏ qua. */
  const awaitingOAuthRef = useRef(false);
  const signInTimeoutRef = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const redirectHintTimeoutRef = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  /** Banner "đang chờ trình duyệt" + gợi ý khi trình duyệt không quay về app. */
  const [waitingForBrowser, setWaitingForBrowser] = useState(false);
  const [showRedirectHint, setShowRedirectHint] = useState(false);
  /** Ô "dán đường dẫn" của banner (chỉ hiện ở dev, sau REDIRECT_HINT_DELAY_MS). */
  const [pastedLink, setPastedLink] = useState('');
  const [pasteError, setPasteError] = useState<string | null>(null);
  /** Lượt đăng nhập Google vừa hoàn tất — dùng để hiện toast "Đã đăng nhập" đúng 1 lần. */
  const oauthCompletedRef = useRef(false);

  // Đẩy access token sang module state — các service (admin, payment) nằm ngoài cây React
  // nên không đọc được context, theo đúng pattern api-keys-store.ts. Chạy đồng bộ theo mọi
  // thay đổi phiên, kể cả lúc đăng xuất (null).
  useEffect(() => {
    setGlobalAccessToken(accessToken);
  }, [accessToken]);

  // Nạp API Keys ngay khi phát hiện đăng nhập — không cần user tự mở màn "API Keys"
  // mới có key khả dụng cho phần còn lại của app (tạo kịch bản/video cần đọc key ngay).
  useEffect(() => {
    const supabase = supabaseRef.current;
    if (!supabase || !user || isDevFakeUser(user)) return;
    if (apiKeysLoadedForRef.current === user.id) return;
    apiKeysLoadedForRef.current = user.id;
    void loadApiKeysFromRemote(supabase, user.id);
  }, [user]);

  // Cấp credit dùng thử (nếu đủ điều kiện) — chạy nền, không chặn UI. Gọi 1 lần/user/tab;
  // backend tự đảm bảo mỗi user chỉ được đánh giá đúng 1 lần dù gọi lại bao nhiêu lần (F5,
  // đăng nhập lại...), nên không cần lo double-claim nếu ref này bị reset (StrictMode...).
  useEffect(() => {
    if (!user || isDevFakeUser(user)) return;
    if (freeCreditClaimedForRef.current === user.id) return;
    freeCreditClaimedForRef.current = user.id;

    void (async () => {
      try {
        const fingerprint = await getDeviceFingerprint();
        await creditService.claimFree(fingerprint);
      } catch {
        // Lỗi tạm thời (mất mạng, fingerprint lib lỗi...) — im lặng, không chặn đăng nhập.
        // User vẫn dùng app bình thường, chỉ là chưa được cấp credit dùng thử lần này.
      }
    })();
  }, [user]);

  useEffect(() => {
    const supabase = supabaseRef.current;
    if (!supabase) {
      setLoading(false);
      return;
    }

    // DEV_SKIP_AUTH: không có phiên thật thì giữ người dùng giả thay vì null (xem lib/dev-mode.ts).
    const noSessionUser = DEV_SKIP_AUTH ? DEV_USER : null;

    supabase.auth.getSession().then(({ data }) => {
      const token = data.session?.access_token ?? null;
      setGlobalAccessToken(token);
      setUser(data.session?.user ?? noSessionUser);
      setAccessToken(token);
      setLoading(false);
    });

    const { data: subscription } = supabase.auth.onAuthStateChange((event, session) => {
      const token = session?.access_token ?? null;
      setGlobalAccessToken(token);
      setUser(session?.user ?? noSessionUser);
      setAccessToken(token);
      setLoading(false);
      setSigningIn(false);
      if (event === 'SIGNED_IN' && oauthCompletedRef.current && !oauthToastShownRef.current) {
        oauthToastShownRef.current = true;
        setJustSignedIn(true);
        setTimeout(() => setJustSignedIn(false), 4000);
      }
    });

    return () => {
      subscription.subscription.unsubscribe();
    };
  }, []);

  /** Dừng chờ trình duyệt: tắt cờ, hai timer và banner. Không đụng tới `signingIn`. */
  const finishWaiting = useCallback(() => {
    awaitingOAuthRef.current = false;
    clearTimeout(signInTimeoutRef.current);
    clearTimeout(redirectHintTimeoutRef.current);
    setWaitingForBrowser(false);
    setShowRedirectHint(false);
    setPastedLink('');
    setPasteError(null);
  }, []);

  const cancelSignIn = useCallback(() => {
    finishWaiting();
    setSigningIn(false);
  }, [finishWaiting]);

  /** Hoàn tất đăng nhập với kết quả OAuth (từ deep link hoặc từ đường dẫn user dán): đổi code lấy
   *  phiên. PKCE: verifier do signInWithOAuth lưu nằm trong storage của chính app này. */
  const completeSignIn = useCallback(
    async (payload: AuthCallbackPayload) => {
      const supabase = supabaseRef.current;
      if (!supabase) return;
      if (!awaitingOAuthRef.current) {
        console.warn('[auth] Nhận callback đăng nhập nhưng app không đang chờ — bỏ qua.');
        return; // Not started by this app — ignore.
      }
      finishWaiting();

      if (payload.error || !payload.code) {
        setSignInError(toUserMessage(payload.errorDescription ?? payload.error, 'Đăng nhập Google thất bại — thử lại.'));
        setSigningIn(false);
        return;
      }

      oauthCompletedRef.current = true;
      const { error } = await supabase.auth.exchangeCodeForSession(payload.code);
      if (error) {
        oauthCompletedRef.current = false;
        setSignInError(toUserMessage(error, 'Đăng nhập Google thất bại — thử lại.'));
        setSigningIn(false);
      }
      // Thành công → onAuthStateChange(SIGNED_IN) cập nhật user và tắt signingIn.
    },
    [finishWaiting],
  );

  const submitPastedLink = useCallback(() => {
    const payload = parsePastedCallback(pastedLink);
    if (!payload) {
      setPasteError('Không thấy mã đăng nhập (?code=…) trong nội dung vừa dán.');
      return;
    }
    setPasteError(null);
    void completeSignIn(payload);
  }, [pastedLink, completeSignIn]);

  // Desktop: Google sign-in finishes in the system browser, which redirects to
  // `htstudio://auth/callback?code=...`. The main process forwards it here.
  useEffect(() => {
    if (!supabaseRef.current) return;
    return window.ht.onAuthCallback((payload) => void completeSignIn(payload));
  }, [completeSignIn]);

  useEffect(
    () => () => {
      clearTimeout(signInTimeoutRef.current);
      clearTimeout(redirectHintTimeoutRef.current);
    },
    [],
  );

  const signInWithGoogle = useCallback(async () => {
    setSignInError(null);
    if (!supabaseRef.current) {
      setSignInError('Đăng nhập Google chưa được cấu hình — thiếu VITE_SUPABASE_URL / VITE_SUPABASE_ANON_KEY trong file .env.');
      return;
    }
    setSigningIn(true);
    try {
      // skipBrowserRedirect: lấy URL đăng nhập về thay vì để supabase-js điều hướng chính cửa sổ app.
      const { data, error } = await supabaseRef.current.auth.signInWithOAuth({
        provider: 'google',
        options: { redirectTo: AUTH_CALLBACK_URL, skipBrowserRedirect: true },
      });
      if (error || !data?.url) {
        setSignInError(toUserMessage(error, 'Đăng nhập Google thất bại — thử lại.'));
        setSigningIn(false);
        return;
      }

      finishWaiting(); // dọn lượt chờ trước (nếu bấm đăng nhập lại)
      awaitingOAuthRef.current = true;
      setWaitingForBrowser(true);
      signInTimeoutRef.current = setTimeout(() => {
        if (!awaitingOAuthRef.current) return;
        finishWaiting();
        setSigningIn(false);
        setSignInError('Chưa nhận được kết quả đăng nhập từ trình duyệt — thử lại.');
      }, SIGN_IN_TIMEOUT_MS);
      if (process.env.NODE_ENV === 'development') {
        redirectHintTimeoutRef.current = setTimeout(() => setShowRedirectHint(true), REDIRECT_HINT_DELAY_MS);
      }

      const opened = await window.ht.openExternal(data.url);
      if (!opened) {
        finishWaiting();
        setSignInError('Không mở được trình duyệt để đăng nhập — thử lại.');
        setSigningIn(false);
      }
      // Thành công → user hoàn tất ở trình duyệt, kết quả quay về qua effect nhận callback.
    } catch (err) {
      finishWaiting();
      setSignInError(toUserMessage(err, 'Đăng nhập Google thất bại — thử lại.'));
      setSigningIn(false);
    }
  }, [finishWaiting]);

  const signOut = useCallback(async () => {
    if (!supabaseRef.current) return;
    setSigningOut(true);
    try {
      const { error } = await supabaseRef.current.auth.signOut();
      if (error) {
        setSignInError(toUserMessage(error, 'Đăng xuất thất bại — thử lại.'));
      } else {
        // Xóa cache API key của tài khoản vừa thoát — chạy ở đây (không phải trong
        // component riêng) để luôn có hiệu lực bất kể đang mở trang nào, tránh rò rỉ
        // key sang phiên đăng nhập sau. Reset ref để lần đăng nhập sau tự nạp lại.
        clearAllApiKeys();
        apiKeysLoadedForRef.current = null;
      }
    } catch (err) {
      if (!accountBlockedRef.current) {
        setSignInError(toUserMessage(err, 'Đăng xuất thất bại — thử lại.'));
      }
    } finally {
      setSigningOut(false);
    }
  }, []);

  // Tài khoản bị khoá giữa phiên (admin khoá trong lúc user vẫn đang mở app) — bất kỳ API nào
  // cũng có thể phát hiện điều này (xem mapAppError trong error-messages.ts, nơi bắn sự kiện
  // này). Đăng xuất NGAY bằng đúng signOut() sẵn có — không tạo luồng đăng xuất riêng — để xoá
  // sạch session/API keys y hệt đăng xuất thường, rồi cây component tự về màn hình đăng nhập
  // vì gate `!user` ở app/page.tsx (không cần điều hướng thủ công).
  useEffect(() => {
    const handleAccountBlocked = () => {
      setSignInError('Tài khoản của bạn đã bị khoá. Vui lòng liên hệ quản trị viên để được hỗ trợ.');
      accountBlockedRef.current = true;
      void signOut().finally(() => { accountBlockedRef.current = false; });
    };
    window.addEventListener(ACCOUNT_BLOCKED_EVENT, handleAccountBlocked);
    return () => window.removeEventListener(ACCOUNT_BLOCKED_EVENT, handleAccountBlocked);
  }, [signOut]);

  const clearSignInError = useCallback(() => setSignInError(null), []);

  const value = useMemo(
    () => ({ user, accessToken, loading, signInError, signingIn, signingOut, signInWithGoogle, signOut, clearSignInError }),
    [user, accessToken, loading, signInError, signingIn, signingOut, signInWithGoogle, signOut, clearSignInError],
  );

  return (
    <AuthContext.Provider value={value}>
      {children}
      {isDevFakeUser(user) && (
        <button
          type="button"
          onClick={() => void signInWithGoogle()}
          disabled={signingIn}
          title="Đăng nhập thật để dùng giọng đọc, nhạc nền, credit và tạo video"
          className="fixed bottom-3 right-3 z-(--z-top) rounded-md bg-amber-500/90 px-2.5 py-1 text-[11px] font-semibold text-black shadow-lg hover:bg-amber-400 disabled:opacity-70"
        >
          {signingIn ? 'DEV · đang đăng nhập…' : 'DEV · chưa đăng nhập — bấm để đăng nhập thật'}
        </button>
      )}
      {justSignedIn && user && (
        <div className="fixed top-4 left-1/2 -translate-x-1/2 z-(--z-top) flex items-center gap-2 px-4 py-2.5 rounded-lg bg-green-600/90 text-white text-sm font-medium shadow-lg animate-in fade-in slide-in-from-top-2">
          <CheckCircle2 className="w-4 h-4 shrink-0" />
          Đã đăng nhập bằng Google — {user.user_metadata?.full_name ?? user.email}
        </div>
      )}
      {waitingForBrowser && (
        <div
          role="status"
          className="fixed top-4 left-1/2 -translate-x-1/2 z-(--z-top) flex items-start gap-3 w-[min(28rem,calc(100vw-2rem))] px-4 py-3 rounded-lg bg-card text-foreground border border-border text-sm shadow-lg animate-in fade-in slide-in-from-top-2"
        >
          <Loader2 className="w-4 h-4 shrink-0 mt-0.5 animate-spin" />
          <div className="flex-1 min-w-0 space-y-1">
            <p className="font-medium">Đang chờ bạn đăng nhập trong trình duyệt…</p>
            <p className="text-muted-foreground">
              Hoàn tất đăng nhập Google, rồi bấm mở HTStudio khi trình duyệt hỏi.
            </p>
            {showRedirectHint && (
              <div className="space-y-1.5 pt-1">
                <p className="text-muted-foreground">
                  Trình duyệt không quay lại app? Cách sửa hẳn: thêm <code className="text-foreground">{AUTH_CALLBACK_URL}</code>{' '}
                  vào Supabase → Authentication → URL Configuration → Redirect URLs. Tạm thời: copy đường dẫn trên
                  thanh địa chỉ trình duyệt (có <code className="text-foreground">?code=…</code>) rồi dán vào đây.
                </p>
                <form
                  className="flex gap-2"
                  onSubmit={(event) => {
                    event.preventDefault();
                    submitPastedLink();
                  }}
                >
                  <input
                    value={pastedLink}
                    onChange={(event) => {
                      setPastedLink(event.target.value);
                      setPasteError(null);
                    }}
                    placeholder="Dán đường dẫn có ?code=… từ trình duyệt"
                    aria-label="Dán đường dẫn đăng nhập từ trình duyệt"
                    className="flex-1 min-w-0 rounded-md border border-border bg-input px-2 py-1 text-xs text-foreground"
                  />
                  <button
                    type="submit"
                    className="shrink-0 rounded-md bg-primary px-2.5 py-1 text-xs font-medium text-primary-foreground hover:opacity-90"
                  >
                    Xác nhận
                  </button>
                </form>
                {pasteError && <p className="text-xs text-destructive">{pasteError}</p>}
              </div>
            )}
          </div>
          <button type="button" onClick={cancelSignIn} className="shrink-0 text-xs underline hover:opacity-70">
            Hủy
          </button>
        </div>
      )}
      {signInError && (
        <div className="fixed top-4 left-1/2 -translate-x-1/2 z-(--z-top) flex items-start gap-2 max-w-md px-4 py-2.5 rounded-lg bg-destructive text-destructive-foreground text-sm font-medium shadow-lg animate-in fade-in slide-in-from-top-2">
          <AlertCircle className="w-4 h-4 shrink-0 mt-0.5" />
          <span className="flex-1">{signInError}</span>
          <button type="button" onClick={clearSignInError} className="shrink-0 hover:opacity-70" aria-label="Đóng thông báo lỗi">
            <X className="w-4 h-4" />
          </button>
        </div>
      )}
    </AuthContext.Provider>
  );
}

export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext);
  if (!ctx) {
    throw new Error('useAuth must be used within AuthProvider');
  }
  return ctx;
}
