import { randomUUID } from 'node:crypto';
import path from 'node:path';
import { expect, test, type FrameLocator, type Page } from '@playwright/test';
import { setMonthlyUsage, signUpFresh } from './helpers';

const fixture = (name: string): string => path.join(__dirname, 'fixtures', name);
const DEMO_URL = 'http://acme-demo.test/';
const ANSWER_TIMEOUT = 30_000;

test.describe.configure({ mode: 'serial', retries: 1 });

// The fake public origin (acme-demo.test) loads the widget from localhost. Chrome blocks public -> loopback requests
// from insecure pages (Private Network Access), which does not exist in production where both origins are public.
test.use({
  launchOptions: {
    args: ['--disable-features=BlockInsecurePrivateNetworkRequests,PrivateNetworkAccessSendPreflights,PrivateNetworkAccessRespectPreflightResults,LocalNetworkAccessChecks'],
  },
});

async function openDemoPage(page: Page, snippet: string): Promise<void> {
  await page.route('http://acme-demo.test/**', (route) =>
    route.fulfill({
      contentType: 'text/html',
      body: `<!doctype html><html lang="en"><head><meta charset="utf-8"><title>Acme Robotics</title></head><body><h1>Acme Robotics</h1><p>A third-party site.</p>${snippet}</body></html>`,
    }),
  );
  await page.goto(DEMO_URL);
}

// The iframe hydrates after it renders (slow on a cold dev server); typing before that is lost, so wait for React first.
async function askInFrame(frame: FrameLocator, question: string): Promise<void> {
  const input = frame.getByLabel('Your question');
  await expect.poll(() => input.evaluate((el) => Object.keys(el).some((key) => key.startsWith('__reactProps'))), { timeout: 60_000 }).toBe(true);
  await input.fill(question);
  await frame.getByRole('button', { name: 'Send' }).click();
}

async function upload(page: Page, file: string | { name: string; mimeType: string; buffer: Buffer }): Promise<void> {
  await page.getByLabel('Document file').setInputFiles(file);
  await page.getByRole('button', { name: 'Upload', exact: true }).click();
}

test('security headers allow framing only for the embed route', async ({ request }, testInfo) => {
  test.skip(testInfo.project.name !== 'desktop', 'Header checks do not depend on the viewport.');
  const dashboard = await request.get('/dashboard', { maxRedirects: 0 });
  expect(dashboard.headers()['x-frame-options']).toBe('DENY');
  expect(dashboard.headers()['content-security-policy']).toContain("frame-ancestors 'none'");

  const embed = await request.get(`/embed/${randomUUID()}`);
  expect(embed.headers()['content-security-policy']).toContain('frame-ancestors *');
  expect(embed.headers()['x-frame-options']).toBeUndefined();
});

test('an unknown bot shows the unavailable card', async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== 'desktop', 'Viewport independent.');
  await page.goto(`/embed/${randomUUID()}`);
  await expect(page.getByText('This assistant is unavailable')).toBeVisible();
});

test('widget on another origin, unpublish, demo billing and public quota', async ({ page, browser }, testInfo) => {
  test.skip(testInfo.project.name !== 'desktop', 'Calls real Gemini; run on desktop only to save quota.');
  test.setTimeout(300_000);

  const email = await signUpFresh(page);
  await page.getByLabel('Bot name').fill('Acme Helper');
  await page.getByLabel('Welcome message').fill('Hi! Ask me about Acme.');
  await page.getByRole('button', { name: 'Create bot' }).click();
  await expect(page.getByTestId('documents-usage')).toBeVisible();

  await upload(page, fixture('handbook.txt'));
  const list = page.getByRole('list', { name: 'Uploaded documents' });
  await expect(list.getByRole('listitem').filter({ hasText: 'handbook.txt' }).getByText('Ready')).toBeVisible({ timeout: 90_000 });

  // Publish and copy the snippet.
  await expect(page.getByText("Unpublished: visitors will see 'This assistant is unavailable'.")).toBeVisible();
  const published = page.getByRole('switch', { name: /Published/ });
  await published.check();
  await expect(published).toBeChecked();
  await expect(page.getByText('Unpublished:')).toHaveCount(0);
  const snippet = (await page.getByTestId('embed-snippet').innerText()).trim();
  expect(snippet).toMatch(/^<script src="http:\/\/localhost:3000\/widget\.js" data-bot-id="[0-9a-f-]{36}" async><\/script>$/);

  // Visitor on another origin, in a context without the owner's cookies.
  const visitorContext = await browser.newContext();
  try {
    expect(await visitorContext.cookies()).toHaveLength(0);
    const visitor = await visitorContext.newPage();
    await openDemoPage(visitor, snippet);

    const launcher = visitor.getByRole('button', { name: 'Open chat' });
    await expect(launcher).toBeVisible();
    await expect(launcher).toHaveAttribute('aria-expanded', 'false');
    await launcher.click();
    const panel = visitor.getByRole('dialog', { name: 'Chat' });
    await expect(panel).toBeVisible();

    const frame = visitor.frameLocator('iframe[title="Chat assistant"]');
    await expect(frame.getByText('Hi! Ask me about Acme.')).toBeVisible();
    await askInFrame(frame, 'How many vacation days do new hires get?');
    const assistant = frame.locator('li[data-role="assistant"]');
    await expect(assistant).toHaveCount(2, { timeout: ANSWER_TIMEOUT });
    await expect(frame.getByTestId('typing-indicator')).toHaveCount(0, { timeout: ANSWER_TIMEOUT });
    const answer = (await assistant.last().innerText()).trim();
    console.log(`[widget-e2e] Q: How many vacation days do new hires get? -> A: ${answer}`);
    expect(answer).toContain('20');

    await frame.getByRole('button', { name: 'Close chat' }).click();
    await expect(panel).toBeHidden();
    await expect(visitor.getByRole('button', { name: 'Open chat' })).toBeFocused();

    // Unpublish in the owner context, the widget now says unavailable.
    await published.uncheck();
    await expect(page.getByText("Unpublished: visitors will see 'This assistant is unavailable'.")).toBeVisible();
    await visitor.reload();
    await visitor.getByRole('button', { name: 'Open chat' }).click();
    await expect(visitor.frameLocator('iframe[title="Chat assistant"]').getByText('This assistant is unavailable')).toBeVisible();

    // Billing: demo upgrade.
    await page.goto('/dashboard/billing');
    await expect(page.getByText('Billing is simulated for this demo. No payment details are collected and no money is charged.')).toBeVisible();
    await expect(page.getByTestId('plan-badge')).toHaveText('Free plan');
    await page.getByRole('button', { name: 'Demo upgrade — no payment' }).click();
    await expect(page.getByText('Switch to Pro? This is a demo — nothing is charged.')).toBeVisible();
    await page.getByRole('button', { name: 'Confirm' }).click();
    await expect(page.getByTestId('plan-badge')).toHaveText('Pro plan');
    await expect(page.getByTestId('billing-documents')).toHaveText('1 / 10');
    await expect(page.getByRole('button', { name: 'Current plan' })).toBeDisabled();

    await page.goto('/dashboard');
    await upload(page, fixture('notes.txt'));
    await expect(list.getByRole('listitem').filter({ hasText: 'notes.txt' }).getByText('Ready')).toBeVisible({ timeout: 90_000 });
    await upload(page, { name: 'extra.txt', mimeType: 'text/plain', buffer: Buffer.from('Extra document: the Acme cafeteria opens at 8am and closes at 3pm on weekdays.') });
    await expect(list.getByRole('listitem').filter({ hasText: 'extra.txt' }).getByText('Ready')).toBeVisible({ timeout: 90_000 });
    await expect(page.getByTestId('documents-usage')).toHaveText('3 / 10 documents · Pro plan');

    // Billing: downgrade keeps documents, blocks new uploads.
    await page.goto('/dashboard/billing');
    await page.getByRole('button', { name: 'Downgrade to Free' }).click();
    await page.getByRole('button', { name: 'Confirm' }).click();
    await expect(page.getByTestId('plan-badge')).toHaveText('Free plan');
    await expect(page.getByTestId('billing-over-limit')).toContainText('You have 3 documents; the Free plan allows 2.');
    await page.goto('/dashboard');
    await expect(page.getByTestId('documents-usage')).toHaveText('3 / 2 documents · Free plan');
    await upload(page, { name: 'blocked.txt', mimeType: 'text/plain', buffer: Buffer.from('This upload must be rejected.') });
    await expect(page.getByRole('alert').filter({ hasText: 'Free plan allows 2 documents' })).toBeVisible();

    // Public quota: the owner's monthly limit applies to visitors, with a neutral message.
    await page.getByRole('switch', { name: /Published/ }).check();
    await expect(page.getByText('Unpublished:')).toHaveCount(0);
    await setMonthlyUsage(email, 30);
    await visitor.reload();
    await visitor.getByRole('button', { name: 'Open chat' }).click();
    const quotaFrame = visitor.frameLocator('iframe[title="Chat assistant"]');
    await askInFrame(quotaFrame, 'How many vacation days do new hires get?');
    await expect(quotaFrame.getByText('temporarily unavailable')).toBeVisible({ timeout: ANSWER_TIMEOUT });
    await expect(quotaFrame.getByRole('link', { name: /Upgrade/ })).toHaveCount(0);
  } finally {
    await visitorContext.close();
  }
});
