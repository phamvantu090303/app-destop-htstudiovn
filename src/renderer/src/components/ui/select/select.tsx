'use client';

import * as React from 'react';
import { Select as SelectPrimitive } from '@base-ui/react/select';
import { ChevronsUpDown, Check } from 'lucide-react';
import { cn } from '@/lib/utils';

export interface SelectOption<T extends string> {
  value: T;
  label: string;
}

interface SelectProps<T extends string> {
  value: T;
  onChange: (value: T) => void;
  options: SelectOption<T>[];
  'aria-label'?: string;
  disabled?: boolean;
  /** class cho trigger (nút hiện giá trị đang chọn) — mặc định khớp style <select> native cũ */
  className?: string;
  /** Gắn cho trigger — dùng khi có <label htmlFor> trỏ tới select này (vd SelectVeo) */
  id?: string;
}

/**
 * Thay <select> native bằng `@base-ui/react/select` — style đồng bộ trên mọi trình duyệt (native
 * select rất khó style popup/option nhất quán). Base UI đã có sẵn trong dependencies, đây là
 * primitive thứ 3 được dùng (sau Tooltip, Toast).
 */
export function Select<T extends string>({
  value,
  onChange,
  options,
  disabled,
  className,
  id,
  ...rest
}: SelectProps<T>) {
  return (
    <SelectPrimitive.Root
      value={value}
      onValueChange={(next) => onChange(next as T)}
      disabled={disabled}
      items={options}
    >
      <SelectPrimitive.Trigger
        id={id}
        aria-label={rest['aria-label']}
        className={cn(
          'flex items-center justify-between gap-2 px-2 py-2 text-[11px] bg-muted/40 border border-border rounded-lg text-foreground',
          'focus:outline-none focus:ring-1 focus:ring-primary/30',
          'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/60',
          'disabled:opacity-60 disabled:cursor-not-allowed cursor-pointer transition-colors',
          className,
        )}
      >
        <SelectPrimitive.Value />
        <SelectPrimitive.Icon>
          <ChevronsUpDown className="w-3 h-3 text-muted-foreground shrink-0" />
        </SelectPrimitive.Icon>
      </SelectPrimitive.Trigger>
      <SelectPrimitive.Portal>
        <SelectPrimitive.Positioner sideOffset={6} align="start" className="z-(--z-elevated) outline-none">
          <SelectPrimitive.Popup
            className={cn(
              'min-w-[var(--anchor-width)] max-h-72 overflow-y-auto py-1 outline-none',
              'bg-popover border border-border rounded-xl shadow-lg',
              'transition-[opacity,transform] duration-150 origin-[var(--transform-origin)]',
              'data-[starting-style]:opacity-0 data-[starting-style]:scale-95',
              'data-[ending-style]:opacity-0 data-[ending-style]:scale-95',
            )}
          >
            <SelectPrimitive.List>
              {options.map((opt) => (
                <SelectPrimitive.Item
                  key={opt.value}
                  value={opt.value}
                  className={cn(
                    'flex items-center justify-between gap-2 mx-1 px-3 py-1.5 rounded-md text-xs text-foreground',
                    'cursor-pointer outline-none transition-colors',
                    'data-[highlighted]:bg-muted/60 data-[selected]:text-primary data-[selected]:font-medium',
                  )}
                >
                  <SelectPrimitive.ItemText>{opt.label}</SelectPrimitive.ItemText>
                  <SelectPrimitive.ItemIndicator>
                    <Check className="w-3.5 h-3.5 text-primary shrink-0" />
                  </SelectPrimitive.ItemIndicator>
                </SelectPrimitive.Item>
              ))}
            </SelectPrimitive.List>
          </SelectPrimitive.Popup>
        </SelectPrimitive.Positioner>
      </SelectPrimitive.Portal>
    </SelectPrimitive.Root>
  );
}
