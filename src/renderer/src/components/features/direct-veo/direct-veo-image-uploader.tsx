'use client';

// ─── DirectVeoImageUploader — single-image picker cho 1 Scene (Phase 8) ────────────────
// Xem docs/BUILD PROMPT - tối ưu V3.md §4 (Q3): giữ tên file, nhưng semantic đổi hẳn — mỗi
// instance chỉ chịu trách nhiệm 1 ảnh của đúng 1 Scene. Không chứa images[]/imageIndex/
// mapping/parser/scene-list-management/generation logic — container (direct-veo-input.tsx)
// lo việc đọc File → base64 qua readDirectVeoImage() và quản lý danh sách Scene.

import { useRef } from 'react';
import { Upload, X, ImageIcon } from 'lucide-react';
import { FieldError } from '@/components/ui/field-error';
import { cn } from '@/lib/utils';
import { DIRECT_VEO_IMAGE_MIME } from './direct-veo-image';

export interface DirectVeoImagePickerValue {
  /** Vắng mặt khi ảnh khôi phục từ Storage (Phase 9) — không còn File gốc, chỉ còn bytes */
  file?: File;
  previewUrl: string;
  belowRecommendedSize: boolean;
}

export interface DirectVeoImageUploaderProps {
  image: DirectVeoImagePickerValue | null;
  /** null = user xoá ảnh — Scene chuyển Text-to-Video, KHÔNG bị xoá */
  onChange: (file: File | null) => void;
  disabled?: boolean;
  error?: string;
}

export function DirectVeoImageUploader({ image, onChange, disabled, error }: DirectVeoImageUploaderProps) {
  const inputRef = useRef<HTMLInputElement | null>(null);

  return (
    <div>
      <div className="flex items-center justify-between mb-1.5">
        <span className="text-xs font-semibold text-foreground">Ảnh (tuỳ chọn)</span>
        {image && !disabled && (
          <button
            type="button"
            onClick={() => onChange(null)}
            className="text-muted-foreground hover:text-destructive"
            aria-label="Xoá ảnh"
          >
            <X className="w-3.5 h-3.5" />
          </button>
        )}
      </div>

      {image ? (
        <button
          type="button"
          disabled={disabled}
          onClick={() => inputRef.current?.click()}
          className="w-full aspect-video rounded-md overflow-hidden bg-muted relative disabled:cursor-not-allowed"
        >
          {/* eslint-disable-next-line @next/next/no-img-element -- ảnh do user chọn từ máy, blob: URL */}
          <img src={image.previewUrl} alt="Ảnh scene" className="w-full h-full object-cover" />
        </button>
      ) : (
        <button
          type="button"
          disabled={disabled}
          onClick={() => inputRef.current?.click()}
          className={cn(
            'w-full aspect-video rounded-md border-2 border-dashed border-border flex flex-col items-center justify-center gap-1',
            'text-muted-foreground hover:border-primary/40 hover:text-primary transition-colors disabled:cursor-not-allowed disabled:hover:border-border disabled:hover:text-muted-foreground',
          )}
        >
          <Upload className="w-4 h-4" />
          <span className="text-[10px]">Thêm ảnh</span>
        </button>
      )}

      <input
        ref={inputRef}
        type="file"
        accept={DIRECT_VEO_IMAGE_MIME.join(',')}
        disabled={disabled}
        className="hidden"
        onChange={(e) => {
          const file = e.target.files?.[0] ?? null;
          if (file) onChange(file);
          e.target.value = '';
        }}
      />

      {image?.file && (
        <p className="mt-1 text-[10px] text-muted-foreground truncate flex items-center gap-1">
          <ImageIcon className="w-3 h-3 shrink-0" />
          {image.file.name}
        </p>
      )}

      {error && <div className="mt-1.5"><FieldError>{error}</FieldError></div>}
    </div>
  );
}
