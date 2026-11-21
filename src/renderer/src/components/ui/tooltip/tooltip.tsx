'use client';

import * as React from 'react';
import { Tooltip as TooltipPrimitive } from '@base-ui/react/tooltip';
import { cn } from '@/lib/utils';

/** Provider dùng chung 1 lần ở root layout — nhóm delay giữa các tooltip liền kề (hover cái này xong hover
 *  cái kia không phải chờ lại đủ delay). */
export const TooltipProvider = TooltipPrimitive.Provider;

interface AppTooltipProps {
  /** Nội dung tooltip — truyền falsy (undefined/'') để tắt hẳn tooltip mà không phải bọc điều kiện ở nơi gọi */
  content: React.ReactNode;
  children: React.ReactElement;
  side?: 'top' | 'bottom' | 'left' | 'right';
  delay?: number;
  className?: string;
}

/**
 * Tooltip có thể tiếp cận bằng bàn phím/hover/touch thay cho `title` native (không keyboard-support,
 * không nhất quán trên screen reader). Dựng trên `@base-ui/react/tooltip` — thư viện đã có sẵn trong
 * dependencies (chưa từng được dùng ở đâu trong app) nên không phát sinh thêm dependency mới.
 *
 * Dùng: <Tooltip content="Sửa video"><button aria-label="Sửa video">...</button></Tooltip>
 */
export function Tooltip({ content, children, side = 'top', delay = 100, className }: AppTooltipProps) {
  if (!content) return children;

  return (
    <TooltipPrimitive.Root>
      <TooltipPrimitive.Trigger render={children} delay={delay} />
      <TooltipPrimitive.Portal>
        <TooltipPrimitive.Positioner side={side} sideOffset={6}>
          <TooltipPrimitive.Popup
            className={cn(
              'z-(--z-modal) rounded-md border border-border bg-popover px-2.5 py-1.5 text-xs font-medium text-popover-foreground shadow-lg',
              'transition-[opacity,transform] duration-150 data-[starting-style]:opacity-0 data-[ending-style]:opacity-0',
              'data-[starting-style]:scale-95 data-[ending-style]:scale-95',
              className,
            )}
          >
            {content}
          </TooltipPrimitive.Popup>
        </TooltipPrimitive.Positioner>
      </TooltipPrimitive.Portal>
    </TooltipPrimitive.Root>
  );
}
