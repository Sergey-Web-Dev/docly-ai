import { Features } from '@/components/landing/features';
import { CtaLink } from '@/components/landing/cta-link';
import { Hero } from '@/components/landing/hero';
import { HowItWorks } from '@/components/landing/how-it-works';
import { PricingCards } from '@/components/landing/pricing-cards';
import { SiteFooter } from '@/components/landing/site-footer';
import { SiteHeader } from '@/components/landing/site-header';

export default function Home(): React.ReactElement {
  return (
    <div className="flex min-h-screen flex-col overflow-x-hidden bg-white text-zinc-900">
      <SiteHeader />
      <main className="flex-1">
        <Hero />
        <HowItWorks />
        <Features />
        <section id="pricing" aria-labelledby="pricing-heading" className="scroll-mt-14 bg-white py-16 md:py-24">
          <div className="mx-auto max-w-4xl px-4 sm:px-6">
            <h2 id="pricing-heading" className="text-3xl font-semibold tracking-tight text-zinc-950">
              Simple pricing
            </h2>
            <p className="mt-3 text-zinc-600">Start free. Upgrade when you need more room.</p>
            <div className="mt-10">
              <PricingCards />
            </div>
          </div>
        </section>
        <section aria-labelledby="cta-heading" className="border-t border-zinc-200 bg-zinc-50 py-16">
          <div className="mx-auto flex max-w-6xl flex-col items-center gap-5 px-4 text-center sm:px-6">
            <h2 id="cta-heading" className="text-3xl font-semibold tracking-tight text-zinc-950">
              Ready in 5 minutes
            </h2>
            <CtaLink href="/signup" large>
              Create your assistant
            </CtaLink>
          </div>
        </section>
      </main>
      <SiteFooter />
    </div>
  );
}
