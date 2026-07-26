import type { Metadata } from 'next';
import type { ReactNode } from 'react';
import './globals.css';

export const metadata: Metadata = {
  title: 'Cable Quoting',
  description: 'RFQ to priced quotation, on live copper.',
};

const NAV = [
  { label: 'Inbox', href: '/', phase: 2 },
  { label: 'Catalogue', href: '/catalogue', phase: 1 },
  { label: 'Quotes', href: '/quotes', phase: 2 },
  { label: 'Rate Desk', href: '/rates', phase: 1 },
  { label: 'Vocabulary', href: '/vocabulary', phase: 2 },
  { label: 'Price Watch', href: '/price-watch', phase: 1 },
  { label: 'History', href: '/history', phase: 1 },
] as const;

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <body>
        <div className="flex min-h-screen">
          <nav
            className="shrink-0"
            style={{
              width: 'var(--rail-width)',
              borderRight: '1px solid var(--color-line-hairline)',
              backgroundColor: 'var(--color-surface-panel)',
            }}
          >
            <div
              style={{
                padding: '16px',
                borderBottom: '1px solid var(--color-line-hairline)',
              }}
            >
              <div
                style={{
                  fontFamily: 'var(--font-display)',
                  fontSize: 'var(--text-heading)',
                  fontWeight: 550,
                  letterSpacing: '-0.01em',
                }}
              >
                Cable Quoting
              </div>
            </div>

            {/* Labels always visible — no icons-only mode. */}
            <ul style={{ padding: '8px 0' }}>
              {NAV.map((item) => (
                <li key={item.href}>
                  <a
                    href={item.href}
                    className="flex items-center justify-between transition-colors"
                    style={{
                      padding: '6px 16px',
                      color: 'var(--color-ink-secondary)',
                      minHeight: 'var(--row-height)',
                    }}
                  >
                    {item.label}
                    <span
                      className="numeric"
                      style={{
                        color: 'var(--color-ink-tertiary)',
                        fontSize: 'var(--text-micro)',
                      }}
                      title={`Ships in phase ${item.phase}`}
                    >
                      P{item.phase}
                    </span>
                  </a>
                </li>
              ))}
            </ul>
          </nav>

          <main className="min-w-0 flex-1">{children}</main>
        </div>
      </body>
    </html>
  );
}
