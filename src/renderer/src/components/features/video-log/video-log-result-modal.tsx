'use client';

import { useEffect, useState } from 'react';
import { AlertTriangle, X } from 'lucide-react';
import { ModalOverlay } from '@/components/ui/modal-overlay';
import { Button } from '@/components/ui/button';

interface VideoLogResultModalProps {
  /** null = đóng modal */
  resultUrls: string[] | null;
  onClose: () => void;
}

/** Xem video kết quả 1 task — link từ kie.ai có thể hết hạn (~24h theo tài liệu), nên bắt
 *  onError để báo rõ thay vì để video vỡ/im lặng. */
export function VideoLogResultModal({ resultUrls, onClose }: VideoLogResultModalProps) {
  const [expiredIndexes, setExpiredIndexes] = useState<Set<number>>(new Set());

  // Component không unmount giữa các lần mở (luôn render, chỉ ẩn/hiện qua resultUrls) —
  // phải tự reset state "hết hạn" khi chuyển sang xem 1 video khác, nếu không sẽ hiện
  // nhầm "hết hạn" cho video mới dựa trên state còn sót của video trước.
  useEffect(() => {
    setExpiredIndexes(new Set());
  }, [resultUrls]);

  if (!resultUrls || resultUrls.length === 0) return null;

  return (
    <ModalOverlay
      onClose={onClose}
      backdropClassName="bg-black/70 backdrop-blur-sm"
      onKeyDown={(e) => { if (e.key === 'Escape') onClose(); }}
    >
      <div
        className="relative z-10 w-full max-w-xl bg-card border border-border rounded-2xl shadow-2xl p-5"
        role="dialog"
        aria-modal
        aria-label="Kết quả video"
      >
        <div className="flex items-center justify-between mb-4">
          <h3 className="text-sm font-bold text-foreground">Kết quả video</h3>
          <Button
            type="button"
            variant="icon-ghost"
            onClick={onClose}
            className="p-1.5"
            aria-label="Đóng"
          >
            <X className="w-4 h-4" />
          </Button>
        </div>

        <div className="space-y-3">
          {resultUrls.map((url, i) =>
            expiredIndexes.has(i) ? (
              <div
                key={url}
                className="flex items-start gap-3 rounded-xl border border-destructive/40 bg-destructive/10 p-4"
              >
                <AlertTriangle className="w-5 h-5 text-destructive shrink-0 mt-0.5" />
                <p className="text-xs text-muted-foreground leading-relaxed">
                  Video đã hết hạn hoặc không còn truy cập được — link kết quả chỉ tồn tại tạm thời.
                  Việc này không ảnh hưởng video đã lưu trong Kho video của bạn.
                </p>
              </div>
            ) : (
              <video
                key={url}
                controls
                className="w-full rounded-xl border border-border bg-background"
                onError={() => setExpiredIndexes((prev) => new Set(prev).add(i))}
              >
                <source src={url} />
              </video>
            ),
          )}
        </div>

        <div className="flex justify-end mt-5">
          <Button variant="ghost" size="md" onClick={onClose} autoFocus>
            Đóng
          </Button>
        </div>
      </div>
    </ModalOverlay>
  );
}
