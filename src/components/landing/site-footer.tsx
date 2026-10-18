import Link from 'next/link';

export function SiteFooter(): React.ReactElement {
  return (
    <footer className="border-t border-white/10 bg-[#05060f]/50 backdrop-blur">
      <div className="mx-auto flex max-w-6xl flex-col gap-4 px-4 py-8 text-sm text-zinc-400 sm:flex-row sm:items-center sm:justify-between sm:px-6">
        <p>&copy; {new Date().getFullYear()} Docly AI</p>
        <nav aria-label="Footer" className="flex gap-4">
          <Link href="#how-it-works" className="rounded-sm hover:text-white focus-visible:outline-2 focus-visible:outline-indigo-300">How it works</Link>
          <Link href="#pricing" className="rounded-sm hover:text-white focus-visible:outline-2 focus-visible:outline-indigo-300">Pricing</Link>
          <Link href="/login" className="rounded-sm hover:text-white focus-visible:outline-2 focus-visible:outline-indigo-300">Sign in</Link>
        </nav>
      </div>
    </footer>
  );
}
