'use client';

import { Check, Copy } from 'lucide-react';
import { useEffect, useRef, useState, useTransition } from 'react';
import { setPublished } from '@/app/dashboard/actions';
import { Button, buttonVariants } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';

interface EmbedPanelProps {
  readonly botId: string;
  readonly isPublished: boolean;
  readonly appOrigin: string;
}

const COPIED_MS = 2000;

export function EmbedPanel({ botId, isPublished, appOrigin }: EmbedPanelProps): React.ReactElement {
  const [published, setPublishedState] = useState(isPublished);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [pending, startTransition] = useTransition();
  const codeRef = useRef<HTMLElement>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const snippet = `<script src="${appOrigin}/widget.js" data-bot-id="${botId}" async></script>`;

  useEffect(() => () => {
    if (timer.current) clearTimeout(timer.current);
  }, []);

  function toggle(next: boolean): void {
    setError(null);
    startTransition(async () => {
      try {
        const result = await setPublished(next);
        if (result.ok) setPublishedState(result.isPublished);
        else setError(result.error);
      } catch {
        setError('Something went wrong. Please try again.');
      }
    });
  }

  function selectSnippet(): void {
    const node = codeRef.current;
    const selection = window.getSelection();
    if (!node || !selection) return;
    const range = document.createRange();
    range.selectNodeContents(node);
    selection.removeAllRanges();
    selection.addRange(range);
  }

  async function copy(): Promise<void> {
    try {
      await navigator.clipboard.writeText(snippet);
      setCopied(true);
      if (timer.current) clearTimeout(timer.current);
      timer.current = setTimeout(() => setCopied(false), COPIED_MS);
    } catch {
      selectSnippet();
    }
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle as="h2">Embed on your website</CardTitle>
        <CardDescription>Paste one script tag into any page to add a chat launcher.</CardDescription>
      </CardHeader>
      <CardContent className="space-y-5">
        <div className="space-y-1">
          <label className="flex items-center gap-3 text-sm font-medium">
            <input
              type="checkbox"
              role="switch"
              className="size-4 accent-indigo-600"
              checked={published}
              disabled={pending}
              onChange={(event) => toggle(event.target.checked)}
            />
            <span>Published — visitors can chat with this bot</span>
          </label>
          <p role="status" aria-live="polite" className="min-h-5 text-sm text-muted-foreground">
            {pending ? 'Saving…' : published ? '' : "Unpublished: visitors will see 'This assistant is unavailable'."}
          </p>
          {error ? <p role="alert" className="text-sm text-destructive">{error}</p> : null}
        </div>

        <div className="space-y-2">
          <p id="embed-snippet-label" className="text-sm font-medium">Embed snippet</p>
          <pre aria-labelledby="embed-snippet-label" data-testid="embed-snippet" className="overflow-x-auto rounded-lg border bg-muted/50 p-3 text-xs">
            <code ref={codeRef}>{snippet}</code>
          </pre>
          <div className="flex flex-wrap items-center gap-2">
            <Button type="button" variant="outline" size="sm" onClick={() => void copy()}>
              {copied ? <Check aria-hidden /> : <Copy aria-hidden />}
              {copied ? 'Copied' : 'Copy snippet'}
            </Button>
            <a href={`/embed/${botId}`} target="_blank" rel="noopener noreferrer" className={buttonVariants({ variant: 'ghost', size: 'sm' })}>
              Preview widget
            </a>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}
