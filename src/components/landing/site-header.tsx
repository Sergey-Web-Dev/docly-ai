import Link from 'next/link';
import { FileText } from 'lucide-react';
import { CtaLink } from './cta-link';

const NAV_LINKS = [
  { href: '#how-it-works', label: 'How it works' },
  { href: '#pricing', label: 'Pricing' },
] as const;

export function SiteHeader(): React.ReactElement {
  return (
    <header className="sticky top-0 z-40 border-b border-white/10 bg-[#05060f]/60 backdrop-blur-md">
      <div className="mx-auto flex h-14 max-w-6xl items-center justify-between gap-4 px-4 sm:px-6">
        <Link href="/" className="flex items-center gap-2 rounded-md font-semibold text-white outline-none focus-visible:ring-3 focus-visible:ring-indigo-300/60">
          <span className="flex size-7 items-center justify-center rounded-md bg-indigo-600 text-white shadow-[0_0_16px_-2px_rgba(99,102,241,0.8)]" aria-hidden="true">
            <FileText className="size-4" />
          </span>
          Docly AI
        </Link>
        <nav aria-label="Primary" className="flex items-center gap-1">
          {NAV_LINKS.map((link) => (
            <CtaLink key={link.href} href={link.href} tone="ghost" className="hidden sm:inline-flex">
              {link.label}
            </CtaLink>
          ))}
          <CtaLink href="/login" tone="ghost">
            Sign in
          </CtaLink>
          <CtaLink href="/signup">Get started</CtaLink>
        </nav>
      </div>
    </header>
  );
}
