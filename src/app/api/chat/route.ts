import { answerQuestion } from '@/lib/chat';
import { resolveChatAccess } from '@/lib/chat-access';
import { AppError, toErrorResponse } from '@/lib/errors';
import { chatRequestSchema } from '@/lib/schemas';
import { createAdminClient } from '@/lib/supabase/admin';

const INVALID_REQUEST = 'Invalid request.';

export const runtime = 'nodejs';
export const maxDuration = 30;

export async function POST(request: Request): Promise<Response> {
  try {
    const body: unknown = await request.json().catch(() => null);
    if (typeof body !== 'object' || body === null || Array.isArray(body)) throw new AppError('VALIDATION', INVALID_REQUEST);
    const parsed = chatRequestSchema.safeParse(body);
    if (!parsed.success) throw new AppError('VALIDATION', parsed.error.issues[0]?.message ?? INVALID_REQUEST);
    const target = await resolveChatAccess(parsed.data.botId);
    const result = await answerQuestion(createAdminClient(), target, parsed.data.message);
    return Response.json(result);
  } catch (error) {
    return toErrorResponse(error);
  }
}
