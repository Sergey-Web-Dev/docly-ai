import { randomUUID } from 'node:crypto';
import path from 'node:path';
import { expect, test, type BrowserContext, type FrameLocator, type Page } from '@playwright/test';
import { DEMO_ONLY_ERROR, expectNoCardDigits, expectNoExpiryOrCvc, fillCard, recordRequests, setMonthlyUsage, signUpFresh } from './helpers';

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
      body: `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>Acme Robotics</title></head><body><h1>Acme Robotics</h1><p>A third-party site.</p>${snippet}</body></html>`,
    }),
  );
  await page.goto(DEMO_URL);
}

// The widget lives in a closed shadow root, which Playwright cannot pierce. Tests that drive it through locators force
// the root open (the widget code is unchanged); tests that verify "closed" use captureShadowRoot instead.
async function openShadowRoots(context: BrowserContext): Promise<void> {
  await context.addInitScript(() => {
    const attach = Element.prototype.attachShadow;
    Element.prototype.attachShadow = function (init: ShadowRootInit): ShadowRoot {
      return attach.call(this, { ...init, mode: 'open' });
    };
  });
}

// Keeps the root closed for the page, but hands the test a reference for inspection via page.evaluate.
async function captureShadowRoot(context: BrowserContext): Promise<void> {
  await context.addInitScript(() => {
    const attach = Element.prototype.attachShadow;
    Element.prototype.attachShadow = function (init: ShadowRootInit): ShadowRoot {
      const root = attach.call(this, init);
      (window as unknown as { __doclyRoot: ShadowRoot }).__doclyRoot = root;
      return root;
    };
  });
}

function widgetSnippet(botId: string): string {
  return `<script src="http://localhost:3000/widget.js" data-bot-id="${botId}" async></script>`;
}

// The iframe hydrates after it renders (slow on a cold dev server); the textarea stays disabled and data-ready is unset until then.
async function askInFrame(frame: FrameLocator, question: string): Promise<void> {
  const input = frame.getByLabel('Your question');
  await expect(frame.locator('[data-ready="true"]').first()).toBeAttached({ timeout: 60_000 });
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

test('unknown bot on a phone: full-screen dialog, scroll lock, Esc closes and focus returns to the launcher', async ({ context, page }, testInfo) => {
  test.skip(testInfo.project.name !== 'mobile', 'Needs the small layout.');
  // The built-in context is fresh (no owner cookies) and carries the Chrome PNA flags from test.use above.
  {
    await openShadowRoots(context);
    await openDemoPage(page, widgetSnippet(randomUUID()));
    const viewport = page.viewportSize();
    expect(viewport).not.toBeNull();

    await page.getByRole('button', { name: 'Open chat' }).click();
    const panel = page.getByRole('dialog', { name: 'Chat' });
    await expect(panel).toBeVisible();
    await expect(panel).toHaveAttribute('aria-modal', 'true');
    const box = await panel.boundingBox();
    expect(box).not.toBeNull();
    expect(Math.abs(box!.x)).toBeLessThanOrEqual(1);
    expect(Math.abs(box!.y)).toBeLessThanOrEqual(1);
    expect(Math.abs(box!.width - viewport!.width)).toBeLessThanOrEqual(2);
    expect(Math.abs(box!.height - viewport!.height)).toBeLessThanOrEqual(2);
    expect(await page.evaluate(() => document.body.style.overflow)).toBe('hidden');

    const frame = page.frameLocator('iframe[title="Chat assistant"]');
    await expect(frame.getByText('This assistant is unavailable')).toBeVisible({ timeout: 30_000 });
    // The embed page registers its Esc listener after hydration; retry the key until the panel closes.
    await expect(async () => {
      await page.keyboard.press('Escape');
      await expect(panel).toBeHidden({ timeout: 1_000 });
    }).toPass({ timeout: 30_000 });
    await expect(page.getByRole('button', { name: 'Open chat' })).toBeFocused();
    expect(await page.evaluate(() => document.body.style.overflow)).toBe('');
  }
});

test('widget on desktop: launcher is keyboard reachable with a visible focus ring, root closed, frame opaque', async ({ context, page }, testInfo) => {
  test.skip(testInfo.project.name !== 'desktop', 'Desktop layout.');
  {
    await captureShadowRoot(context);
    await openDemoPage(page, widgetSnippet(randomUUID()));
    await expect.poll(() => page.evaluate(() => Boolean((window as unknown as { __doclyRoot?: ShadowRoot }).__doclyRoot))).toBe(true);

    // Closed shadow root: the host page cannot reach into the widget.
    expect(await page.evaluate(() => document.getElementById('docly-widget')?.shadowRoot ?? null)).toBeNull();

    await page.keyboard.press('Tab');
    const focus = await page.evaluate(() => {
      const root = (window as unknown as { __doclyRoot: ShadowRoot }).__doclyRoot;
      const active = root.activeElement;
      if (!active) return null;
      const style = getComputedStyle(active);
      return { label: active.getAttribute('aria-label'), visible: active.matches(':focus-visible'), outlineStyle: style.outlineStyle, outlineWidth: style.outlineWidth };
    });
    expect(focus).toEqual({ label: 'Open chat', visible: true, outlineStyle: 'solid', outlineWidth: '3px' });

    await page.keyboard.press('Enter');
    // Until the cross-origin navigation commits, the iframe still shows its same-origin about:blank; wait for it to become opaque.
    await expect
      .poll(() => page.evaluate(() => (window as unknown as { __doclyRoot: ShadowRoot }).__doclyRoot.querySelector('iframe')?.contentDocument === null), { timeout: 30_000 })
      .toBe(true);
    const ariaModal = await page.evaluate(() => (window as unknown as { __doclyRoot: ShadowRoot }).__doclyRoot.querySelector('[role="dialog"]')?.getAttribute('aria-modal') ?? null);
    expect(ariaModal).toBeNull();
  }
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
  await expect(page.getByText('Saving…')).toHaveCount(0);
  const snippet = (await page.getByTestId('embed-snippet').innerText()).trim();
  expect(snippet).toMatch(/^<script src="http:\/\/localhost:3000\/widget\.js" data-bot-id="[0-9a-f-]{36}" async><\/script>$/);

  // Visitor on another origin, in a context without the owner's cookies.
  const visitorContext = await browser.newContext();
  try {
    expect(await visitorContext.cookies()).toHaveLength(0);
    await openShadowRoots(visitorContext);
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
    // Public widget: never any file names or source chips, and the galaxy sky is behind the chat.
    await expect(frame.getByTestId('chat-sources')).toHaveCount(0);
    expect(await frame.locator('body').innerText()).not.toContain('handbook.txt');
    await expect(frame.locator('[data-testid="starfield"]')).toHaveAttribute('data-variant', 'galaxy');

    await frame.getByRole('button', { name: 'Close chat' }).click();
    await expect(panel).toBeHidden();
    await expect(visitor.getByRole('button', { name: 'Open chat' })).toBeFocused();

    // Unpublish in the owner context, the widget now says unavailable.
    await published.uncheck();
    await expect(page.getByText("Unpublished: visitors will see 'This assistant is unavailable'.")).toBeVisible();
    await expect(page.getByText('Saving…')).toHaveCount(0);
    await visitor.reload();
    await visitor.getByRole('button', { name: 'Open chat' }).click();
    await expect(visitor.frameLocator('iframe[title="Chat assistant"]').getByText('This assistant is unavailable')).toBeVisible();

    // Billing: demo checkout. Real and declined cards change nothing; a test card upgrades. No card digits are ever sent.
    const requests = recordRequests(page);
    await page.goto('/dashboard/billing');
    await expect(page.getByText(/Billing is simulated for this demo/)).toBeVisible();
    await expect(page.getByTestId('plan-badge')).toHaveText('Free plan');
    await page.getByRole('link', { name: 'Upgrade to Pro' }).click();
    await expect(page).toHaveURL(/\/dashboard\/billing\/checkout$/);
    await expect(page.getByTestId('checkout-total')).toHaveText('$19.00');
    await expect(page.getByRole('heading', { name: 'Demo checkout' })).toBeVisible();
    await expect(page.getByText('Never enter a real card — real cards are rejected.')).toBeVisible();
    for (const label of ['Card number', 'Expiry (MM/YY)', 'CVC', 'Name on card']) {
      const input = page.getByLabel(label);
      await expect(input).toHaveAttribute('autocomplete', 'off');
      await expect(input).toHaveAttribute('data-1p-ignore', /.*/);
      await expect(input).toHaveAttribute('data-lpignore', 'true');
      await expect(input).toHaveAttribute('data-bwignore', /.*/);
      await expect(input).toHaveAttribute('data-form-type', 'other');
    }
    await expect(page.getByLabel('Card number')).toBeEnabled();

    // Before hydration (client scripts blocked) the fields are disabled, so a native submit can never carry card digits.
    const unhydrated = await page.context().newPage();
    await unhydrated.route('**/_next/static/**/*.js', (route) => route.abort());
    await unhydrated.goto('/dashboard/billing/checkout');
    await expect(unhydrated.getByLabel('Card number')).toBeDisabled();
    await unhydrated.close();

    await fillCard(page, '4111 1111 1111 1111');
    await page.getByRole('button', { name: 'Pay $19.00 — demo' }).click();
    await expect(page.getByText(DEMO_ONLY_ERROR)).toBeVisible();
    await expect(page.getByLabel('Card number')).toBeFocused();
    await expect(page.getByLabel('Card number')).toHaveAttribute('aria-invalid', 'true');
    // A rejected real card is wiped immediately, not just after a later submit.
    await expect(page.getByLabel('Card number')).toHaveValue('');
    await expect(page.getByLabel('Expiry (MM/YY)')).toHaveValue('');
    await expect(page.getByLabel('CVC')).toHaveValue('');
    await expect(page.getByTestId('plan-badge')).toHaveText('Free plan');

    await fillCard(page, '4000 0000 0000 0002');
    await page.getByRole('button', { name: 'Pay $19.00 — demo' }).click();
    await expect(page.getByRole('alert').filter({ hasText: 'Your card was declined.' })).toBeVisible();
    await expect(page.getByLabel('CVC')).toHaveValue('');
    await expect(page.getByTestId('plan-badge')).toHaveText('Free plan');

    await fillCard(page, '4242 4242 4242 4242');
    await page.getByRole('button', { name: 'Pay $19.00 — demo' }).click();
    const success = page.getByTestId('checkout-success');
    await expect(success).toBeVisible({ timeout: 15_000 });
    await expect(success).toBeFocused();
    await expect(success).toContainText("Payment successful — you're on Pro");
    await expect(page.getByTestId('checkout-charge-id')).toHaveText(/^ch_demo_[0-9a-f]{18}$/);
    await expect(success).toContainText('•••• 4242');
    await expect(page.getByTestId('plan-badge')).toHaveText('Pro plan');
    expectNoCardDigits(requests.all, ['4242424242424242', '4000000000000002', '4111111111111111']);
    expectNoCardDigits(requests.console, ['4242424242424242', '4000000000000002', '4111111111111111']);
    expectNoExpiryOrCvc(requests.all);
    expectNoExpiryOrCvc(requests.console);
    expect(requests.all.some((entry) => entry.includes('tok_visa'))).toBe(true);

    await success.getByRole('link', { name: 'Back to billing' }).click();
    await expect(page).toHaveURL(/\/dashboard\/billing$/);
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
    await page.getByRole('button', { name: 'Cancel subscription (demo)' }).click();
    await page.getByRole('button', { name: 'Confirm switch to Free' }).click();
    await expect(page.getByTestId('plan-badge')).toHaveText('Free plan');
    await expect(page.getByTestId('billing-over-limit')).toContainText('You have 3 documents; the Free plan allows 2.');
    await page.goto('/dashboard');
    await expect(page.getByTestId('documents-usage')).toHaveText('3 / 2 documents · Free plan');
    await upload(page, { name: 'blocked.txt', mimeType: 'text/plain', buffer: Buffer.from('This upload must be rejected.') });
    await expect(page.getByRole('alert').filter({ hasText: 'Free plan allows 2 documents' })).toBeVisible();

    // Public quota: the owner's monthly limit applies to visitors, with a neutral message.
    await page.getByRole('switch', { name: /Published/ }).check();
    await expect(page.getByText('Unpublished:')).toHaveCount(0);
    await expect(page.getByText('Saving…')).toHaveCount(0);
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
