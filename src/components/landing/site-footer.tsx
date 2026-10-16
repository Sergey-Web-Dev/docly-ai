import Link from 'next/link';

export function SiteFooter(): React.ReactElement {
  return (
    <footer className="border-t border-zinc-200 bg-white">
      <div className="mx-auto flex max-w-6xl flex-col gap-4 px-4 py-8 text-sm text-zinc-600 sm:flex-row sm:items-center sm:justify-between sm:px-6">
        <p>&copy; {new Date().getFullYear()} Docly AI</p>
        <nav aria-label="Footer" className="flex gap-4">
          <Link href="#how-it-works" className="rounded-sm hover:text-zinc-900 focus-visible:outline-2 focus-visible:outline-indigo-600">How it works</Link>
          <Link href="#pricing" className="rounded-sm hover:text-zinc-900 focus-visible:outline-2 focus-visible:outline-indigo-600">Pricing</Link>
          <Link href="/login" className="rounded-sm hover:text-zinc-900 focus-visible:outline-2 focus-visible:outline-indigo-600">Sign in</Link>
        </nav>
      </div>
    </footer>
  );
}
