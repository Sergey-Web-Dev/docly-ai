import { ArrowRight } from 'lucide-react';
import { ChatPreview } from './chat-preview';
import { CtaLink } from './cta-link';

export function Hero(): React.ReactElement {
  return (
    <section aria-labelledby="hero-heading" className="border-b border-white/10">
      <div className="mx-auto grid max-w-6xl items-center gap-12 px-4 py-16 sm:px-6 md:py-24 lg:grid-cols-2">
        <div>
          <h1 id="hero-heading" className="bg-gradient-to-b from-white to-indigo-200 bg-clip-text text-4xl font-semibold tracking-tight text-balance text-transparent sm:text-6xl">
            Your docs. Instant answers.
          </h1>
          <p className="mt-5 max-w-xl text-lg leading-8 text-zinc-400">
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

        <ChatPreview />
      </div>
    </section>
  );
}
