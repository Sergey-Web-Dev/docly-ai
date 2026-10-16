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
  accent: 'bg-indigo-600 text-white hover:bg-indigo-700 focus-visible:ring-indigo-600/40',
  outline: 'border-zinc-200 bg-white text-zinc-900 hover:bg-zinc-50',
  ghost: 'text-zinc-600 hover:bg-zinc-100 hover:text-zinc-900',
};

export function CtaLink({ tone = 'accent', large = false, className, ...props }: CtaLinkProps): React.ReactElement {
  const variant = tone === 'ghost' ? 'ghost' : tone === 'outline' ? 'outline' : 'default';
  return (
    <Link
      className={cn(buttonVariants({ variant, size: large ? 'lg' : 'default' }), large && 'h-10 px-4 text-sm', TONES[tone], className)}
      {...props}
    />
  );
}
