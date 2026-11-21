// ─── Chuẩn hóa message lỗi hiển thị cho user — không show raw/English error ──

/**
 * Bắn khi phát hiện lỗi `ACCOUNT_BLOCKED` (tài khoản bị khoá) từ BẤT KỲ API nào — AuthProvider
 * lắng nghe sự kiện này để đăng xuất ngay lập tức (dùng lại `signOut()` sẵn có, không tạo logic
 * xác thực mới). Đặt ở đây (không phải auth-context.tsx) vì đây là nơi DUY NHẤT parse lỗi từ
 * mọi service — auth-context không tự gọi API nên không có chỗ khác để phát hiện điều kiện này.
 */
export const ACCOUNT_BLOCKED_EVENT = 'web-video-account-blocked';

interface ErrorPattern {
  test: RegExp;
  message: string;
}

const ERROR_PATTERNS: ErrorPattern[] = [
  {
    test: /failed to fetch|networkerror|load failed|ERR_CONNECTION/i,
    message: 'Không kết nối được máy chủ. Kiểm tra mạng và thử lại.',
  },
  {
    test: /api key not valid|invalid api key|api_key_invalid/i,
    message: 'API Key không hợp lệ — kiểm tra lại tại mục API Keys.',
  },
  {
    test: /permission_denied|permission denied/i,
    message: 'API Key thiếu quyền truy cập — kiểm tra lại quyền tại nơi tạo key.',
  },
  {
    test: /resource_exhausted|quota|billing/i,
    message: 'Tài khoản API đã hết quota/billing — kiểm tra lại tại trang quản lý API Key.',
  },
  {
    test: /unauthenticated|401/,
    message: 'API Key không hợp lệ hoặc đã hết hạn — kiểm tra lại tại mục API Keys.',
  },
  {
    test: /provider is not enabled|unsupported provider|validation_failed/i,
    message: 'Đăng nhập Google chưa được bật cho ứng dụng này — liên hệ quản trị viên để cấu hình lại.',
  },
  {
    test: /popup.?closed|user closed the popup|cancelled/i,
    message: 'Đã hủy đăng nhập.',
  },
  {
    test: /invalid login credentials/i,
    message: 'Không đăng nhập được — thử lại hoặc dùng tài khoản Google khác.',
  },
  {
    test: /insufficient.*balance/i,
    message: 'Tài khoản đã hết số dư — nạp thêm tại trang quản lý API Key.',
  },
  {
    test: /rate limit|too many requests/i,
    message: 'Đang giới hạn tần suất request — chờ một lát rồi thử lại.',
  },
  {
    test: /resource not found/i,
    message: 'Không tìm thấy tài nguyên (task hoặc model không hợp lệ).',
  },
  {
    test: /parameter validation failed|invalid request parameters/i,
    message: 'Tham số gửi lên không hợp lệ — thử đổi mô tả cảnh hoặc cài đặt.',
  },
  {
    test: /unable to generate audio|encountered an issue with the audio|issue with the audio for your prompt|could not create your video.*audio/i,
    message:
      'Google Veo không tạo được âm thanh cho cảnh này — thử sửa prompt (bớt lời thoại/mô tả âm thanh), dùng model Fast, hoặc bấm Tạo lại.',
  },
];

/** Message quá dài hoặc chứa dấu hiệu lỗi kỹ thuật (stack, code lạ) — không nên hiện nguyên văn */
function looksTechnical(message: string): boolean {
  if (message.length > 220) return true;
  return /\bat \S+:\d+:\d+|node_modules|wasm|undefined is not|Cannot read propert/i.test(message);
}

/** Message đã có vẻ là tiếng Việt thân thiện (đa số message từ backend/services hiện tại) */
function looksLikeFriendlyVietnamese(message: string): boolean {
  return /[àáảãạăắằẳẵặâấầẩẫậđèéẻẽẹêếềểễệìíỉĩịòóỏõọôốồổỗộơớờởỡợùúủũụưứừửữựỳýỷỹỵ]/i.test(message);
}

/**
 * Chuyển bất kỳ lỗi nào (Error, string, unknown) thành message tiếng Việt rõ ràng,
 * an toàn để hiển thị trực tiếp cho user — không bao giờ lộ stack trace / object lạ.
 */
export function toUserMessage(err: unknown, fallback = 'Đã xảy ra lỗi — vui lòng thử lại.'): string {
  const raw = err instanceof Error ? err.message : typeof err === 'string' ? err : '';
  if (!raw.trim()) return fallback;

  const matched = ERROR_PATTERNS.find((p) => p.test.test(raw));
  if (matched) return matched.message;

  if (looksLikeFriendlyVietnamese(raw) && !looksTechnical(raw)) {
    return raw;
  }

  if (looksTechnical(raw)) return fallback;

  // Message tiếng Anh ngắn, không khớp pattern nào đã biết — vẫn không chắc user hiểu được,
  // nhưng ngắn nên giữ lại kèm fallback để không mất thông tin hoàn toàn.
  return raw.length <= 140 ? raw : fallback;
}

// ─── Error mapping layer có cấu trúc — dùng cho banner/toast/dialog cần cả  ───
// ─── "chuyện gì / vì sao / làm gì tiếp theo" thay vì 1 dòng message đơn    ───

/** Loại hành động khắc phục — component hiển thị (toast/banner/dialog) tự map sang onClick thật */
export type AppErrorActionType =
  | 'retry'
  | 'retry-after'
  | 'login-again'
  | 'go-api-keys'
  | 'go-credits'
  | 'go-library'
  | 'switch-provider'
  | 'go-blog';

export interface AppError {
  /** Chuyện gì xảy ra — ngắn gọn, làm tiêu đề */
  title: string;
  /** Vì sao / chi tiết thêm để user hiểu — có thể rỗng nếu title đã đủ rõ */
  description?: string;
  /** Làm gì tiếp theo — nhãn nút hành động, undefined nghĩa là không có hành động khắc phục nào (vd lỗi 403) */
  actionLabel?: string;
  actionType?: AppErrorActionType;
  /** Chỉ có khi actionType === 'retry-after' */
  retryAfterSeconds?: number;
}

interface MapAppErrorOptions {
  /** HTTP status nếu có — ưu tiên map theo status trước khi thử đoán qua message */
  status?: number;
  /** Tên provider (Veo/Gemini/ElevenLabs...) để chèn vào message API key/provider lỗi */
  provider?: string;
  /** Số giây chờ nếu backend có trả (header Retry-After...) */
  retryAfterSeconds?: number;
}

function isOffline(): boolean {
  return typeof navigator !== 'undefined' && navigator.onLine === false;
}

/** Ánh xạ errorCode/HTTP status + message thô → AppError có đủ 3 phần, tiếng Việt, có hành động khắc phục.
 *  Đây là lớp trung tâm duy nhất nên dùng cho banner/toast/dialog lỗi chặn luồng — không tự ghép chuỗi lỗi
 *  ở nơi khác. `toUserMessage()` ở trên vẫn giữ nguyên cho các chỗ chỉ cần 1 dòng message ngắn. */
export function mapAppError(err: unknown, options: MapAppErrorOptions = {}): AppError {
  const { status, provider, retryAfterSeconds } = options;
  const raw = err instanceof Error ? err.message : typeof err === 'string' ? err : '';

  // console.error luôn giữ lại lỗi kỹ thuật gốc để debug/logging — không bao giờ render ra UI
  if (err) console.error('[mapAppError]', err, options);

  if (isOffline() || /failed to fetch|networkerror|load failed|ERR_CONNECTION|ERR_INTERNET_DISCONNECTED/i.test(raw)) {
    return { title: 'Không kết nối được máy chủ.', description: 'Kiểm tra kết nối mạng rồi thử lại.', actionLabel: 'Thử lại', actionType: 'retry' };
  }

  if (/timeout|timed out|ETIMEDOUT|AbortError/i.test(raw)) {
    return { title: 'Máy chủ phản hồi quá lâu.', description: 'Có thể do mạng chậm hoặc hệ thống đang tải cao.', actionLabel: 'Thử lại', actionType: 'retry' };
  }

  if (status === 401 || /unauthenticated|401/.test(raw)) {
    return { title: 'Phiên đăng nhập đã hết hạn.', description: 'Đăng nhập lại để tiếp tục.', actionLabel: 'Đăng nhập lại', actionType: 'login-again' };
  }

  // Khớp đúng message backend trả ở require-auth.ts khi profiles.status='BLOCKED'. Kiểm tra
  // TRƯỚC nhánh 403 chung — đây là 1 dạng 403 riêng cần xử lý khác hẳn (đăng xuất ngay,
  // không phải chỉ hiện thông báo "không có quyền" rồi thôi).
  if (/tài khoản.*(đã bị khoá|bị khoá)/i.test(raw)) {
    if (typeof window !== 'undefined') {
      window.dispatchEvent(new CustomEvent(ACCOUNT_BLOCKED_EVENT));
    }
    return {
      title: 'Tài khoản của bạn đã bị khoá.',
      description: 'Bạn sẽ được đăng xuất ngay bây giờ. Liên hệ quản trị viên để được hỗ trợ.',
    };
  }

  if (status === 403) {
    return { title: 'Bạn không có quyền thực hiện thao tác này.' };
  }

  if (status === 404 || /resource not found|không tìm thấy/i.test(raw)) {
    return { title: 'Không tìm thấy video này.', description: 'Có thể video đã bị xoá.', actionLabel: 'Về Kho video', actionType: 'go-library' };
  }

  if (status === 429 || /rate limit|too many requests/i.test(raw)) {
    const secs = retryAfterSeconds;
    return {
      title: 'Bạn thao tác quá nhanh hoặc đã vượt giới hạn.',
      description: secs ? `Thử lại sau ${secs} giây.` : 'Chờ một lát rồi thử lại.',
      actionLabel: secs ? `Thử lại sau ${secs} giây` : 'Thử lại sau',
      actionType: 'retry-after',
      retryAfterSeconds: secs,
    };
  }

  if (/api key not valid|invalid api key|api_key_invalid|thiếu.*api key|api key.*(thiếu|không hợp lệ)/i.test(raw)) {
    const who = provider ? ` của ${provider}` : '';
    return { title: `API key${who} chưa hợp lệ.`, description: 'Kiểm tra lại tại mục API Keys.', actionLabel: 'Đi tới API Keys', actionType: 'go-api-keys' };
  }

  if (/insufficient.*balance|resource_exhausted|quota|billing|không đủ (tín dụng|số dư)|hết (tín dụng|số dư)/i.test(raw)) {
    return { title: 'Tài khoản không đủ tín dụng để tạo video.', description: 'Nạp thêm tín dụng để tiếp tục.', actionLabel: 'Nạp tín dụng', actionType: 'go-credits' };
  }

  if (/unable to generate audio|encountered an issue with the audio|issue with the audio for your prompt/i.test(raw)) {
    return {
      title: 'Google Veo không tạo được âm thanh cho cảnh này.',
      description:
        'Thường do prompt có lời thoại hoặc mô tả âm thanh phức tạp. Thử sửa prompt (bớt thoại), chọn model Fast, hoặc bấm Tạo lại cảnh.',
      actionLabel: 'Thử lại',
      actionType: 'retry',
    };
  }

  if (status === 502 || status === 503 || status === 504 || /service unavailable|bad gateway|gateway timeout|provider.*(down|unavailable|gián đoạn)/i.test(raw)) {
    const who = provider ? ` ${provider}` : '';
    return { title: `Dịch vụ${who} đang gián đoạn.`, description: 'Có thể thử lại bằng nhà cung cấp khác.', actionLabel: 'Thử provider khác', actionType: 'switch-provider' };
  }

  if ((status && status >= 500) || /internal server error|500/.test(raw)) {
    return { title: 'Hệ thống đang gặp sự cố.', description: 'Đội ngũ kỹ thuật đã được thông báo — vui lòng thử lại sau ít phút.', actionLabel: 'Thử lại', actionType: 'retry' };
  }

  // Không map được — vẫn phải hữu ích: dùng toUserMessage() để lọc kỹ thuật/English dài,
  // fallback cuối luôn có hành động "Thử lại" thay vì để user bế tắc.
  return {
    title: toUserMessage(err, 'Đã xảy ra lỗi ngoài dự kiến.'),
    description: 'Nếu vẫn còn lỗi, hãy thử lại sau hoặc liên hệ hỗ trợ.',
    actionLabel: 'Thử lại',
    actionType: 'retry',
  };
}
