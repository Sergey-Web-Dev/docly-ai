import { z } from 'zod';
import { AppError, toErrorResponse } from '@/lib/errors';
import { ingestDocument } from '@/lib/ingest/ingest-document';
import { createAdminClient } from '@/lib/supabase/admin';
import { createClient } from '@/lib/supabase/server';

export const runtime = 'nodejs';
export const maxDuration = 60;

export async function POST(_request: Request, context: { params: Promise<{ id: string }> }): Promise<Response> {
  try {
    const { id } = await context.params;
    if (!z.uuid().safeParse(id).success) throw new AppError('VALIDATION', 'Invalid document id.');

    const supabase = await createClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) throw new AppError('UNAUTHORIZED', 'Please sign in again.');

    // RLS: returns the row only if the caller owns its chatbot.
    const { data: document } = await supabase.from('documents').select('id, chatbot_id, file_name, storage_path, status').eq('id', id).maybeSingle();
    if (!document) throw new AppError('NOT_FOUND', 'Document not found.');

    const admin = createAdminClient();
    const { data: claimed } = await admin.from('documents')
      .update({ ingest_started_at: new Date().toISOString() })
      .eq('id', id).eq('status', 'processing').is('ingest_started_at', null)
      .select('id').maybeSingle();
    if (!claimed) throw new AppError('DUPLICATE', 'This document is already being processed.');

    const result = await ingestDocument(admin, { id, chatbotId: document.chatbot_id, fileName: document.file_name, storagePath: document.storage_path });
    return Response.json({ document: { id, ...result } });
  } catch (error) {
    return toErrorResponse(error);
  }
}
