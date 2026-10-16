import { readFileSync } from 'node:fs';
import path from 'node:path';
import { expect, test, type Page } from '@playwright/test';

// Generates docs/walkthrough/*.png for docs/walkthrough.md. Run with: WALKTHROUGH=1 npx playwright test e2e/walkthrough.spec.ts --project=desktop
const OUT_DIR = path.join(__dirname, '..', 'docs', 'walkthrough');
const DEMO_HOST = 'http://acme-demo.test';
const ANSWER_TIMEOUT = 30_000;

test.use({
  viewport: { width: 1280, height: 800 },
  launchOptions: {
    // The fake public origin loads the widget from localhost; Chrome's Private Network Access would block that (not an issue in production).
    args: ['--disable-features=BlockInsecurePrivateNetworkRequests,PrivateNetworkAccessSendPreflights,PrivateNetworkAccessRespectPreflightResults,LocalNetworkAccessChecks'],
  },
});

async function shot(page: Page, name: string): Promise<void> {
  await page.screenshot({ path: path.join(OUT_DIR, `${name}.png`) });
}

test('record the illustrated walkthrough', async ({ page, browser }, testInfo) => {
  test.skip(process.env.WALKTHROUGH !== '1', 'Set WALKTHROUGH=1 to regenerate docs/walkthrough/*.png.');
  test.skip(testInfo.project.name !== 'desktop', 'Desktop only.');
  test.setTimeout(300_000);

  // 01 Landing
  await page.goto('/');
  await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
  await shot(page, '01-landing');

  // 02 Sign up (form filled)
  const email = `walkthrough-${Date.now()}@example.com`;
  await page.goto('/signup');
  await page.getByLabel('Email').fill(email);
  await page.getByLabel('Password').fill('Password123!');
  await shot(page, '02-sign-up');
  await page.getByRole('button', { name: 'Create account' }).click();
  await expect(page).toHaveURL(/\/dashboard$/);

  // 03 Create the bot
  await page.getByLabel('Bot name').fill('Acme Helper');
  await page.getByLabel('Welcome message').fill('Hi! Ask me about Acme.');
  await shot(page, '03-create-bot');
  await page.getByRole('button', { name: 'Create bot' }).click();
  await expect(page.getByTestId('documents-usage')).toBeVisible();

  // 04 Upload -> Ready
  await page.getByLabel('Document file').setInputFiles(path.join(__dirname, 'fixtures', 'handbook.txt'));
  await page.getByRole('button', { name: 'Upload', exact: true }).click();
  const list = page.getByRole('list', { name: 'Uploaded documents' });
  await expect(list.getByRole('listitem').filter({ hasText: 'handbook.txt' }).getByText('Ready')).toBeVisible({ timeout: 90_000 });
  await shot(page, '04-document-ready');

  // 05 Chat playground answer
  await page.goto('/dashboard/chat');
  await page.getByLabel('Your question').fill('How many vacation days do new hires get?');
  await page.getByRole('button', { name: 'Send' }).click();
  await expect(page.locator('li[data-role="assistant"]')).toHaveCount(2, { timeout: ANSWER_TIMEOUT });
  await expect(page.getByTestId('typing-indicator')).toHaveCount(0, { timeout: ANSWER_TIMEOUT });
  await shot(page, '05-chat-answer');

  // 06 Publish + embed snippet
  await page.goto('/dashboard');
  const published = page.getByRole('switch', { name: /Published/ });
  await published.check();
  await expect(published).toBeChecked();
  await expect(page.getByText('Unpublished:')).toHaveCount(0);
  await expect(page.getByText('Saving…')).toHaveCount(0);
  await page.getByRole('heading', { name: 'Embed on your website' }).scrollIntoViewIfNeeded();
  await shot(page, '06-embed-snippet');
  const snippet = (await page.getByTestId('embed-snippet').innerText()).trim();
  const botId = /data-bot-id="([0-9a-f-]{36})"/.exec(snippet)?.[1];
  expect(botId).toBeTruthy();

  // 07 Demo site on another origin, no owner cookies, widget open and answering
  const visitorContext = await browser.newContext({ viewport: { width: 1280, height: 800 } });
  try {
    const visitor = await visitorContext.newPage();
    const demoHtml = readFileSync(path.join(__dirname, '..', 'demo-site', 'index.html'), 'utf8');
    await visitor.route(`${DEMO_HOST}/**`, (route) => route.fulfill({ contentType: 'text/html', body: demoHtml }));
    await visitor.goto(`${DEMO_HOST}/?app=${encodeURIComponent('http://localhost:3000')}&bot=${botId}`);
    await visitor.getByRole('button', { name: 'Open chat' }).click();
    const frame = visitor.frameLocator('iframe[title="Chat assistant"]');
    await expect(frame.getByText('Hi! Ask me about Acme.')).toBeVisible();
    const input = frame.getByLabel('Your question');
    await expect.poll(() => input.evaluate((el) => Object.keys(el).some((key) => key.startsWith('__reactProps'))), { timeout: 60_000 }).toBe(true);
    await input.fill('How many vacation days do new hires get?');
    await frame.getByRole('button', { name: 'Send' }).click();
    await expect(frame.locator('li[data-role="assistant"]')).toHaveCount(2, { timeout: ANSWER_TIMEOUT });
    await expect(frame.getByTestId('typing-indicator')).toHaveCount(0, { timeout: ANSWER_TIMEOUT });
    await shot(visitor, '07-demo-site-widget');
  } finally {
    await visitorContext.close();
  }

  // 08 Billing, 09 after the demo upgrade
  await page.goto('/dashboard/billing');
  await expect(page.getByRole('button', { name: 'Demo upgrade — no payment' })).toBeVisible();
  await shot(page, '08-billing');
  await page.getByRole('button', { name: 'Demo upgrade — no payment' }).click();
  await page.getByRole('button', { name: 'Confirm' }).click();
  await expect(page.getByTestId('plan-badge')).toHaveText('Pro plan');
  await expect(page.getByTestId('billing-documents')).toHaveText('1 / 10');
  await shot(page, '09-after-upgrade');
});
