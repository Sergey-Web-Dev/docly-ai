import { ArrowRight, FileText, Sparkles } from 'lucide-react';
import { CtaLink } from './cta-link';

export function Hero(): React.ReactElement {
  return (
    <section aria-labelledby="hero-heading" className="border-b border-zinc-200 bg-gradient-to-b from-white to-zinc-50">
      <div className="mx-auto grid max-w-6xl items-center gap-12 px-4 py-16 sm:px-6 md:py-24 lg:grid-cols-2">
        <div>
          <h1 id="hero-heading" className="text-4xl font-semibold tracking-tight text-zinc-950 text-balance sm:text-5xl">
            Your docs. Instant answers.
          </h1>
          <p className="mt-5 max-w-xl text-lg leading-8 text-zinc-600">
            Upload your company documents, ask questions in a chat, and embed the same assistant on your website.
          </p>
          <div className="mt-8 flex flex-wrap items-center gap-3">
            <CtaLink href="/signup" large>
              Start free
              <ArrowRight data-icon="inline-end" aria-hidden="true" />
            </CtaLink>
            <CtaLink href="#pricing" tone="outline" large>
              See pricing
            </CtaLink>
          </div>
        </div>

        <div aria-hidden="true" className="rounded-xl border border-zinc-200 bg-white p-4 shadow-sm">
          <div className="flex items-center gap-2 border-b border-zinc-100 pb-3 text-xs text-zinc-500">
            <FileText className="size-4 text-indigo-600" />
            employee-handbook.pdf
          </div>
          <div className="space-y-3 pt-4 text-sm">
            <div className="ml-auto w-fit max-w-[85%] rounded-lg rounded-br-sm bg-indigo-600 px-3 py-2 text-white">
              How many vacation days do new hires get?
            </div>
            <div className="w-fit max-w-[85%] rounded-lg rounded-bl-sm bg-zinc-100 px-3 py-2 text-zinc-800">
              <span className="mb-1 flex items-center gap-1 text-xs font-medium text-indigo-600">
                <Sparkles className="size-3" /> Docly AI
              </span>
              Answers come straight from your uploaded documents, with the source shown next to them.
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}
