import path from 'node:path';
import { expect, test } from '@playwright/test';
import { signUpFresh } from './helpers';

const fixture = (name: string): string => path.join(__dirname, 'fixtures', name);

test.describe.configure({ mode: 'serial' });

test('owner sets up a bot, uploads documents, hits the quota and deletes one', async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== 'desktop', 'Calls real Gemini; run on desktop only to save quota.');
  test.setTimeout(180_000);

  await signUpFresh(page);

  // 1. Create the bot; settings persist across reload (AC-02.01.3).
  await page.getByLabel('Bot name').fill('Acme Helper');
  await page.getByLabel('Welcome message').fill('Hi! Ask me about Acme.');
  await page.getByRole('button', { name: 'Create bot' }).click();
  await expect(page.getByTestId('documents-usage')).toBeVisible();
  await page.reload();
  await expect(page.getByLabel('Bot name')).toHaveValue('Acme Helper');
  await expect(page.getByLabel('Welcome message')).toHaveValue('Hi! Ask me about Acme.');
  await expect(page.getByText('Upload documents', { exact: true })).toBeVisible();
  await expect(page.getByTestId('documents-usage')).toHaveText('0 / 2 documents · Free plan');

  const fileInput = page.getByLabel('Document file');
  const upload = page.getByRole('button', { name: 'Upload', exact: true });
  const list = page.getByRole('list', { name: 'Uploaded documents' });

  // 2. Unsupported type is rejected on the client; no row is created.
  await fileInput.setInputFiles(fixture('bad.csv'));
  await upload.click();
  await expect(page.getByText('Only PDF and TXT files are supported.')).toBeVisible();
  await expect(page.getByTestId('documents-usage')).toHaveText('0 / 2 documents · Free plan');

  // 3. Upload handbook.txt -> Processing -> Ready.
  await fileInput.setInputFiles(fixture('handbook.txt'));
  await upload.click();
  await expect(page.getByText('Processing…').first()).toBeVisible();
  await expect(list.getByRole('listitem').filter({ hasText: 'handbook.txt' }).getByText('Ready')).toBeVisible({ timeout: 90_000 });

  // 4. Same file again -> duplicate error.
  await fileInput.setInputFiles(fixture('handbook.txt'));
  await upload.click();
  await expect(page.getByRole('alert').filter({ hasText: 'already exists' })).toBeVisible();

  // 5. notes.txt -> Ready, usage 2 / 2; a third upload hits the quota.
  await fileInput.setInputFiles(fixture('notes.txt'));
  await upload.click();
  await expect(list.getByRole('listitem').filter({ hasText: 'notes.txt' }).getByText('Ready')).toBeVisible({ timeout: 90_000 });
  await expect(page.getByTestId('documents-usage')).toHaveText('2 / 2 documents · Free plan');

  await fileInput.setInputFiles({ name: 'extra.txt', mimeType: 'text/plain', buffer: Buffer.from('Extra document that should exceed the Free plan quota.') });
  await upload.click();
  await expect(page.getByRole('alert').filter({ hasText: 'Free plan allows 2 documents' })).toBeVisible();
  await expect(page.getByRole('link', { name: 'Upgrade to Pro' })).toHaveAttribute('href', '/#pricing');

  // 6. Delete notes.txt -> gone, usage 1 / 2.
  page.once('dialog', (dialog) => void dialog.accept());
  await page.getByRole('button', { name: 'Delete notes.txt' }).click();
  await expect(list.getByText('notes.txt')).toHaveCount(0);
  await expect(page.getByTestId('documents-usage')).toHaveText('1 / 2 documents · Free plan');
});
