'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useEffect, useRef, useState, useSyncExternalStore } from 'react';
import { CheckCircle2, CreditCard, Loader2 } from 'lucide-react';
import { completeDemoCheckout } from '@/app/dashboard/actions';
import { CheckoutField } from '@/components/billing/checkout-field';
import { Button, buttonVariants } from '@/components/ui/button';
import {
  detectBrand,
  formatCardNumber,
  normalizeCardNumber,
  tokenizeTestCard,
  DEMO_ONLY_MESSAGE,
  type CardBrand,
  type CardField,
} from '@/lib/payments/demo-card';
import { cn } from '@/lib/utils';

interface CheckoutFormProps {
  readonly email: string;
  readonly priceLabel: string;
  readonly isAlreadyPro: boolean;
}

interface Receipt {
  readonly chargeId: string;
  readonly brand: CardBrand;
  readonly last4: string;
}

type FieldErrors = Partial<Record<CardField, string>>;

const FIELD_IDS: Readonly<Record<CardField, string>> = {
  number: 'checkout-card-number',
  expiry: 'checkout-card-expiry',
  cvc: 'checkout-card-cvc',
  name: 'checkout-card-name',
};
const BRAND_LABEL: Readonly<Record<CardBrand, string>> = { visa: 'Visa', mastercard: 'Mastercard', amex: 'Amex', unknown: '' };
const TEST_CARD_NUMBER = '4242 4242 4242 4242';

// Keeps password managers and autofill away from the card fields (the names are deliberately non-standard too).
const NO_AUTOFILL = {
  autoComplete: 'off',
  'data-1p-ignore': true,
  'data-lpignore': 'true',
  'data-bwignore': true,
  'data-form-type': 'other',
} as const;

function formatExpiry(value: string): string {
  const digits = value.replace(/\D/g, '').slice(0, 4);
  return digits.length > 2 ? `${digits.slice(0, 2)}/${digits.slice(2)}` : digits;
}

function futureExpiry(): string {
  return `12/${String((new Date().getFullYear() + 3) % 100).padStart(2, '0')}`;
}

// Hydration flag: the fields stay disabled until the client handlers exist, so a native form submit can never put
// card digits in a URL.
function useIsHydrated(): boolean {
  return useSyncExternalStore(() => () => undefined, () => true, () => false);
}

export function CheckoutForm({ email, priceLabel, isAlreadyPro }: CheckoutFormProps): React.ReactElement {
  const router = useRouter();
  const isHydrated = useIsHydrated();
  const [number, setNumber] = useState('');
  const [expiry, setExpiry] = useState('');
  const [cvc, setCvc] = useState('');
  const [name, setName] = useState('');
  const [errors, setErrors] = useState<FieldErrors>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [isProcessing, setIsProcessing] = useState(false);
  const [receipt, setReceipt] = useState<Receipt | null>(null);
  // One key per page load: a repeated submit of the same checkout can never charge twice.
  const [checkoutId] = useState(() => crypto.randomUUID());
  const isSubmittingRef = useRef(false);
  const receiptRef = useRef<HTMLDivElement>(null);
  const errorRef = useRef<HTMLParagraphElement>(null);

  useEffect(() => {
    if (receipt) receiptRef.current?.focus();
  }, [receipt]);

  useEffect(() => {
    if (formError) errorRef.current?.focus();
  }, [formError]);

  const brand = detectBrand(number);
  const isDisabled = !isHydrated || isProcessing;

  function clearCardData(): void {
    setNumber('');
    setExpiry('');
    setCvc('');
  }

  function fillTestCard(): void {
    setNumber(TEST_CARD_NUMBER);
    setExpiry(futureExpiry());
    setCvc('123');
    setName((current) => current.trim() || 'Test Customer');
    setErrors({});
    setFormError(null);
  }

  async function handleSubmit(event: React.FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    if (isDisabled || isSubmittingRef.current) return;
    setFormError(null);

    const tokenized = tokenizeTestCard({ number, expiry, cvc, name });
    if (!tokenized.ok) {
      // A real (non-test) card number must not stay in the DOM or in state a moment longer than needed.
      if (tokenized.error === DEMO_ONLY_MESSAGE) clearCardData();
      setErrors({ [tokenized.field]: tokenized.error });
      document.getElementById(FIELD_IDS[tokenized.field])?.focus();
      return;
    }
    setErrors({});
    isSubmittingRef.current = true;
    setIsProcessing(true);
    try {
      // Only the token and the idempotency key leave the browser. The number, expiry and CVC never do.
      const result = await completeDemoCheckout({ token: tokenized.token, idempotencyKey: checkoutId });
      if (result.ok) {
        setReceipt({ chargeId: result.chargeId, brand: result.brand, last4: result.last4 });
        setName('');
        router.refresh();
      } else {
        setFormError(result.error);
      }
    } catch {
      setFormError('Something went wrong. Please try again.');
    } finally {
      clearCardData();
      isSubmittingRef.current = false;
      setIsProcessing(false);
    }
  }

  // The receipt wins over the Pro check: the refresh after a successful payment flips isAlreadyPro to true.
  if (receipt) return <SuccessPanel receipt={receipt} panelRef={receiptRef} />;
  if (isAlreadyPro) {
    return (
      <div className="space-y-3">
        <p role="status">You&apos;re already on Pro.</p>
        <Link href="/dashboard/billing" className={buttonVariants({ variant: 'outline' })}>Back to billing</Link>
      </div>
    );
  }

  const fieldProps = (field: CardField): { error: string | undefined; disabled: boolean } => ({ error: errors[field], disabled: isDisabled });

  return (
    <form onSubmit={(event) => void handleSubmit(event)} noValidate autoComplete="off" aria-label="Payment details" className="space-y-5">
      <div role="note" className="rounded-lg border border-amber-300 bg-amber-50 p-3 text-sm text-amber-950">
        <p className="font-semibold">Never enter a real card — real cards are rejected.</p>
        <p className="mt-1">
          <strong>Demo checkout — no real payment.</strong> Use test card <strong>{TEST_CARD_NUMBER}</strong>, any future date, any CVC.
        </p>
        <Button type="button" size="sm" variant="outline" className="mt-2 border-amber-400 bg-white" onClick={fillTestCard} disabled={isDisabled}>
          Fill test card
        </Button>
        <details className="mt-2">
          <summary className="cursor-pointer text-xs font-medium">More test cards</summary>
          <ul className="mt-1 space-y-0.5 text-xs">
            <li>5555 5555 5555 4444 — Mastercard, succeeds</li>
            <li>4000 0000 0000 0002 — declined</li>
            <li>4000 0000 0000 9995 — insufficient funds</li>
          </ul>
        </details>
      </div>

      <CheckoutField id="checkout-email" label="Email" name="demo-contact" type="email" value={email} readOnly autoComplete="off" className="[&_input]:bg-zinc-50" />

      <CheckoutField
        id={FIELD_IDS.number}
        label="Card number"
        name="demo-card-number"
        inputMode="numeric"
        {...NO_AUTOFILL}
        autoCorrect="off"
        autoCapitalize="off"
        spellCheck={false}
        placeholder="1234 1234 1234 1234"
        maxLength={23}
        value={number}
        onChange={(event) => setNumber(formatCardNumber(normalizeCardNumber(event.target.value)))}
        adornment={BRAND_LABEL[brand] ? <span>{BRAND_LABEL[brand]}</span> : <CreditCard className="size-4" aria-hidden />}
        {...fieldProps('number')}
      />

      <div className="grid grid-cols-2 gap-4">
        <CheckoutField
          id={FIELD_IDS.expiry}
          label="Expiry (MM/YY)"
          name="demo-card-exp"
          inputMode="numeric"
          {...NO_AUTOFILL}
          autoCorrect="off"
          spellCheck={false}
          placeholder="MM/YY"
          maxLength={5}
          value={expiry}
          onChange={(event) => setExpiry(formatExpiry(event.target.value))}
          {...fieldProps('expiry')}
        />
        <CheckoutField
          id={FIELD_IDS.cvc}
          label="CVC"
          name="demo-card-cvv"
          inputMode="numeric"
          {...NO_AUTOFILL}
          autoCorrect="off"
          spellCheck={false}
          placeholder="123"
          maxLength={4}
          value={cvc}
          onChange={(event) => setCvc(event.target.value.replace(/\D/g, '').slice(0, 4))}
          {...fieldProps('cvc')}
        />
      </div>

      <CheckoutField
        id={FIELD_IDS.name}
        label="Name on card"
        name="demo-card-holder"
        {...NO_AUTOFILL}
        autoCorrect="off"
        spellCheck={false}
        value={name}
        onChange={(event) => setName(event.target.value)}
        {...fieldProps('name')}
      />

      {formError ? (
        <p ref={errorRef} role="alert" tabIndex={-1} className="rounded-lg border border-red-300 bg-red-50 p-3 text-sm text-red-900 outline-none">{formError}</p>
      ) : null}

      <Button type="submit" size="lg" className="h-11 w-full bg-indigo-600 text-base text-white hover:bg-indigo-700" disabled={isDisabled}>
        {isProcessing ? (
          <>
            <Loader2 className="size-4 animate-spin" aria-hidden />
            Processing payment…
          </>
        ) : (
          `Pay ${priceLabel} — demo`
        )}
      </Button>
      <p role="status" className="sr-only">{isProcessing ? 'Processing payment…' : ''}</p>
      <p className="text-center text-xs text-zinc-500">Card details stay in your browser. Only a test token is sent to the server.</p>
    </form>
  );
}

function SuccessPanel({ receipt, panelRef }: { readonly receipt: Receipt; readonly panelRef: React.RefObject<HTMLDivElement | null> }): React.ReactElement {
  const brandLabel = BRAND_LABEL[receipt.brand];
  return (
    <div ref={panelRef} tabIndex={-1} role="status" data-testid="checkout-success" className="space-y-4 rounded-lg border border-emerald-300 bg-emerald-50 p-5 outline-none">
      <div className="flex items-center gap-2 text-emerald-900">
        <CheckCircle2 className="size-5" aria-hidden />
        <h3 className="text-lg font-semibold">Payment successful — you&apos;re on Pro</h3>
      </div>
      <dl className="space-y-1 text-sm text-emerald-950">
        <div className="flex justify-between gap-4"><dt>Demo receipt</dt><dd data-testid="checkout-charge-id" className="font-mono">{receipt.chargeId}</dd></div>
        {receipt.last4 ? <div className="flex justify-between gap-4"><dt>Card</dt><dd>{brandLabel ? `${brandLabel} ` : ''}•••• {receipt.last4}</dd></div> : null}
      </dl>
      <p className="text-xs text-emerald-900">This was a demo: no money was charged.</p>
      <Link href="/dashboard/billing" className={cn(buttonVariants({ variant: 'default' }), 'bg-emerald-700 text-white hover:bg-emerald-800')}>Back to billing</Link>
    </div>
  );
}
