import type { AnchorHTMLAttributes } from 'react';

const SITE_URL = import.meta.env.VITE_SITE_URL || 'https://htstudiovn.com';

/**
 * Drop-in replacement for `next/link` in the ported Studio code. The desktop app has no pages
 * to route between, so a link always means "open the website" — in the system browser.
 * Relative hrefs (e.g. "/") are resolved against the website, not against the app.
 */
export default function AppLink({
  href,
  onClick,
  children,
  ...rest
}: Omit<AnchorHTMLAttributes<HTMLAnchorElement>, 'href'> & { href: string }) {
  const target = new URL(href, SITE_URL).toString();

  return (
    <a
      {...rest}
      href={target}
      onClick={(event) => {
        onClick?.(event);
        if (event.defaultPrevented) return;
        event.preventDefault();
        void window.ht.openExternal(target);
      }}
    >
      {children}
    </a>
  );
}
