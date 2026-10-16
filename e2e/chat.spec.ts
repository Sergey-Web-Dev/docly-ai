import path from 'node:path';
import { expect, test, type Page } from '@playwright/test';
import { setMonthlyUsage, signUpFresh } from './helpers';

const NOT_FOUND = "I don't know based on these documents.";
const ANSWER_TIMEOUT = 30_000;

test.describe.configure({ mode: 'serial', retries: 1 });

async function ask(page: Page, question: string): Promise<void> {
  await page.getByLabel('Your question').fill(question);
  await page.getByRole('button', { name: 'Send' }).click();
}

async function lastAssistantText(page: Page): Promise<string> {
  return (await page.locator('li[data-role="assistant"]').last().innerText()).trim();
}

test('owner chats with grounded answers, gets not-found, and hits the message quota', async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== 'desktop', 'Calls real Gemini; run on desktop only to save quota.');
  test.setTimeout(240_000);

  const email = await signUpFresh(page);

  // 1. Set up bot + Ready document, open playground.
  await page.getByLabel('Bot name').fill('Acme Helper');
  await page.getByLabel('Welcome message').fill('Hi! Ask me about Acme.');
  await page.getByRole('button', { name: 'Create bot' }).click();
  await expect(page.getByTestId('documents-usage')).toBeVisible();

  await page.goto('/dashboard/chat');
  await expect(page.getByText('Upload at least one document to get answers')).toBeVisible();
  await page.goto('/dashboard');

  await page.getByLabel('Document file').setInputFiles(path.join(__dirname, 'fixtures', 'handbook.txt'));
  await page.getByRole('button', { name: 'Upload', exact: true }).click();
  const list = page.getByRole('list', { name: 'Uploaded documents' });
  await expect(list.getByRole('listitem').filter({ hasText: 'handbook.txt' }).getByText('Ready')).toBeVisible({ timeout: 90_000 });

  await page.getByRole('link', { name: 'Open chat playground' }).click();
  await expect(page).toHaveURL(/\/dashboard\/chat$/);
  await expect(page.getByText('Hi! Ask me about Acme.')).toBeVisible();
  await expect(page.getByText('Upload at least one document to get answers')).toHaveCount(0);
  await expect(page.getByTestId('chat-usage')).toHaveText('0 / 30 messages this month');

  // 5. Validation: empty input disabled, 1001 chars blocked.
  const send = page.getByRole('button', { name: 'Send' });
  await expect(send).toBeDisabled();
  await page.getByLabel('Your question').fill('x'.repeat(1001));
  await expect(send).toBeDisabled();
  await expect(page.getByText('Questions can be up to 1000 characters.')).toBeVisible();
  await page.getByLabel('Your question').fill('');

  // 2. Known questions (grounded).
  const known: ReadonlyArray<readonly [string, string]> = [
    ['How many vacation days do new hires get?', '20'],
    ['Which days can employees work remotely?', 'Tuesday'],
    ['What is the support email?', 'help@acme.test'],
  ];
  for (const [index, [question, expected]] of known.entries()) {
    await ask(page, question);
    await expect(page.locator('li[data-role="user"]').last()).toHaveText(question);
    await expect(page.getByTestId('typing-indicator')).toHaveCount(0, { timeout: ANSWER_TIMEOUT });
    await expect(page.locator('li[data-role="assistant"]')).toHaveCount(index + 2, { timeout: ANSWER_TIMEOUT });
    const text = await lastAssistantText(page);
    console.log(`[chat-e2e] Q: ${question} -> A: ${text}`);
    expect(text).toContain(expected);
  }

  // 3. Unrelated question -> exact not-found sentence.
  await ask(page, 'What is the capital of Australia?');
  await expect(page.getByTestId('typing-indicator')).toHaveCount(0, { timeout: ANSWER_TIMEOUT });
  await expect(page.locator('li[data-role="assistant"]')).toHaveCount(5, { timeout: ANSWER_TIMEOUT });
  const notFound = await lastAssistantText(page);
  console.log(`[chat-e2e] Q: unrelated -> A: ${notFound}`);
  expect(notFound).toBe(NOT_FOUND);

  // 4. Usage counter persists across reload.
  const usageBefore = (await page.getByTestId('chat-usage').innerText()).trim();
  expect(usageBefore).toMatch(/^[3-4] \/ 30 messages this month$/);
  await page.reload();
  await expect(page.getByTestId('chat-usage')).toHaveText(usageBefore);

  // 6. Quota: counter at the limit -> quota message with upgrade link.
  await setMonthlyUsage(email, 30);
  await ask(page, 'How many vacation days do new hires get?');
  await expect(page.getByText("You've used all 30 messages this month on the Free plan.")).toBeVisible({ timeout: ANSWER_TIMEOUT });
  await expect(page.getByRole('link', { name: 'Upgrade to Pro' })).toHaveAttribute('href', '/dashboard/billing');
});
