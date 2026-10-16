import { describe, expect, it, vi } from 'vitest';
import { AppError, toErrorResponse } from '@/lib/errors';

describe('toErrorResponse', () => {
  it('should map an AppError to its status and JSON body', async () => {
    const response = toErrorResponse(new AppError('QUOTA_EXCEEDED', 'Free plan allows 2 documents.', true));
    expect(response.status).toBe(402);
    expect(await response.json()).toEqual({ error: { code: 'QUOTA_EXCEEDED', message: 'Free plan allows 2 documents.', upgrade: true } });
  });

  it('should hide internal details when error is unknown', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const response = toErrorResponse(new Error('db password leaked'));
    expect(response.status).toBe(500);
    expect(await response.json()).toEqual({ error: { code: 'INTERNAL', message: 'Something went wrong. Please try again.' } });
  });
});
