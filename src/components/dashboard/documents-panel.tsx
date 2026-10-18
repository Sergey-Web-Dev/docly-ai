'use client';

import { FileText, Loader2 } from 'lucide-react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useRef, useState, useTransition } from 'react';
import { deleteDocument, startDocumentUpload } from '@/app/dashboard/actions';
import { Button, buttonVariants } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import type { Tables } from '@/lib/database.types';
import { validateFile } from '@/lib/ingest/validate-file';
import { createClient } from '@/lib/supabase/client';
import { DocumentStatusBadge } from './document-status-badge';

interface DocumentsPanelProps {
  readonly documents: readonly Tables<'documents'>[];
  readonly planName: string;
  readonly planLimit: number;
}

type Stage = 'idle' | 'uploading' | 'processing';

const STAGE_TEXT: Readonly<Record<Stage, string>> = { idle: '', uploading: 'Uploading…', processing: 'Processing…' };
const PROCESSING_TIMEOUT_MS = 10 * 60 * 1000;
const TIMEOUT_MESSAGE = 'Processing timed out. Please delete the file and upload it again.';
const GENERIC_ERROR = 'Something went wrong. Please try again.';

export function DocumentsPanel({ documents, planName, planLimit }: DocumentsPanelProps): React.ReactElement {
  const router = useRouter();
  const inputRef = useRef<HTMLInputElement>(null);
  const [stage, setStage] = useState<Stage>('idle');
  const [error, setError] = useState<string | null>(null);
  const [upgrade, setUpgrade] = useState(false);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [isRefreshing, startTransition] = useTransition();
  const busy = stage !== 'idle' || deletingId !== null || isRefreshing;

  function refresh(): void {
    startTransition(() => router.refresh());
  }

  async function handleUpload(event: React.FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    if (busy) return;
    setError(null);
    setUpgrade(false);

    const file = inputRef.current?.files?.[0];
    if (!file) {
      setError('Choose a PDF or TXT file first.');
      return;
    }
    const check = validateFile({ name: file.name, type: file.type, size: file.size });
    if (!check.ok) {
      setError(check.error);
      return;
    }

    setStage('uploading');
    try {
      const started = await startDocumentUpload({ fileName: file.name, size: file.size, type: file.type });
      if (!started.ok) {
        setError(started.error);
        setUpgrade(started.upgrade === true);
        return;
      }

      const contentType = file.type || (check.kind === 'pdf' ? 'application/pdf' : 'text/plain');
      const { error: storageError } = await createClient().storage.from('documents').upload(started.storagePath, file, { contentType, upsert: false });
      if (storageError) {
        // Release the quota slot reserved by startDocumentUpload.
        await deleteDocument(started.documentId);
        setError('Upload failed. Please try again.');
        return;
      }

      setStage('processing');
      const response = await fetch(`/api/documents/${started.documentId}/ingest`, { method: 'POST' });
      if (!response.ok) setError(await readErrorMessage(response));
      if (inputRef.current) inputRef.current.value = '';
    } catch {
      setError(GENERIC_ERROR);
    } finally {
      setStage('idle');
      refresh();
    }
  }

  async function handleDelete(document: Tables<'documents'>): Promise<void> {
    if (busy) return;
    if (!window.confirm(`Delete "${document.file_name}"? The bot will stop using it.`)) return;
    setError(null);
    setUpgrade(false);
    setDeletingId(document.id);
    try {
      const result = await deleteDocument(document.id);
      if (!result.ok) setError(result.error ?? GENERIC_ERROR);
    } catch {
      setError(GENERIC_ERROR);
    } finally {
      setDeletingId(null);
      refresh();
    }
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle as="h2">Documents</CardTitle>
        <CardDescription data-testid="documents-usage">{documents.length} / {planLimit} documents · {planName} plan</CardDescription>
      </CardHeader>
      <CardContent className="space-y-6">
        <form onSubmit={handleUpload} className="space-y-3">
          <div className="space-y-2">
            <Label htmlFor="document-file">Document file</Label>
            <div className="flex flex-col gap-2 sm:flex-row">
              <Input id="document-file" ref={inputRef} type="file" accept=".pdf,.txt,application/pdf,text/plain" disabled={busy} className="h-9 py-1" />
              <Button type="submit" disabled={busy} className="h-9 sm:w-28">Upload</Button>
            </div>
          </div>
          <p role="status" aria-live="polite" className="flex min-h-5 items-center gap-2 text-sm text-muted-foreground">
            {stage !== 'idle' ? <Loader2 className="size-4 animate-spin" aria-hidden /> : null}
            {STAGE_TEXT[stage]}
          </p>
          {error ? (
            <div role="alert" className="flex flex-wrap items-center gap-x-3 gap-y-1 text-sm text-destructive">
              <span>{error}</span>
              {upgrade ? <Link href="/dashboard/billing" className={buttonVariants({ size: 'sm' })}>Upgrade to Pro</Link> : null}
            </div>
          ) : null}
        </form>

        {documents.length === 0 ? (
          <div className="rounded-lg border border-dashed p-6 text-center">
            <FileText className="mx-auto mb-2 size-8 text-muted-foreground" aria-hidden />
            <p className="font-medium">Upload documents</p>
            <p className="text-sm text-muted-foreground">PDF or TXT, up to 5 MB</p>
          </div>
        ) : (
          <ul className="divide-y rounded-lg border" aria-label="Uploaded documents">
            {documents.map((document) => {
              const timedOut = isTimedOut(document);
              const failureMessage = timedOut ? TIMEOUT_MESSAGE : document.status === 'failed' ? document.error_message : null;
              return (
              <li key={document.id} className="flex flex-wrap items-start justify-between gap-3 p-3">
                <div className="min-w-0 flex-1 space-y-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="break-all font-medium">{document.file_name}</span>
                    <DocumentStatusBadge status={timedOut ? 'failed' : document.status} />
                  </div>
                  {failureMessage ? <p className="text-sm text-destructive">{failureMessage}</p> : null}
                </div>
                <Button type="button" variant="outline" size="sm" disabled={busy} aria-label={`Delete ${document.file_name}`} onClick={() => void handleDelete(document)}>
                  {deletingId === document.id ? 'Deleting…' : 'Delete'}
                </Button>
              </li>
              );
            })}
          </ul>
        )}
      </CardContent>
    </Card>
  );
}

function isTimedOut(document: Tables<'documents'>): boolean {
  if (document.status !== 'processing') return false;
  return Date.now() - new Date(document.ingest_started_at ?? document.created_at).getTime() > PROCESSING_TIMEOUT_MS;
}

async function readErrorMessage(response: Response): Promise<string> {
  try {
    const body = (await response.json()) as { error?: { message?: string } };
    return body.error?.message ?? GENERIC_ERROR;
  } catch {
    return GENERIC_ERROR;
  }
}
