import Link from 'next/link';
import type { ComponentProps } from 'react';
import { buttonVariants } from '@/components/ui/button';
import { cn } from '@/lib/utils';

type CtaTone = 'accent' | 'outline' | 'ghost';

interface CtaLinkProps extends ComponentProps<typeof Link> {
  readonly tone?: CtaTone;
  readonly large?: boolean;
}

const TONES: Record<CtaTone, string> = {
  accent: 'bg-indigo-600 text-white shadow-[0_0_28px_-6px_rgba(99,102,241,0.8)] hover:bg-indigo-500 hover:shadow-[0_0_34px_-4px_rgba(129,140,248,0.9)]',
  outline: 'border-white/15 bg-white/5 text-zinc-100 backdrop-blur hover:bg-white/10 hover:text-white',
  ghost: 'text-zinc-300 hover:bg-white/10 hover:text-white',
};

export function CtaLink({ tone = 'accent', large = false, className, ...props }: CtaLinkProps): React.ReactElement {
  const variant = tone === 'ghost' ? 'ghost' : tone === 'outline' ? 'outline' : 'default';
  return (
    <Link
      className={cn(buttonVariants({ variant, size: large ? 'lg' : 'default' }), large && 'h-10 px-4 text-sm', 'focus-visible:border-indigo-300 focus-visible:ring-indigo-300/60', TONES[tone], className)}
      {...props}
    />
  );
}
