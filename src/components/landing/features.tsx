import { Lock, ShieldCheck, Zap, type LucideIcon } from 'lucide-react';

interface Feature {
  readonly title: string;
  readonly description: string;
  readonly icon: LucideIcon;
}

const FEATURES: readonly Feature[] = [
  {
    title: 'Grounded answers',
    description: 'Replies come from your documents. When the answer is not in them, the assistant says "I don\'t know" instead of guessing.',
    icon: ShieldCheck,
  },
  { title: 'One-line embed', description: 'Add the chat widget to any site with a single script tag. No backend work required.', icon: Zap },
  { title: 'Private by default', description: 'Your documents belong to your account only. Nobody else can see or query them.', icon: Lock },
];

export function Features(): React.ReactElement {
  return (
    <section aria-labelledby="features-heading" className="border-y border-white/10 bg-white/[0.02] py-16 md:py-24">
      <div className="mx-auto max-w-6xl px-4 sm:px-6">
        <h2 id="features-heading" className="text-3xl font-semibold tracking-tight text-white">
          Built to be trusted
        </h2>
        <ul className="mt-10 grid gap-8 md:grid-cols-3">
          {FEATURES.map((feature) => (
            <li key={feature.title}>
              <feature.icon className="size-5 text-indigo-300" aria-hidden="true" />
              <h3 className="mt-3 font-medium text-white">{feature.title}</h3>
              <p className="mt-2 text-sm leading-6 text-zinc-400">{feature.description}</p>
            </li>
          ))}
        </ul>
      </div>
    </section>
  );
}
