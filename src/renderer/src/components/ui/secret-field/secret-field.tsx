'use client';

import { Copy, CheckCircle2, Eye, EyeOff, Pencil, Trash2 } from 'lucide-react';
import { cn } from '@/lib/utils';

interface SecretFieldProps {
  value: string;
  visible: boolean;
  onToggleVisibility: () => void;
  copied: boolean;
  onCopy: () => void;
  onEdit: () => void;
  editTitle?: string;
  /** Không truyền = ẩn nút xóa */
  onDelete?: () => void;
  disabled?: boolean;
  placeholder?: string;
  inputClassName?: string;
}

const ICON_BUTTON_BASE =
  'p-2 rounded-lg transition-colors cursor-pointer disabled:opacity-30 disabled:cursor-not-allowed ' +
  'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/60 focus-visible:ring-offset-2 focus-visible:ring-offset-background';

/** Ô hiển thị key/secret dạng ẩn/hiện kèm copy · sửa · xóa — dùng cho API key... */
export function SecretField({
  value, visible, onToggleVisibility, copied, onCopy, onEdit, editTitle = 'Chỉnh sửa key', onDelete,
  disabled = false, placeholder, inputClassName,
}: SecretFieldProps) {
  return (
    <div className="flex items-center gap-2">
      <input
        type={visible ? 'text' : 'password'}
        value={value}
        readOnly
        onClick={onEdit}
        placeholder={placeholder}
        title={editTitle}
        className={cn(
          'flex-1 px-3 py-2 bg-background border border-border rounded-lg text-sm text-foreground font-mono cursor-pointer hover:border-primary/40 transition-colors',
          inputClassName,
        )}
      />
      <button
        type="button"
        onClick={onToggleVisibility}
        disabled={disabled}
        title={visible ? 'Ẩn key' : 'Hiện key'}
        aria-label={visible ? 'Ẩn key' : 'Hiện key'}
        className={cn(ICON_BUTTON_BASE, 'hover:bg-muted text-muted-foreground hover:text-foreground')}
      >
        {visible ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
      </button>
      <button
        type="button"
        onClick={onCopy}
        title="Copy key"
        aria-label={copied ? 'Đã copy key' : 'Copy key'}
        disabled={disabled}
        className={cn(ICON_BUTTON_BASE, 'hover:bg-muted')}
      >
        {copied
          ? <CheckCircle2 className="w-4 h-4 text-green-400" />
          : <Copy className="w-4 h-4 text-muted-foreground hover:text-foreground" />}
      </button>
      <button
        type="button"
        onClick={onEdit}
        title={editTitle}
        aria-label={editTitle}
        className={cn(ICON_BUTTON_BASE, 'hover:bg-primary/10 text-muted-foreground hover:text-primary')}
      >
        <Pencil className="w-4 h-4" />
      </button>
      {onDelete && (
        <button
          type="button"
          onClick={onDelete}
          title="Xóa key"
          aria-label="Xoá key"
          className={cn(ICON_BUTTON_BASE, 'hover:bg-destructive/10 text-muted-foreground hover:text-destructive')}
        >
          <Trash2 className="w-4 h-4" />
        </button>
      )}
    </div>
  );
}
