'use server';

import { revalidatePath } from 'next/cache';
import { z } from 'zod';
import { requireUser } from '@/lib/auth/require-user';
import { getOwnChatbot, getOwnPlan } from '@/lib/chatbots';
import { validateFile } from '@/lib/ingest/validate-file';
import { parseBotSettings } from '@/lib/schemas';
import { createAdminClient } from '@/lib/supabase/admin';

export interface ActionState {
  readonly error: string | null;
  readonly notice?: string;
  readonly upgrade?: boolean;
}

export type StartUploadResult =
  | { readonly ok: true; readonly documentId: string; readonly storagePath: string }
  | { readonly ok: false; readonly error: string; readonly upgrade?: boolean };

export interface DeleteDocumentResult {
  readonly ok: boolean;
  readonly error?: string;
}

const UNIQUE_VIOLATION = '23505';
const GENERIC_ERROR = 'Something went wrong. Please try again.';

export async function createBot(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const { user, supabase } = await requireUser();
  const input = parseBotSettings(formData);
  if (!input.ok) return { error: input.error };

  const { error } = await supabase.from('chatbots').insert({ owner_id: user.id, name: input.name, welcome_message: input.welcomeMessage });
  if (error) {
    if (error.code === UNIQUE_VIOLATION) return { error: 'You already have a bot.' };
    console.error('[bot] create failed', { code: error.code });
    return { error: GENERIC_ERROR };
  }
  revalidatePath('/dashboard');
  return { error: null, notice: 'Bot created' };
}

export async function updateBot(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const { user, supabase } = await requireUser();
  const input = parseBotSettings(formData);
  if (!input.ok) return { error: input.error };

  const { data, error } = await supabase
    .from('chatbots')
    .update({ name: input.name, welcome_message: input.welcomeMessage, updated_at: new Date().toISOString() })
    .eq('owner_id', user.id)
    .select('id');
  if (error) {
    console.error('[bot] update failed', { code: error.code });
    return { error: GENERIC_ERROR };
  }
  if (data.length === 0) return { error: 'Create your bot first.' };
  revalidatePath('/dashboard');
  return { error: null, notice: 'Saved' };
}

export async function startDocumentUpload(input: { fileName: string; size: number; type: string }): Promise<StartUploadResult> {
  const { user, supabase } = await requireUser();

  const validation = validateFile({ name: input.fileName, type: input.type, size: input.size });
  if (!validation.ok) return { ok: false, error: validation.error };

  const chatbot = await getOwnChatbot(supabase, user.id);
  if (!chatbot) return { ok: false, error: 'Create your bot first.' };

  const plan = await getOwnPlan(supabase, user.id);
  const { data, error } = await createAdminClient().rpc('create_document', {
    p_chatbot_id: chatbot.id,
    p_file_name: input.fileName,
    p_size_bytes: input.size,
    p_max_documents: plan.documents,
  });
  if (error) {
    if (error.message.includes('QUOTA_EXCEEDED')) {
      return { ok: false, error: `Your ${plan.name} plan allows ${plan.documents} documents. Delete one or upgrade to Pro.`, upgrade: plan.id === 'free' };
    }
    if (error.message.includes('DUPLICATE')) {
      return { ok: false, error: 'A document with this name already exists. Delete it first or rename the file.' };
    }
    console.error('[documents] create_document failed', { code: error.code });
    return { ok: false, error: GENERIC_ERROR };
  }

  revalidatePath('/dashboard');
  return { ok: true, documentId: data.id, storagePath: data.storage_path };
}

export async function deleteDocument(documentId: string): Promise<DeleteDocumentResult> {
  const { supabase } = await requireUser();
  if (!z.uuid().safeParse(documentId).success) return { ok: false, error: 'Invalid document.' };

  // User client: RLS returns the row only when the caller owns its chatbot.
  const { data: document } = await supabase.from('documents').select('id, storage_path').eq('id', documentId).maybeSingle();
  if (!document) return { ok: false, error: 'Document not found.' };

  const { error: storageError } = await supabase.storage.from('documents').remove([document.storage_path]);
  if (storageError) {
    console.error('[documents] storage remove failed', { documentId });
    return { ok: false, error: GENERIC_ERROR };
  }
  const { error } = await supabase.from('documents').delete().eq('id', documentId);
  if (error) {
    console.error('[documents] delete failed', { documentId, code: error.code });
    return { ok: false, error: GENERIC_ERROR };
  }
  revalidatePath('/dashboard');
  return { ok: true };
}
