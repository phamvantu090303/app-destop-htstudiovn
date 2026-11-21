'use client';

import { useCallback, useEffect, useState } from 'react';
import Link from '@/components/ui/app-link';
import {
  ChevronRight, Key, Gauge, Palette, Music,
  PanelLeftClose, PanelLeftOpen, UserCircle2, PenSquare, Images, Film,
  Layers, Coins, Circle, History, CreditCard, Lock, Moon, Sun, Clock, LogOut, Plus, Receipt,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { SITE_NAME, LOGO_URL } from '@/lib/home-theme';
import { Tooltip } from '@/components/ui/tooltip';
import { Button } from '@/components/ui/button';
import { useMissingApiKeyWarning } from '@/hooks/use-missing-api-key-warning';
import { useTheme } from '@/hooks/use-theme';
import { useAuth } from '@/contexts/auth-context';
import { useUserCredit } from '@/hooks/use-user-credit';
import { PRESET_SCRIPTS, type PresetScript } from '@/lib/preset/preset-scripts';

export type AppView =
  | 'video-library' | 'video-detail' | 'api-keys' | 'payment' | 'transaction-history'
  | 'video-log' | 'render-history';
export type CreativeToolId =
  | 'character'          // Mục 1 — NHÂN VẬT CHÍNH
  | 'content'            // Mục 2 — Nhập nội dung
  | 'scene-gallery'      // Mục 3 — Danh sách cảnh
  | 'timeline'            // Mục 4 — Timeline
  | 'voice-speed'        // Mục 2 — mở accordion Tốc độ giọng
  | 'scene-style'        // Mục 2 — mở accordion Phong cách cảnh
  | 'background-music';  // Mục 4 — mở panel Nhạc nền

/** Màu icon RIÊNG theo từng mục — chỉ để phân biệt trực quan (giống ảnh mẫu), không mang
 * nghĩa phân quyền/tier gì cả. Áp dụng khi mục KHÔNG active/disabled. */
const ICON_COLORS = {
  sky: 'text-sky-400 bg-sky-500/15',
  violet: 'text-primary bg-primary/15',
  emerald: 'text-emerald-400 bg-emerald-500/15',
  fuchsia: 'text-fuchsia-400 bg-fuchsia-500/15',
  teal: 'text-teal-400 bg-teal-500/15',
  rose: 'text-rose-400 bg-rose-500/15',
  amber: 'text-amber-400 bg-amber-500/15',
  indigo: 'text-indigo-400 bg-indigo-500/15',
} as const;
type IconColor = keyof typeof ICON_COLORS;

type MenuItemDef = {
  id: string;
  view: AppView;
  icon: typeof Layers;
  label: string;
  color: IconColor;
};

/** Hub chính — luôn đặt trên cùng sidebar */
const videoLibraryMenuItem: MenuItemDef = {
  id: 'video-library',
  view: 'video-library',
  icon: Layers,
  label: 'Kho video',
  color: 'sky',
};

/** Lịch sử hoạt động — xem lại output và log tạo video */
const historyMenuItems: MenuItemDef[] = [
  { id: 'render-history', view: 'render-history', icon: Clock, label: 'Lịch sử render', color: 'amber' },
  { id: 'video-log', view: 'video-log', icon: History, label: 'Nhật Ký', color: 'sky' },
];

/** Thanh toán & cấu hình tài khoản */
const accountMenuItems: MenuItemDef[] = [
  { id: 'payment', view: 'payment', icon: CreditCard, label: 'Thanh toán', color: 'fuchsia' },
  { id: 'transaction-history', view: 'transaction-history', icon: Receipt, label: 'Lịch sử thanh toán', color: 'emerald' },
  { id: 'api-keys', view: 'api-keys', icon: Key, label: 'API Keys', color: 'violet' },
];

interface SidebarNavItemProps {
  item: MenuItemDef;
  isActive: boolean;
  collapsed: boolean;
  showApiKeyDot?: boolean;
  onClick: () => void;
}

function SidebarNavItem({ item, isActive, collapsed, showApiKeyDot, onClick }: SidebarNavItemProps) {
  const button = (
    <button
      type="button"
      onClick={onClick}
      aria-current={isActive ? 'page' : undefined}
      className={cn(
        'relative w-full flex items-center rounded-lg font-medium transition-all duration-150 cursor-pointer',
        FOCUS_RING,
        collapsed ? 'justify-center px-0 py-2.5' : 'gap-2.5 px-3 py-2.5',
        isActive
          ? 'bg-gradient-to-r from-primary/25 to-fuchsia-500/10 text-primary border border-primary/30'
          : 'text-sidebar-accent hover:bg-white/5 hover:text-sidebar-foreground border border-transparent',
      )}
    >
      <ActiveBar show={isActive} />
      <span className="relative shrink-0">
        <span className={cn(
          'flex items-center justify-center w-7 h-7 rounded-lg',
          isActive ? 'bg-primary/20 text-primary' : ICON_COLORS[item.color],
        )}>
          <item.icon className="w-4 h-4" />
        </span>
        {showApiKeyDot && (
          <Circle className="absolute -right-0.5 -top-0.5 w-2 h-2 fill-orange-400 text-orange-400" />
        )}
      </span>
      {!collapsed && (
        <>
          <span className="flex-1 text-left text-xs lg:text-sm truncate">{item.label}</span>
          {showApiKeyDot && (
            <span className="w-1.5 h-1.5 rounded-full bg-orange-400 shrink-0" aria-hidden />
          )}
          {isActive && <ChevronRight className="w-3.5 h-3.5 opacity-60 shrink-0" />}
        </>
      )}
    </button>
  );

  const tooltipText = showApiKeyDot
    ? `${item.label} — chưa cấu hình API key nào`
    : collapsed ? item.label : undefined;

  return tooltipText ? (
    <Tooltip content={tooltipText} side="right">{button}</Tooltip>
  ) : (
    button
  );
}

interface MenuGroupProps {
  title: string;
  items: MenuItemDef[];
  activeMenuId: string;
  collapsed: boolean;
  missingApiKey: boolean;
  onMenuClick: (menuId: string, view: AppView) => void;
}

function MenuGroup({ title, items, activeMenuId, collapsed, missingApiKey, onMenuClick }: MenuGroupProps) {
  return (
    <div>
      {!collapsed && (
        <p className="px-3 mb-1.5 text-[10px] font-bold uppercase tracking-widest text-sidebar-accent/70">
          {title}
        </p>
      )}
      <nav
        className="space-y-0.5"
        aria-label={title}
        onKeyDown={handleGroupArrowNav}
      >
        {items.map((item) => (
          <SidebarNavItem
            key={item.id}
            item={item}
            isActive={activeMenuId === item.id}
            collapsed={collapsed}
            showApiKeyDot={item.id === 'api-keys' && missingApiKey}
            onClick={() => onMenuClick(item.id, item.view)}
          />
        ))}
      </nav>
    </div>
  );
}

interface ToolDef {
  id: CreativeToolId;
  icon: typeof Gauge;
  label: string;
  desc: string;
  color: IconColor;
}

/** Điều hướng nhanh — nhảy đến các section chính trong video chi tiết đang active */
const navigationTools: ToolDef[] = [
  { id: 'character', icon: UserCircle2, label: 'Nhân vật', desc: 'Đi đến Mục 1', color: 'teal' },
  { id: 'content', icon: PenSquare, label: 'Nhập nội dung', desc: 'Đi đến Mục 2', color: 'rose' },
  { id: 'scene-gallery', icon: Images, label: 'Danh sách cảnh', desc: 'Đi đến Mục 3', color: 'indigo' },
  { id: 'timeline', icon: Film, label: 'Timeline', desc: 'Đi đến Mục 4', color: 'indigo' },
];

/** Tùy chỉnh chi tiết — mở panel/accordion tại section tương ứng */
const customizeTools: ToolDef[] = [
  { id: 'voice-speed', icon: Gauge, label: 'Tốc độ giọng', desc: 'Mục 1 · TTS', color: 'amber' },
  { id: 'scene-style', icon: Palette, label: 'Phong cách cảnh', desc: 'Mục 2 · Visual', color: 'violet' },
  { id: 'background-music', icon: Music, label: 'Nhạc nền', desc: 'Mục 3 · BGM', color: 'sky' },
];

/** class dùng chung cho mọi item có thể focus bằng bàn phím trong sidebar — ring luôn hiện khi
 *  Tab tới (không dựa vào hover), lệch ring vào trong (offset âm) vì item nằm sát mép cột hẹp */
const FOCUS_RING = 'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/70 focus-visible:ring-inset';

/** Bar dọc bên trái đánh dấu item đang active — 1 kiểu duy nhất dùng cho mọi cấp (main nav,
 *  tool group, settings), thay vì mỗi nơi 1 kiểu chỉ báo khác nhau như bản cũ (dot lúc mở rộng,
 *  bar bên phải lúc thu gọn, không có gì ở main nav/settings ngoài đổi màu chữ). */
function ActiveBar({ show }: { show: boolean }) {
  if (!show) return null;
  return <span className="absolute -left-1 top-1/2 h-5 w-1 -translate-y-1/2 rounded-full bg-primary" aria-hidden />;
}

/** Arrow Up/Down di chuyển focus giữa các button cùng nhóm — bổ sung cho Tab (vẫn hoạt động
 *  bình thường để nhảy giữa các nhóm), theo đúng hành vi điều hướng quen thuộc của menu dọc. */
function handleGroupArrowNav(e: React.KeyboardEvent<HTMLElement>) {
  if (e.key !== 'ArrowDown' && e.key !== 'ArrowUp') return;
  const buttons = Array.from(e.currentTarget.querySelectorAll<HTMLButtonElement>('button:not(:disabled)'));
  const currentIndex = buttons.indexOf(document.activeElement as HTMLButtonElement);
  if (currentIndex === -1) return;
  e.preventDefault();
  const direction = e.key === 'ArrowDown' ? 1 : -1;
  const nextIndex = (currentIndex + direction + buttons.length) % buttons.length;
  buttons[nextIndex]?.focus();
}

interface SidebarProps {
  activeMenuId: string;
  activeTool: CreativeToolId | null;
  collapsed: boolean;
  onToggleCollapse: () => void;
  onMenuClick: (menuId: string, view: AppView) => void;
  onToolClick: (toolId: CreativeToolId) => void;
  onPresetSelect: (preset: PresetScript) => void;
  /** id tool → lý do vô hiệu hoá tạm thời theo ngữ cảnh hiện tại (vd: Timeline/Danh sách cảnh
   *  khi video active chưa có cảnh nào) — hiện trong tooltip thay vì để user bấm vào rồi thấy
   *  trang trống không hiểu vì sao. Không truyền = không tool nào bị disable. */
  disabledTools?: Partial<Record<CreativeToolId, string>>;
}

// ─── Tool group ──────────────────────────────────────────────────────────────

interface ToolGroupProps {
  title: string;
  tools: ToolDef[];
  activeTool: CreativeToolId | null;
  collapsed: boolean;
  onClick: (id: CreativeToolId) => void;
  disabledTools?: Partial<Record<CreativeToolId, string>>;
}

function ToolGroup({ title, tools, activeTool, collapsed, onClick, disabledTools }: ToolGroupProps) {
  return (
    <div>
      {!collapsed && (
        <p className="px-3 mb-1.5 text-[10px] font-bold uppercase tracking-widest text-sidebar-accent/70">
          {title}
        </p>
      )}
      <div className="space-y-0.5" role="group" aria-label={title} onKeyDown={handleGroupArrowNav}>
        {tools.map((tool) => {
          const isActive = activeTool === tool.id;
          const disabledReason = disabledTools?.[tool.id];
          const isDisabled = Boolean(disabledReason);
          const tooltipContent = isDisabled ? disabledReason : `${tool.label} — ${tool.desc}`;

          return (
            <Tooltip key={tool.id} content={tooltipContent} side="right">
              <button
                type="button"
                onClick={() => { if (!isDisabled) onClick(tool.id); }}
                aria-disabled={isDisabled}
                aria-pressed={isActive}
                className={cn(
                  'relative w-full flex items-center rounded-lg transition-all duration-150',
                  FOCUS_RING,
                  collapsed ? 'justify-center px-0 py-2.5' : 'gap-2.5 px-3 py-2.5',
                  isDisabled ? 'opacity-60 cursor-not-allowed' : 'cursor-pointer',
                  !isDisabled && isActive && 'bg-gradient-to-r from-primary/25 to-fuchsia-500/10 text-primary border border-primary/30 font-medium',
                  !isDisabled && !isActive && 'text-sidebar-accent hover:bg-white/5 hover:text-sidebar-foreground border border-transparent',
                  isDisabled && 'text-sidebar-accent/60 border border-transparent',
                )}
              >
                <ActiveBar show={isActive && !isDisabled} />
                <span className={cn(
                  'flex items-center justify-center w-7 h-7 rounded-lg shrink-0',
                  isDisabled ? 'bg-muted/40 text-muted-foreground' : ICON_COLORS[tool.color],
                )}>
                  <tool.icon className="w-3.5 h-3.5" />
                </span>
                {!collapsed && (
                  <span className="flex-1 min-w-0 text-left text-xs font-medium truncate">{tool.label}</span>
                )}
                {isDisabled && !collapsed && (
                  <span className="flex items-center justify-center w-5 h-5 rounded-full bg-muted/50 shrink-0">
                    <Lock className="w-2.5 h-2.5 text-muted-foreground" />
                  </span>
                )}
              </button>
            </Tooltip>
          );
        })}
      </div>
    </div>
  );
}

// ─── Số dư credit (hệ thống, profiles.system_credit) — card rút gọn ghim đáy sidebar ────────
// Khác bản cũ đã gỡ (hiện số dư kie.ai CỦA CHÍNH KEY user tự nhập — không còn ý nghĩa từ khi
// Video API Key chuyển sang key hệ thống do admin quản lý): đây là số credit THẬT user đã mua/
// được tặng, dùng chung mọi tính năng — nguồn `useUserCredit()` đọc thẳng profiles qua RLS.
function SidebarCreditsCard({ collapsed, onClick }: { collapsed: boolean; onClick: () => void }) {
  const { user } = useAuth();
  const credits = useUserCredit();

  if (!user) return null;

  if (collapsed) {
    return (
      <Tooltip content={credits === null ? 'Số dư credit — bấm để nạp thêm' : `${credits.toLocaleString('vi-VN')} credits — bấm để nạp thêm`} side="right">
        <Button
          type="button"
          variant="outline"
          onClick={onClick}
          aria-label="Số dư credit — nạp thêm"
          className={cn(
            'w-full p-2 rounded-xl border-primary/25 bg-gradient-to-br from-primary/15 to-fuchsia-500/10 hover:border-primary/40',
            FOCUS_RING,
          )}
        >
          <Coins className="w-4 h-4 text-primary" />
        </Button>
      </Tooltip>
    );
  }

  return (
    <div className="rounded-xl border border-primary/25 bg-gradient-to-br from-primary/15 to-fuchsia-500/10 p-3.5 space-y-2.5">
      <div className="flex items-center gap-2.5">
        <span className="flex items-center justify-center w-9 h-9 rounded-full bg-primary/20 text-primary shrink-0">
          <Coins className="w-4.5 h-4.5" />
        </span>
        <div className="min-w-0 text-left">
          <p className="text-[10px] text-sidebar-accent">Số dư hiện tại</p>
          <p className="text-lg font-bold text-primary tabular-nums leading-tight">
            {credits === null ? '—' : credits.toLocaleString('vi-VN')}
            <span className="ml-1 text-[11px] font-medium text-sidebar-accent">credits</span>
          </p>
        </div>
      </div>

      <Button
        type="button"
        variant="outline"
        onClick={onClick}
        className={cn(
          'w-full py-1.5 rounded-full border-primary/40 bg-primary/10 text-primary hover:bg-primary/20 hover:text-primary',
          FOCUS_RING,
        )}
      >
        <Plus className="w-3 h-3" />
        Nạp thêm
        <Plus className="w-3 h-3" />
      </Button>
    </div>
  );
}

// ─── Hàng tiện ích đáy: đổi theme + avatar thật (Google, chỉ hiển thị tên) + đăng xuất ──
// Trước đây bấm avatar mở "Cài đặt" — mục đó đã bị gỡ khỏi sidebar, avatar giờ chỉ mang
// tính hiển thị (tooltip tên/email), nút đăng xuất tách riêng để không mất chức năng đăng
// xuất (trước chỉ có trong Cài đặt → Tài khoản, giờ đó là lối duy nhất nên phải giữ lại).
function SidebarUtilityRow({ collapsed }: { collapsed: boolean }) {
  const { theme, setTheme } = useTheme();
  const { user, signingOut, signOut } = useAuth();
  const avatarUrl = typeof user?.user_metadata?.avatar_url === 'string' ? user.user_metadata.avatar_url : undefined;
  const fullName = typeof user?.user_metadata?.full_name === 'string' ? user.user_metadata.full_name : user?.email;

  return (
    <div className={cn('flex items-center', collapsed ? 'flex-col gap-2' : 'justify-between gap-2')}>
      {/* Avatar + tên — nhóm riêng bên trái, đại diện danh tính tài khoản */}
      {user && (
        <Tooltip content={fullName ?? 'Tài khoản'} side="right">
          <div className="flex items-center gap-2 min-w-0">
            <span className="relative shrink-0 rounded-full">
              {avatarUrl ? (
                // eslint-disable-next-line @next/next/no-img-element -- avatar Google, domain ngoài, không cần next/image optimize
                <img src={avatarUrl} alt="" className="w-7 h-7 rounded-full object-cover" />
              ) : (
                <span className="flex items-center justify-center w-7 h-7 rounded-full bg-primary/20 text-primary text-xs font-bold">
                  {(fullName ?? '?').charAt(0).toUpperCase()}
                </span>
              )}
              <span className="absolute -bottom-0.5 -right-0.5 w-2.5 h-2.5 rounded-full bg-emerald-500 border-2 border-sidebar" aria-hidden />
            </span>
            {!collapsed && (
              <span className="text-xs font-medium text-sidebar-foreground truncate">{fullName ?? 'Tài khoản'}</span>
            )}
          </div>
        </Tooltip>
      )}

      {/* Nhóm nút hành động — sát nhau, tách biệt rõ khỏi phần danh tính bên trái */}
      <div className="flex items-center gap-0.5 shrink-0">
        <Tooltip content={theme === 'dark' ? 'Chuyển sang giao diện sáng' : 'Chuyển sang giao diện tối'} side="right">
          <Button
            type="button"
            variant="icon-ghost"
            onClick={() => setTheme(theme === 'dark' ? 'light' : 'dark')}
            className={cn('p-1.5 text-sidebar-accent hover:bg-white/10 hover:text-sidebar-foreground', FOCUS_RING)}
            aria-label="Đổi giao diện sáng/tối"
          >
            {theme === 'dark' ? <Moon className="w-4 h-4" /> : <Sun className="w-4 h-4" />}
          </Button>
        </Tooltip>

        {user && (
          <Tooltip content="Đăng xuất" side="right">
            <Button
              type="button"
              variant="icon-danger"
              onClick={() => void signOut()}
              loading={signingOut}
              className={cn('p-1.5 text-sidebar-accent hover:bg-destructive/15 hover:text-destructive', FOCUS_RING)}
              aria-label="Đăng xuất"
            >
              <LogOut className="w-4 h-4" />
            </Button>
          </Tooltip>
        )}
      </div>
    </div>
  );
}

export function Sidebar({
  activeMenuId,
  activeTool,
  collapsed,
  onToggleCollapse,
  onMenuClick,
  onToolClick,
  onPresetSelect,
  disabledTools,
}: SidebarProps) {
  const missingApiKey = useMissingApiKeyWarning();

  return (
    <aside
      className={cn(
        'h-full bg-sidebar border-r border-sidebar-border flex flex-col overflow-hidden shrink-0',
        'transition-[width] duration-200 ease-in-out',
        collapsed ? 'w-14' : 'w-56 lg:w-60',
      )}
    >
      {/* Logo + collapse toggle */}
      <div
        className={cn(
          'border-b border-sidebar-border shrink-0',
          collapsed ? 'px-0 py-4' : 'px-4 py-5',
        )}
      >
        {collapsed ? (
          /* Collapsed: just the logo icon centered */
          <div className="flex flex-col items-center gap-3">
            <Tooltip content={`Về trang chủ ${SITE_NAME}`} side="right">
              <Link href="/">
                {/* eslint-disable-next-line @next/next/no-img-element -- unoptimized:true toàn app (next.config.mjs) */}
                <img src={LOGO_URL} alt={SITE_NAME} className="h-8 w-auto object-contain" />
              </Link>
            </Tooltip>
            <Tooltip content="Mở rộng menu" side="right">
              <Button
                type="button"
                variant="icon-ghost"
                onClick={onToggleCollapse}
                className={cn('p-1.5 text-sidebar-accent hover:bg-white/10 hover:text-sidebar-foreground', FOCUS_RING)}
                aria-label="Mở rộng menu"
              >
                <PanelLeftOpen className="w-4 h-4" />
              </Button>
            </Tooltip>
          </div>
        ) : (
          /* Expanded: logo + toggle button */
          <div className="flex items-center gap-2">
            <Link
              href="/"
              className={cn('flex items-center gap-2.5 flex-1 min-w-0 rounded-lg', FOCUS_RING)}
              title={`Về trang chủ ${SITE_NAME}`}
            >
              {/* eslint-disable-next-line @next/next/no-img-element -- unoptimized:true toàn app (next.config.mjs) */}
              <img src={LOGO_URL} alt={SITE_NAME} className="h-8 lg:h-9 w-auto object-contain shrink-0" />
              <div className="min-w-0">
                <h1 className="font-bold text-xs lg:text-sm text-sidebar-foreground leading-none truncate">
                  {SITE_NAME}
                </h1>
                <p className="text-[10px] text-sidebar-accent mt-0.5">Video Studio</p>
              </div>
            </Link>
            <Button
              type="button"
              variant="icon-ghost"
              onClick={onToggleCollapse}
              className={cn('p-1.5 text-sidebar-accent hover:bg-white/10 hover:text-sidebar-foreground shrink-0', FOCUS_RING)}
              aria-label="Thu gọn menu"
              title="Thu gọn menu"
            >
              <PanelLeftClose className="w-4 h-4" />
            </Button>
          </div>
        )}
      </div>

      {/* Scrollable content — vùng scroll RIÊNG cho danh sách item, tách khỏi footer (Credits
          card + hàng tiện ích) ghim đáy (footer nằm ngoài div này, xem cuối file) để menu dài
          không đè lên footer */}
      <div className="flex-1 overflow-y-auto overflow-x-hidden py-2 min-h-0">

        {/* Kho video — luôn trên cùng */}
        <nav
          className={cn('pt-2 pb-1 space-y-0.5', collapsed ? 'px-1.5' : 'px-2')}
          aria-label="Kho video"
          onKeyDown={handleGroupArrowNav}
        >
          <SidebarNavItem
            item={videoLibraryMenuItem}
            isActive={activeMenuId === videoLibraryMenuItem.id}
            collapsed={collapsed}
            onClick={() => onMenuClick(videoLibraryMenuItem.id, videoLibraryMenuItem.view)}
          />
        </nav>

        <div className={cn('my-2 border-t border-sidebar-border/60', collapsed ? 'mx-1.5' : 'mx-2')} />

        {/* Creative tools — Điều hướng + Tùy chỉnh */}
        <div className={cn('pb-2 space-y-2', collapsed ? 'px-1.5' : 'px-2')}>
          <ToolGroup
            title="Điều hướng"
            tools={navigationTools}
            activeTool={activeTool}
            collapsed={collapsed}
            onClick={onToolClick}
            disabledTools={disabledTools}
          />
          <ToolGroup
            title="Tùy chỉnh"
            tools={customizeTools}
            activeTool={activeTool}
            collapsed={collapsed}
            onClick={onToolClick}
          />
        </div>

        {/* Preset scripts — hidden when collapsed hoặc chưa có preset nào */}
        {!collapsed && PRESET_SCRIPTS.length > 0 && (
          <>
            <div className="mx-2 my-2 border-t border-sidebar-border/60" />
            <div className="px-2 pb-2">
              <p className="text-[10px] font-bold text-sidebar-accent/70 uppercase tracking-widest px-3 mb-1.5">
                Kịch bản mẫu
              </p>
              <div className="space-y-0.5" role="group" aria-label="Kịch bản mẫu" onKeyDown={handleGroupArrowNav}>
                {PRESET_SCRIPTS.map((script) => (
                  <button
                    key={script.id}
                    type="button"
                    onClick={() => onPresetSelect(script)}
                    className={cn('w-full text-left px-3 py-1.5 rounded-lg hover:bg-white/5 transition-colors duration-150 cursor-pointer group', FOCUS_RING)}
                  >
                    <span className="flex items-center gap-1.5">
                      <span className="block text-xs font-medium text-sidebar-foreground/80 group-hover:text-primary transition-colors truncate">
                        {script.title}
                      </span>
                      <span className="text-[9px] font-bold px-1 py-0.5 rounded bg-primary/15 text-primary border border-primary/25 shrink-0">
                        DEMO
                      </span>
                    </span>
                    <span className="block text-[10px] text-sidebar-accent/70 truncate">{script.desc}</span>
                  </button>
                ))}
              </div>
            </div>
          </>
        )}

        <div className={cn('my-2 border-t border-sidebar-border/60', collapsed ? 'mx-1.5' : 'mx-2')} />

        {/* Lịch sử + Tài khoản — nhóm phụ, đặt dưới cùng vùng scroll */}
        <div className={cn('pb-2 space-y-2', collapsed ? 'px-1.5' : 'px-2')}>
          <MenuGroup
            title="Lịch sử"
            items={historyMenuItems}
            activeMenuId={activeMenuId}
            collapsed={collapsed}
            missingApiKey={missingApiKey}
            onMenuClick={onMenuClick}
          />
          <MenuGroup
            title="Tài khoản"
            items={accountMenuItems}
            activeMenuId={activeMenuId}
            collapsed={collapsed}
            missingApiKey={missingApiKey}
            onMenuClick={onMenuClick}
          />
        </div>
      </div>

      {/* Footer ghim đáy — nằm NGOÀI vùng overflow-y-auto ở trên (shrink-0 + sibling, không
          phải con của vùng scroll) nên menu dài tới đâu cũng không đè lên đây */}
      <div className={cn('py-2.5 border-t border-sidebar-border shrink-0 space-y-2', collapsed ? 'px-1.5' : 'px-2')}>
        <SidebarCreditsCard collapsed={collapsed} onClick={() => onMenuClick('payment', 'payment')} />

        <SidebarUtilityRow collapsed={collapsed} />
      </div>
    </aside>
  );
}

// ─── Hook: persist trạng thái collapse qua localStorage ─────────────────────

const SIDEBAR_COLLAPSED_KEY = 'web-video:sidebar-collapsed';

/** Đọc/ghi trạng thái thu gọn sidebar vào localStorage — tách khỏi component Sidebar (thuần
 *  presentational) vì đây là state của trang, không phải của component hiển thị. */
export function usePersistedSidebarCollapsed(): [boolean, () => void] {
  const [collapsed, setCollapsed] = useState(false);

  useEffect(() => {
    try {
      setCollapsed(window.localStorage.getItem(SIDEBAR_COLLAPSED_KEY) === '1');
    } catch {
      // localStorage có thể bị chặn (chế độ riêng tư nghiêm ngặt...) — bỏ qua, dùng mặc định false
    }
  }, []);

  const toggle = useCallback(() => {
    setCollapsed((prev) => {
      const next = !prev;
      try {
        window.localStorage.setItem(SIDEBAR_COLLAPSED_KEY, next ? '1' : '0');
      } catch {
        // ignore
      }
      return next;
    });
  }, []);

  return [collapsed, toggle];
}

// ─── Mobile bottom nav ───────────────────────────────────────────────────────

interface MobileNavProps {
  activeView: AppView;
  onMenuClick: (menuId: string, view: AppView) => void;
  onMenuOpen: () => void;
}

export function MobileNav({ activeView, onMenuClick, onMenuOpen }: MobileNavProps) {
  const navItems = [
    { id: 'video-library', view: 'video-library' as AppView, icon: Layers, label: 'Kho video' },
    { id: 'payment', view: 'payment' as AppView, icon: CreditCard, label: 'Thanh toán' },
    { id: 'render-history', view: 'render-history' as AppView, icon: Clock, label: 'Lịch sử render' },
    { id: 'video-log', view: 'video-log' as AppView, icon: History, label: 'Nhật Ký' },
    { id: 'api-keys', view: 'api-keys' as AppView, icon: Key, label: 'API Keys' },
  ];

  return (
    <nav className="fixed bottom-0 left-0 right-0 z-(--z-elevated) md:hidden bg-sidebar/95 backdrop-blur-md border-t border-sidebar-border" aria-label="Điều hướng chính (di động)">
      <div className="flex items-stretch h-16">
        {navItems.map((item) => {
          const isActive = activeView === item.view;
          return (
            <button
              key={item.id}
              type="button"
              onClick={() => onMenuClick(item.id, item.view)}
              aria-current={isActive ? 'page' : undefined}
              className={cn('relative flex-1 flex flex-col items-center justify-center gap-1 transition-colors duration-150 cursor-pointer', FOCUS_RING)}
            >
              <item.icon className={cn('w-5 h-5 transition-colors', isActive ? 'text-primary' : 'text-sidebar-accent')} />
              <span className={cn('text-[10px] font-medium transition-colors', isActive ? 'text-primary' : 'text-sidebar-accent/70')}>
                {item.label}
              </span>
              {isActive && <span className="absolute bottom-0 w-8 h-0.5 bg-primary rounded-full" aria-hidden />}
            </button>
          );
        })}

        <button
          type="button"
          onClick={onMenuOpen}
          aria-label="Mở thêm menu"
          className={cn('flex-1 flex flex-col items-center justify-center gap-1 cursor-pointer', FOCUS_RING)}
        >
          <div className="flex flex-col gap-0.75 items-center justify-center w-5 h-5">
            <span className="w-4 h-0.5 bg-sidebar-accent rounded-full" />
            <span className="w-3 h-0.5 bg-sidebar-accent rounded-full" />
            <span className="w-4 h-0.5 bg-sidebar-accent rounded-full" />
          </div>
          <span className="text-[10px] font-medium text-sidebar-accent/70">Thêm</span>
        </button>
      </div>
    </nav>
  );
}
