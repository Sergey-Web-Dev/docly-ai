'use server';

import { revalidatePath } from 'next/cache';
import { z } from 'zod';
import { requireUser } from '@/lib/auth/require-user';
import { changePlan } from '@/lib/billing';
import { getOwnChatbot, getOwnPlan } from '@/lib/chatbots';
import { getPaymentProvider } from '@/lib/payments/get-payment-provider';
import { PLANS, type PlanId } from '@/lib/plans';
import { validateFile } from '@/lib/ingest/validate-file';
import { MAX_FILE_BYTES } from '@/lib/rag-config';
import { type CheckoutInput, checkoutInputSchema, downgradePlanSchema, isPublishedSchema, parseBotSettings } from '@/lib/schemas';
import { createAdminClient } from '@/lib/supabase/admin';

export interface ActionState {
  readonly error: string | null;
  readonly notice?: string;
  readonly upgrade?: boolean;
}

export type StartUploadResult =
  | { readonly ok: true; readonly documentId: string; readonly storagePath: string }
  | { readonly ok: false; readonly error: string; readonly upgrade?: boolean };

export type SetPublishedResult = { readonly ok: true; readonly isPublished: boolean } | { readonly ok: false; readonly error: string };

export type SetPlanResult = { readonly ok: true; readonly plan: PlanId } | { readonly ok: false; readonly error: string };

export type CheckoutResult =
  | { readonly ok: true; readonly chargeId: string; readonly last4?: string }
  | { readonly ok: false; readonly error: string };

export interface DeleteDocumentResult {
  readonly ok: boolean;
  readonly error?: string;
}

const UNIQUE_VIOLATION = '23505';
const QUOTA_EXCEEDED = 'DQ001';
const DUPLICATE = 'DQ002';
const NOT_FOUND = 'P0002';
const CONTROL_CHARS = /[\u0000-\u001f\u007f-\u009f]/g;

const uploadInputSchema = z.object({
  fileName: z.string().max(1000).transform((name) => name.replace(CONTROL_CHARS, '')).pipe(z.string().trim().min(1).max(255)),
  size: z.number().int().positive().max(MAX_FILE_BYTES),
  type: z.string().max(100),
});
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
    .update({ name: input.name, welcome_message: input.welcomeMessage })
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

export async function setPublished(isPublished: boolean): Promise<SetPublishedResult> {
  const { user, supabase } = await requireUser();
  const parsed = isPublishedSchema.safeParse(isPublished);
  if (!parsed.success) return { ok: false, error: 'Invalid request.' };

  const { data, error } = await supabase
    .from('chatbots')
    .update({ is_published: parsed.data })
    .eq('owner_id', user.id)
    .select('id');
  if (error) {
    console.error('[bot] publish toggle failed', { code: error.code });
    return { ok: false, error: GENERIC_ERROR };
  }
  if (data.length === 0) return { ok: false, error: 'Create your bot first.' };
  revalidatePath('/dashboard');
  return { ok: true, isPublished: parsed.data };
}

// Downgrade / cancel only. Upgrading to Pro goes through completeDemoCheckout; no client can set Pro directly.
export async function setPlan(planId: 'free'): Promise<SetPlanResult> {
  const { user } = await requireUser();
  const parsed = downgradePlanSchema.safeParse(planId);
  if (!parsed.success) return { ok: false, error: parsed.error.issues[0]?.message ?? 'Invalid plan.' };

  try {
    await changePlan(createAdminClient(), user.id, parsed.data);
  } catch {
    return { ok: false, error: GENERIC_ERROR };
  }
  revalidatePath('/dashboard', 'layout');
  return { ok: true, plan: parsed.data };
}

// Demo checkout. The browser tokenizes a Stripe test card locally; only the token (plus brand/last4 for display) arrives
// here. The card number, expiry and CVC never reach the server. Logs carry the user id, token type and result only.
export async function completeDemoCheckout(input: CheckoutInput): Promise<CheckoutResult> {
  const { user, supabase } = await requireUser();
  const parsed = checkoutInputSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: 'Invalid payment details.' };
  const { token, last4 } = parsed.data;

  try {
    if ((await getOwnPlan(supabase, user.id)).id === 'pro') return { ok: false, error: "You're already on Pro." };

    const charge = await getPaymentProvider().charge({ token, amountUsd: PLANS.pro.priceUsd, description: 'Docly AI Pro (demo)', customerId: user.id });
    console.info('[checkout] charge', { userId: user.id, token, result: charge.ok ? 'succeeded' : charge.code });
    if (!charge.ok) return { ok: false, error: charge.message };

    await changePlan(createAdminClient(), user.id, 'pro');
    revalidatePath('/dashboard', 'layout');
    return { ok: true, chargeId: charge.chargeId, ...(last4 ? { last4 } : {}) };
  } catch (error) {
    console.error('[checkout] failed', { userId: user.id, token, name: error instanceof Error ? error.name : typeof error });
    return { ok: false, error: GENERIC_ERROR };
  }
}

export async function startDocumentUpload(input: { fileName: string; size: number; type: string }): Promise<StartUploadResult> {
  const { user, supabase } = await requireUser();

  const parsed = uploadInputSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: 'Invalid file.' };
  const { fileName, size, type } = parsed.data;

  const validation = validateFile({ name: fileName, type, size });
  if (!validation.ok) return { ok: false, error: validation.error };

  const chatbot = await getOwnChatbot(supabase, user.id);
  if (!chatbot) return { ok: false, error: 'Create your bot first.' };

  const plan = await getOwnPlan(supabase, user.id);
  const { data, error } = await createAdminClient().rpc('create_document', {
    p_chatbot_id: chatbot.id,
    p_file_name: fileName,
    p_size_bytes: size,
    p_max_documents: plan.documents,
  });
  if (error) {
    if (error.code === QUOTA_EXCEEDED) {
      return { ok: false, error: `Your ${plan.name} plan allows ${plan.documents} documents. Delete one or upgrade to Pro.`, upgrade: plan.id === 'free' };
    }
    if (error.code === DUPLICATE) {
      return { ok: false, error: 'A document with this name already exists. Delete it first or rename the file.' };
    }
    if (error.code === NOT_FOUND) return { ok: false, error: 'Create your bot first.' };
    console.error('[documents] create_document failed', { code: error.code });
    return { ok: false, error: GENERIC_ERROR };
  }

  revalidatePath('/dashboard');
  return { ok: true, documentId: data.id, storagePath: data.storage_path };
}

export async function deleteDocument(documentId: string): Promise<DeleteDocumentResult> {
  const { supabase } = await requireUser();
  if (!z.uuid().safeParse(documentId).success) return { ok: false, error: 'Invalid document.' };

  // Delete the row first (RLS limits it to the caller's own documents; chunks cascade).
  const { data: deleted, error } = await supabase.from('documents').delete().eq('id', documentId).select('id, storage_path');
  if (error) {
    console.error('[documents] delete failed', { documentId, code: error.code });
    return { ok: false, error: GENERIC_ERROR };
  }
  const document = deleted[0];
  if (!document) return { ok: false, error: 'Document not found.' };

  // Best effort: the row is gone, so a leftover object is only orphaned storage.
  const { data: removed, error: storageError } = await supabase.storage.from('documents').remove([document.storage_path]);
  if (storageError || removed?.length !== 1) {
    console.error('[documents] storage remove failed', { documentId, code: storageError?.name ?? 'NOT_REMOVED' });
  }
  revalidatePath('/dashboard');
  return { ok: true };
}
