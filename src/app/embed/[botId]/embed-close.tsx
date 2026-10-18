'use client';

import { X } from 'lucide-react';
import { useEffect, useSyncExternalStore } from 'react';
import { Button } from '@/components/ui/button';

function subscribeNever(): () => void {
  return () => undefined;
}

function requestClose(): void {
  window.parent.postMessage({ type: 'docly:close' }, '*');
}

// Esc inside the iframe never reaches the host page, so ask the loader to close. The button only
// makes sense when framed (the preview page opened directly has nothing to close).
export function EmbedClose(): React.ReactElement | null {
  const framed = useSyncExternalStore(subscribeNever, () => window.parent !== window, () => false);

  useEffect(() => {
    function onKeyDown(event: KeyboardEvent): void {
      if (event.key === 'Escape' && !event.isComposing && window.parent !== window) requestClose();
    }
    document.addEventListener('keydown', onKeyDown);
    return () => document.removeEventListener('keydown', onKeyDown);
  }, []);

  if (!framed) return null;
  return (
    <Button type="button" variant="ghost" size="icon-sm" aria-label="Close chat" onClick={requestClose}>
      <X className="size-4" aria-hidden />
    </Button>
  );
}
