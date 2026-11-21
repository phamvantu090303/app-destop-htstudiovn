'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { ChevronLeft, ChevronRight } from 'lucide-react';
import { cn } from '@/lib/utils';

interface HorizontalScrollerProps {
  children: React.ReactNode;
  /** class cho hàng cuộn bên trong (thường là flex + gap của nội dung thật) */
  className?: string;
  /** class cho khung ngoài cùng chứa cả 2 nút mũi tên */
  containerClassName?: string;
  /** màu nền dùng cho lớp phủ mờ 2 đầu — mặc định theo bg-background, đổi khi đặt trong khối có nền khác (card...) */
  edgeFadeClassName?: string;
}

/**
 * Bọc quanh 1 hàng ngang tràn nội dung (`overflow-x-auto`) — thêm 2 nút mũi tên + lớp phủ mờ
 * 2 đầu (chỉ hiện khi thật sự còn nội dung bị che), và quy đổi cuộn lăn chuột dọc (chuột
 * thường trên desktop không có cuộn ngang) sang cuộn ngang. Trước đây hàng chỉ có
 * `overflow-x-auto` + ẩn thanh cuộn (`scrollbar-none`) — không có cách nào cuộn được bằng
 * chuột thường khi màn hình hẹp, nội dung bị cắt mất mà không biết cách xem tiếp.
 */
export function HorizontalScroller({
  children,
  className,
  containerClassName,
  edgeFadeClassName = 'from-background',
}: HorizontalScrollerProps) {
  const scrollRef = useRef<HTMLDivElement>(null);
  const [canScrollLeft, setCanScrollLeft] = useState(false);
  const [canScrollRight, setCanScrollRight] = useState(false);

  const updateScrollState = useCallback(() => {
    const el = scrollRef.current;
    if (!el) return;
    setCanScrollLeft(el.scrollLeft > 4);
    setCanScrollRight(el.scrollLeft < el.scrollWidth - el.clientWidth - 4);
  }, []);

  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    updateScrollState();
    el.addEventListener('scroll', updateScrollState, { passive: true });
    const ro = new ResizeObserver(updateScrollState);
    ro.observe(el);
    window.addEventListener('resize', updateScrollState);
    return () => {
      el.removeEventListener('scroll', updateScrollState);
      ro.disconnect();
      window.removeEventListener('resize', updateScrollState);
    };
  }, [updateScrollState, children]);

  const handleWheel = (e: React.WheelEvent<HTMLDivElement>) => {
    const el = scrollRef.current;
    if (!el || el.scrollWidth <= el.clientWidth) return;
    // Trackpad/Shift+lăn đã tự sinh ra deltaX ngang rồi — chỉ can thiệp khi user lăn dọc bình
    // thường (chuột thường), để tránh giật khi trackpad đã cuộn ngang sẵn.
    if (Math.abs(e.deltaX) > Math.abs(e.deltaY)) return;
    e.preventDefault();
    el.scrollBy({ left: e.deltaY });
  };

  const scrollBy = (direction: 1 | -1) => {
    scrollRef.current?.scrollBy({ left: direction * 220, behavior: 'smooth' });
  };

  return (
    <div className={cn('relative', containerClassName)}>
      {canScrollLeft && (
        <>
          <div
            aria-hidden
            className={cn('pointer-events-none absolute left-0 top-0 bottom-0 w-8 z-20 bg-gradient-to-r to-transparent', edgeFadeClassName)}
          />
          <button
            type="button"
            onClick={() => scrollBy(-1)}
            aria-label="Cuộn sang trái để xem thêm"
            className="absolute left-0.5 top-1/2 -translate-y-1/2 z-30 flex items-center justify-center w-6 h-6 rounded-full bg-card border border-border text-muted-foreground hover:text-foreground hover:border-primary/40 shadow-sm cursor-pointer transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/60"
          >
            <ChevronLeft className="w-3.5 h-3.5" />
          </button>
        </>
      )}

      <div ref={scrollRef} onWheel={handleWheel} className={cn('overflow-x-auto scrollbar-none', className)}>
        {children}
      </div>

      {canScrollRight && (
        <>
          <div
            aria-hidden
            className={cn('pointer-events-none absolute right-0 top-0 bottom-0 w-8 z-20 bg-gradient-to-l to-transparent', edgeFadeClassName)}
          />
          <button
            type="button"
            onClick={() => scrollBy(1)}
            aria-label="Cuộn sang phải để xem thêm"
            className="absolute right-0.5 top-1/2 -translate-y-1/2 z-30 flex items-center justify-center w-6 h-6 rounded-full bg-card border border-border text-muted-foreground hover:text-foreground hover:border-primary/40 shadow-sm cursor-pointer transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/60"
          >
            <ChevronRight className="w-3.5 h-3.5" />
          </button>
        </>
      )}
    </div>
  );
}
