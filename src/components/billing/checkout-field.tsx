import type { ComponentProps } from 'react';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';

interface CheckoutFieldProps extends ComponentProps<typeof Input> {
  readonly id: string;
  readonly label: string;
  readonly error?: string | null;
  readonly adornment?: React.ReactNode;
}

// One labelled input with an inline error wired up through aria-invalid / aria-describedby.
export function CheckoutField({ id, label, error, adornment, className, ...props }: CheckoutFieldProps): React.ReactElement {
  const errorId = `${id}-error`;
  return (
    <div className={className}>
      <Label htmlFor={id} className="mb-1.5 text-zinc-200">{label}</Label>
      <div className="relative">
        <Input
          id={id}
          className="h-10 pr-12 text-base"
          aria-invalid={error ? true : undefined}
          aria-describedby={error ? errorId : undefined}
          {...props}
        />
        {adornment ? <span className="pointer-events-none absolute inset-y-0 right-3 flex items-center text-xs font-medium text-zinc-300">{adornment}</span> : null}
      </div>
      {error ? <p id={errorId} className="mt-1.5 text-sm text-destructive">{error}</p> : null}
    </div>
  );
}
