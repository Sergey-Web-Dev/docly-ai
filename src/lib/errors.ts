export type ErrorCode =
  | 'VALIDATION' | 'UNAUTHORIZED' | 'NOT_FOUND' | 'DUPLICATE' | 'QUOTA_EXCEEDED'
  | 'RATE_LIMITED' | 'BOT_UNAVAILABLE' | 'PROVIDER_UNAVAILABLE' | 'INGESTION_FAILED' | 'INTERNAL';

const STATUS_BY_CODE: Readonly<Record<ErrorCode, number>> = {
  VALIDATION: 400, UNAUTHORIZED: 401, NOT_FOUND: 404, DUPLICATE: 409, QUOTA_EXCEEDED: 402,
  RATE_LIMITED: 429, BOT_UNAVAILABLE: 404, PROVIDER_UNAVAILABLE: 503, INGESTION_FAILED: 422, INTERNAL: 500,
};

export class AppError extends Error {
  constructor(readonly code: ErrorCode, message: string, readonly upgrade = false) {
    super(message);
    this.name = 'AppError';
  }

  get status(): number {
    return STATUS_BY_CODE[this.code];
  }
}

export interface ErrorBody {
  readonly error: { readonly code: ErrorCode; readonly message: string; readonly upgrade?: boolean };
}

export function toErrorBody(error: AppError): ErrorBody {
  return { error: { code: error.code, message: error.message, ...(error.upgrade ? { upgrade: true } : {}) } };
}

export function toErrorResponse(error: unknown): Response {
  if (error instanceof AppError) return Response.json(toErrorBody(error), { status: error.status });
  console.error('[api] unhandled error', { name: error instanceof Error ? error.name : typeof error });
  return Response.json({ error: { code: 'INTERNAL', message: 'Something went wrong. Please try again.' } } satisfies ErrorBody, { status: 500 });
}
