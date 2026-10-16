# Epic 01 — Foundation Implementation Plan

**Task:** TASK-001 · **Epic:** `docs/epics/epic-01-foundation.md`

> **For Claude:** Implement with `coder` (lib, SQL, proxy, actions) and `coder-frontend` (pages/components). Steps marked **[orchestrator]** use Supabase MCP and are run by the main session, not the subagent.

**Goal:** Scaffolded Next.js 16 app with Supabase email/password auth, `profiles` table with RLS, shared plan config, landing page with pricing, and protected dashboard shell.

**Architecture:** `docs/architecture.md` §2, §3 (`profiles`), §4 (RLS), §5.1. Plain functions in `src/lib`, Server Actions for auth, `src/proxy.ts` for session refresh + redirects.

**Tech Stack:** Next.js 16, TS, Tailwind v4, shadcn/ui, `@supabase/ssr`, `@supabase/supabase-js`, Zod 4, Vitest, Playwright.

**Environment facts**
- Supabase cloud project **`docly-ai`**, ref `vmbpufluzynyygoukkyc`, URL `https://vmbpufluzynyygoukkyc.supabase.co` (no local Docker stack, no Supabase CLI).
- Migrations live in `supabase/migrations/*.sql` (source of truth) and are applied with Supabase MCP `apply_migration`.
- `.env.local` holds `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` (filled), `SUPABASE_SECRET_KEY` (**user fills** from Dashboard → Project Settings → API Keys; needed only by integration tests in this epic).
- **User step:** Dashboard → Authentication → Sign In / Providers → Email → turn **off** "Confirm email" (required for the no-setup demo journey and E2E).

---

### Task 1: Scaffold Next.js app and git

**Files:** Create: whole scaffold at repo root (`package.json`, `src/app/*`, `tsconfig.json`, `eslint.config.mjs`, `.gitignore`, …)

**Step 1: Generate into a temp folder (repo root is not empty)**

```bash
npx create-next-app@latest /private/tmp/docly-scaffold --ts --tailwind --eslint --app --src-dir --import-alias "@/*" --use-npm --yes
rsync -a --exclude .git --exclude node_modules /private/tmp/docly-scaffold/ ./
npm install
```

**Step 2: Allow `.env.example` in git** — append to `.gitignore`:

```gitignore
# env
.env*
!.env.example
# playwright
/test-results/
/playwright-report/
```

**Step 3: Scripts** — set in `package.json` `"scripts"`:

```json
{
  "dev": "next dev",
  "build": "next build",
  "start": "next start",
  "lint": "eslint",
  "typecheck": "tsc --noEmit",
  "test": "vitest run",
  "test:integration": "vitest run --config vitest.integration.config.ts",
  "test:e2e": "playwright test"
}
```

**Step 4: Verify** — `npm run lint && npm run typecheck && npm run build` → all succeed.

**Step 5: Commit**

```bash
git init -b main
git add -A
git commit -m "chore: scaffold Next.js 16 app"
```

---

### Task 2: Dependencies, shadcn/ui, Vitest, Playwright

**Files:** Create: `vitest.config.ts`, `vitest.integration.config.ts`, `playwright.config.ts`, `components.json`, `src/components/ui/*`

**Step 1: Install**

```bash
npm install @supabase/ssr @supabase/supabase-js zod server-only lucide-react
npm install -D vitest vite-tsconfig-paths @playwright/test
npx playwright install chromium
npx shadcn@latest init -d
npx shadcn@latest add button card input label badge
```

**Step 2: `vitest.config.ts`**

```ts
import { defineConfig } from 'vitest/config';
import tsconfigPaths from 'vite-tsconfig-paths';

export default defineConfig({
  plugins: [tsconfigPaths()],
  test: {
    include: ['src/**/*.test.ts'],
    environment: 'node',
  },
});
```

**Step 3: `vitest.integration.config.ts`** (loads `.env.local` for the cloud project)

```ts
import { loadEnv } from 'vite';
import { defineConfig } from 'vitest/config';
import tsconfigPaths from 'vite-tsconfig-paths';

export default defineConfig({
  plugins: [tsconfigPaths()],
  test: {
    include: ['tests/integration/**/*.test.ts'],
    environment: 'node',
    env: loadEnv('local', process.cwd(), ''),
    testTimeout: 30_000,
    hookTimeout: 30_000,
    fileParallelism: false,
  },
});
```

**Step 4: `playwright.config.ts`**

```ts
import { defineConfig, devices } from '@playwright/test';

export default defineConfig({
  testDir: './e2e',
  timeout: 60_000,
  use: { baseURL: 'http://localhost:3000', trace: 'on-first-retry' },
  projects: [
    { name: 'desktop', use: { ...devices['Desktop Chrome'] } },
    { name: 'mobile', use: { ...devices['Pixel 7'] } },
  ],
  webServer: {
    command: 'npm run dev',
    url: 'http://localhost:3000',
    reuseExistingServer: true,
    timeout: 120_000,
  },
});
```

**Step 5: Verify** — `npm run typecheck` passes.

**Step 6: Commit** — `git add -A && git commit -m "chore: add supabase, zod, shadcn, vitest, playwright"`

---

### Task 3: Plan configuration (`src/lib/plans.ts`) — TDD

**Files:** Create: `src/lib/plans.ts` · Test: `src/lib/plans.test.ts`

**Step 1: Failing test**

```ts
import { describe, expect, it } from 'vitest';
import { getPlan, PLANS } from '@/lib/plans';

describe('plans', () => {
  it('should define Free limits from the SDD when reading free plan', () => {
    expect(PLANS.free).toMatchObject({ priceUsd: 0, bots: 1, documents: 2, messagesPerMonth: 30, hasWidget: true, hasBranding: false });
  });

  it('should define Pro limits from the SDD when reading pro plan', () => {
    expect(PLANS.pro).toMatchObject({ priceUsd: 19, bots: 1, documents: 10, messagesPerMonth: 300, hasWidget: true, hasBranding: true });
  });

  it('should return pro when plan id is pro', () => {
    expect(getPlan('pro').id).toBe('pro');
  });

  it('should fall back to free when plan id is unknown or missing', () => {
    expect(getPlan('enterprise').id).toBe('free');
    expect(getPlan(null).id).toBe('free');
  });
});
```

**Step 2:** `npm test -- src/lib/plans.test.ts` → FAIL (module not found).

**Step 3: Implement**

```ts
export type PlanId = 'free' | 'pro';

export interface Plan {
  readonly id: PlanId;
  readonly name: string;
  readonly priceUsd: number;
  readonly bots: number;
  readonly documents: number;
  readonly messagesPerMonth: number;
  readonly hasWidget: boolean;
  readonly hasBranding: boolean;
}

export const PLANS: Readonly<Record<PlanId, Plan>> = {
  free: { id: 'free', name: 'Free', priceUsd: 0, bots: 1, documents: 2, messagesPerMonth: 30, hasWidget: true, hasBranding: false },
  pro: { id: 'pro', name: 'Pro', priceUsd: 19, bots: 1, documents: 10, messagesPerMonth: 300, hasWidget: true, hasBranding: true },
};

export function getPlan(planId: string | null | undefined): Plan {
  return planId === 'pro' ? PLANS.pro : PLANS.free;
}
```

**Step 4:** `npm test -- src/lib/plans.test.ts` → PASS.

**Step 5: Commit** — `git add src/lib/plans* && git commit -m "feat(plans): add shared Free/Pro plan configuration"`

---

### Task 4: Credentials validation (`src/lib/schemas.ts`) — TDD

**Files:** Create: `src/lib/schemas.ts` · Test: `src/lib/schemas.test.ts`

**Step 1: Failing test**

```ts
import { describe, expect, it } from 'vitest';
import { parseCredentials } from '@/lib/schemas';

function form(email: string, password: string): FormData {
  const data = new FormData();
  data.set('email', email);
  data.set('password', password);
  return data;
}

describe('parseCredentials', () => {
  it('should return trimmed credentials when input is valid', () => {
    expect(parseCredentials(form('  owner@example.com ', 'secret123'))).toEqual({ ok: true, email: 'owner@example.com', password: 'secret123' });
  });

  it('should return an error and keep the email when email is invalid', () => {
    expect(parseCredentials(form('nope', 'secret123'))).toEqual({ ok: false, email: 'nope', error: 'Enter a valid email address.' });
  });

  it('should return an error when password is shorter than 8 characters', () => {
    expect(parseCredentials(form('owner@example.com', 'short'))).toMatchObject({ ok: false, error: 'Password must be at least 8 characters.' });
  });
});
```

**Step 2:** `npm test -- src/lib/schemas.test.ts` → FAIL.

**Step 3: Implement**

```ts
import { z } from 'zod';

const credentialsSchema = z.object({
  email: z.email('Enter a valid email address.'),
  password: z.string().min(8, 'Password must be at least 8 characters.').max(72, 'Password is too long.'),
});

export type CredentialsResult =
  | { readonly ok: true; readonly email: string; readonly password: string }
  | { readonly ok: false; readonly email: string; readonly error: string };

export function parseCredentials(formData: FormData): CredentialsResult {
  const email = String(formData.get('email') ?? '').trim();
  const password = String(formData.get('password') ?? '');
  const parsed = credentialsSchema.safeParse({ email, password });
  if (!parsed.success) {
    return { ok: false, email, error: parsed.error.issues[0]?.message ?? 'Invalid input.' };
  }
  return { ok: true, ...parsed.data };
}
```

**Step 4:** PASS. **Step 5:** `git commit -m "feat(auth): add credentials validation"`

---

### Task 5: `profiles` migration + RLS **[orchestrator applies]**

**Files:** Create: `supabase/migrations/20261016000001_profiles.sql`

**Step 1: Write SQL**

```sql
create extension if not exists vector with schema extensions;

create table public.profiles (
  id uuid primary key references auth.users (id) on delete cascade,
  plan text not null default 'free' check (plan in ('free', 'pro')),
  created_at timestamptz not null default now()
);

alter table public.profiles enable row level security;

create policy "profiles: owner can read own row"
  on public.profiles for select to authenticated
  using ((select auth.uid()) = id);

revoke insert, update, delete on public.profiles from anon, authenticated;

create function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.profiles (id) values (new.id);
  return new;
end;
$$;

revoke execute on function public.handle_new_user() from public, anon, authenticated;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();
```

**Step 2 [orchestrator]:** Supabase MCP `apply_migration(project_id="vmbpufluzynyygoukkyc", name="profiles", query=<file>)`, then `get_advisors(type="security")` → no RLS warnings for `profiles`.

**Step 3 [orchestrator]:** MCP `generate_typescript_types` → save output to `src/lib/database.types.ts`.

**Step 4: Commit** — `git add supabase src/lib/database.types.ts && git commit -m "feat(db): add profiles table with RLS and signup trigger"`

---

### Task 6: Env + Supabase clients

**Files:** Create: `src/lib/env.ts`, `src/lib/supabase/server.ts`, `src/lib/supabase/client.ts`, `.env.example`

**`src/lib/env.ts`** (literal `process.env.NEXT_PUBLIC_*` access so Next inlines them)

```ts
function required(value: string | undefined, name: string): string {
  if (!value) throw new Error(`Missing environment variable: ${name}`);
  return value;
}

export const publicEnv = {
  supabaseUrl: required(process.env.NEXT_PUBLIC_SUPABASE_URL, 'NEXT_PUBLIC_SUPABASE_URL'),
  supabasePublishableKey: required(process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY, 'NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY'),
} as const;
```

**`src/lib/supabase/server.ts`**

```ts
import 'server-only';
import { cookies } from 'next/headers';
import { createServerClient } from '@supabase/ssr';
import type { SupabaseClient } from '@supabase/supabase-js';
import type { Database } from '@/lib/database.types';
import { publicEnv } from '@/lib/env';

export async function createClient(): Promise<SupabaseClient<Database>> {
  const cookieStore = await cookies();
  return createServerClient<Database>(publicEnv.supabaseUrl, publicEnv.supabasePublishableKey, {
    cookies: {
      getAll() {
        return cookieStore.getAll();
      },
      setAll(cookiesToSet) {
        try {
          cookiesToSet.forEach(({ name, value, options }) => cookieStore.set(name, value, options));
        } catch {
          // Called from a Server Component where cookies are read-only; src/proxy.ts refreshes the session.
        }
      },
    },
  });
}
```

**`src/lib/supabase/client.ts`**

```ts
import { createBrowserClient } from '@supabase/ssr';
import type { SupabaseClient } from '@supabase/supabase-js';
import type { Database } from '@/lib/database.types';
import { publicEnv } from '@/lib/env';

export function createClient(): SupabaseClient<Database> {
  return createBrowserClient<Database>(publicEnv.supabaseUrl, publicEnv.supabasePublishableKey);
}
```

**`.env.example`**

```dotenv
NEXT_PUBLIC_SUPABASE_URL=https://your-project-ref.supabase.co
NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY=sb_publishable_xxx
SUPABASE_SECRET_KEY=sb_secret_xxx
NEXT_PUBLIC_APP_URL=http://localhost:3000
# Added in later epics: GEMINI_API_KEY, GEMINI_CHAT_MODEL, GEMINI_EMBEDDING_MODEL, RATE_LIMIT_SALT
```

**Verify:** `npm run typecheck`. **Commit:** `git commit -m "feat(supabase): add env and server/browser clients"`

---

### Task 7: Proxy (session refresh + route guard)

**Files:** Create: `src/proxy.ts`

```ts
import { NextResponse, type NextRequest } from 'next/server';
import { createServerClient } from '@supabase/ssr';
import { publicEnv } from '@/lib/env';

const AUTH_PAGES = ['/login', '/signup'];

export async function proxy(request: NextRequest): Promise<NextResponse> {
  let response = NextResponse.next({ request });

  const supabase = createServerClient(publicEnv.supabaseUrl, publicEnv.supabasePublishableKey, {
    cookies: {
      getAll() {
        return request.cookies.getAll();
      },
      setAll(cookiesToSet, headers?: Record<string, string>) {
        cookiesToSet.forEach(({ name, value }) => request.cookies.set(name, value));
        response = NextResponse.next({ request });
        cookiesToSet.forEach(({ name, value, options }) => response.cookies.set(name, value, options));
        Object.entries(headers ?? {}).forEach(([key, value]) => response.headers.set(key, value));
      },
    },
  });

  const { data } = await supabase.auth.getClaims();
  const isSignedIn = Boolean(data?.claims);
  const { pathname } = request.nextUrl;

  if (!isSignedIn && pathname.startsWith('/dashboard')) return redirectWithCookies(request, '/login', response);
  if (isSignedIn && AUTH_PAGES.includes(pathname)) return redirectWithCookies(request, '/dashboard', response);
  return response;
}

function redirectWithCookies(request: NextRequest, path: string, from: NextResponse): NextResponse {
  const redirect = NextResponse.redirect(new URL(path, request.url));
  from.cookies.getAll().forEach((cookie) => redirect.cookies.set(cookie));
  return redirect;
}

export const config = {
  matcher: ['/((?!_next/static|_next/image|favicon.ico|widget.js|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)'],
};
```

**Verify:** `npm run typecheck && npm run build`. **Commit:** `git commit -m "feat(auth): add proxy session refresh and dashboard guard"`

---

### Task 8: Auth Server Actions and pages

**Files:** Create: `src/app/(auth)/actions.ts`, `src/components/auth-form.tsx`, `src/app/(auth)/login/page.tsx`, `src/app/(auth)/signup/page.tsx`

**`src/app/(auth)/actions.ts`**

```ts
'use server';

import { redirect } from 'next/navigation';
import { parseCredentials } from '@/lib/schemas';
import { createClient } from '@/lib/supabase/server';

export interface AuthFormState {
  readonly error: string | null;
  readonly email: string;
}

export async function signUp(_prev: AuthFormState, formData: FormData): Promise<AuthFormState> {
  const input = parseCredentials(formData);
  if (!input.ok) return { error: input.error, email: input.email };

  const supabase = await createClient();
  const { data, error } = await supabase.auth.signUp({ email: input.email, password: input.password });
  if (error) return { error: toFriendlyAuthError(error.message), email: input.email };
  if (!data.session) return { error: 'Account created. Please confirm your email, then sign in.', email: input.email };
  redirect('/dashboard');
}

export async function signIn(_prev: AuthFormState, formData: FormData): Promise<AuthFormState> {
  const input = parseCredentials(formData);
  if (!input.ok) return { error: input.error, email: input.email };

  const supabase = await createClient();
  const { error } = await supabase.auth.signInWithPassword({ email: input.email, password: input.password });
  if (error) return { error: 'Invalid email or password.', email: input.email };
  redirect('/dashboard');
}

export async function signOut(): Promise<void> {
  const supabase = await createClient();
  await supabase.auth.signOut();
  redirect('/');
}

function toFriendlyAuthError(message: string): string {
  if (/already registered|already exists/i.test(message)) return 'An account with this email already exists. Sign in instead.';
  return 'Could not create the account. Please try again.';
}
```

**`src/components/auth-form.tsx`** (client; `useActionState`, keeps email, inline error, pending state)

```tsx
'use client';

import Link from 'next/link';
import { useActionState } from 'react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import type { AuthFormState } from '@/app/(auth)/actions';

interface AuthFormProps {
  readonly mode: 'login' | 'signup';
  readonly action: (prev: AuthFormState, formData: FormData) => Promise<AuthFormState>;
}

const COPY = {
  login: { title: 'Sign in', description: 'Welcome back to Docly AI.', submit: 'Sign in', switchText: 'No account?', switchHref: '/signup', switchLabel: 'Create one' },
  signup: { title: 'Create your account', description: 'Start free. No card required.', submit: 'Create account', switchText: 'Already have an account?', switchHref: '/login', switchLabel: 'Sign in' },
} as const;

export function AuthForm({ mode, action }: AuthFormProps): React.ReactElement {
  const [state, formAction, isPending] = useActionState(action, { error: null, email: '' });
  const copy = COPY[mode];

  return (
    <Card className="w-full max-w-sm">
      <CardHeader>
        <CardTitle>{copy.title}</CardTitle>
        <CardDescription>{copy.description}</CardDescription>
      </CardHeader>
      <form action={formAction}>
        <CardContent className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="email">Email</Label>
            <Input id="email" name="email" type="email" autoComplete="email" defaultValue={state.email} required />
          </div>
          <div className="space-y-2">
            <Label htmlFor="password">Password</Label>
            <Input id="password" name="password" type="password" autoComplete={mode === 'login' ? 'current-password' : 'new-password'} minLength={8} required />
          </div>
          {state.error ? <p role="alert" className="text-sm text-destructive">{state.error}</p> : null}
        </CardContent>
        <CardFooter className="mt-4 flex flex-col gap-3">
          <Button type="submit" className="w-full" disabled={isPending}>{isPending ? 'Please wait…' : copy.submit}</Button>
          <p className="text-sm text-muted-foreground">
            {copy.switchText} <Link href={copy.switchHref} className="font-medium text-foreground underline-offset-4 hover:underline">{copy.switchLabel}</Link>
          </p>
        </CardFooter>
      </form>
    </Card>
  );
}
```

**Pages** (same shape; `signup` uses `signUp`, `mode="signup"`):

```tsx
// src/app/(auth)/login/page.tsx
import { signIn } from '@/app/(auth)/actions';
import { AuthForm } from '@/components/auth-form';

export default function LoginPage(): React.ReactElement {
  return (
    <main className="flex min-h-dvh items-center justify-center bg-muted/40 px-4">
      <AuthForm mode="login" action={signIn} />
    </main>
  );
}
```

**Verify:** `npm run typecheck && npm run lint`. **Commit:** `git commit -m "feat(auth): add sign-up, sign-in and sign-out"`

---

### Task 9: Dashboard shell

**Files:** Create: `src/app/dashboard/layout.tsx`, `src/app/dashboard/page.tsx`

**`layout.tsx`** — server component; authoritative check with `getUser()`; reads plan via RLS-scoped client.

```tsx
import Link from 'next/link';
import { redirect } from 'next/navigation';
import { signOut } from '@/app/(auth)/actions';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { getPlan } from '@/lib/plans';
import { createClient } from '@/lib/supabase/server';

export default async function DashboardLayout({ children }: { readonly children: React.ReactNode }): Promise<React.ReactElement> {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect('/login');

  const { data: profile } = await supabase.from('profiles').select('plan').eq('id', user.id).single();
  const plan = getPlan(profile?.plan);

  return (
    <div className="min-h-dvh bg-muted/30">
      <header className="border-b bg-background">
        <div className="mx-auto flex h-14 max-w-5xl items-center justify-between px-4">
          <Link href="/dashboard" className="font-semibold">Docly AI</Link>
          <div className="flex items-center gap-3">
            <Badge variant="secondary" data-testid="plan-badge">{plan.name} plan</Badge>
            <span className="hidden text-sm text-muted-foreground sm:inline">{user.email}</span>
            <form action={signOut}><Button variant="ghost" size="sm" type="submit">Sign out</Button></form>
          </div>
        </div>
      </header>
      <main className="mx-auto max-w-5xl px-4 py-8">{children}</main>
    </div>
  );
}
```

**`page.tsx`** — empty state; the "Create your bot" form is wired in Epic 02.

```tsx
import { Bot } from 'lucide-react';
import { Card, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';

export default function DashboardPage(): React.ReactElement {
  return (
    <Card>
      <CardHeader className="items-center text-center">
        <Bot className="size-10 text-primary" aria-hidden />
        <CardTitle>Create your bot</CardTitle>
        <CardDescription>Give your assistant a name and welcome message, then upload your documents.</CardDescription>
      </CardHeader>
    </Card>
  );
}
```

**Verify:** `npm run typecheck`. **Commit:** `git commit -m "feat(dashboard): add protected dashboard shell"`

---

### Task 10: Landing page (`coder-frontend`, `frontend-design` direction from SDD §7)

**Files:** Modify: `src/app/page.tsx`, `src/app/layout.tsx` (title/description) · Create: `src/components/landing/site-header.tsx`, `hero.tsx`, `how-it-works.tsx`, `features.tsx`, `pricing-cards.tsx`, `site-footer.tsx`

Requirements (from AC-01.01.x):
- **Header:** logo "Docly AI", links `#how-it-works`, `#pricing`, "Sign in" → `/login`, "Get started" → `/signup`.
- **Hero:** H1 "Your docs. Instant answers."; subline "Upload your company documents, ask questions in a chat, and embed the same assistant on your website."; primary CTA "Start free" → `/signup`; secondary "See pricing" → `#pricing`.
- **How it works (`id="how-it-works"`):** 3 cards Upload → Ask → Embed with Lucide icons (`Upload`, `MessageSquare`, `Code2`).
- **Features:** 3 items — grounded answers (says "I don't know" when docs lack info), one-line embed, private by default.
- **Pricing (`id="pricing"`):** `PricingCards` maps over `PLANS` — never hard-code numbers. Each card: name, `$priceUsd/mo`, documents, messages / month, widget, branding (Pro: "Accent color"), CTA → `/signup`. Pro shows note "Demo upgrade — no payment". Component accepts optional `renderAction?: (plan: Plan) => React.ReactNode` (reused by the plan modal in Epic 04).
- **Final CTA + footer:** "Ready in 5 minutes" → `/signup`; footer © year.
- Style: white/off-white, dark text, one indigo accent, restrained motion; responsive at 375 px and ≥ 1280 px; no horizontal scroll; no placeholder/lorem; every link resolves.

**Verify:** `npm run lint && npm run typecheck && npm run build`. **Commit:** `git commit -m "feat(landing): add landing page with pricing from plan config"`

---

### Task 11: Integration tests — profiles RLS (cloud project)

**Files:** Create: `tests/integration/helpers.ts`, `tests/integration/profiles-rls.test.ts`

**Precondition:** `SUPABASE_SECRET_KEY` set in `.env.local` (user step). If missing, stop and report.

**`helpers.ts`**

```ts
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import type { Database } from '@/lib/database.types';

function env(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`Missing ${name} for integration tests`);
  return value;
}

export function adminClient(): SupabaseClient<Database> {
  return createClient<Database>(env('NEXT_PUBLIC_SUPABASE_URL'), env('SUPABASE_SECRET_KEY'), { auth: { persistSession: false, autoRefreshToken: false } });
}

export interface TestUser {
  readonly id: string;
  readonly client: SupabaseClient<Database>;
}

export async function createTestUser(label: string): Promise<TestUser> {
  const email = `it-${label}-${Date.now()}@example.com`;
  const password = 'Password123!';
  const { data, error } = await adminClient().auth.admin.createUser({ email, password, email_confirm: true });
  if (error || !data.user) throw error ?? new Error('createUser failed');
  const client = createClient<Database>(env('NEXT_PUBLIC_SUPABASE_URL'), env('NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY'), { auth: { persistSession: false } });
  const signIn = await client.auth.signInWithPassword({ email, password });
  if (signIn.error) throw signIn.error;
  return { id: data.user.id, client };
}

export async function deleteTestUser(user: TestUser): Promise<void> {
  await adminClient().auth.admin.deleteUser(user.id);
}
```

**`profiles-rls.test.ts`**

```ts
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { adminClient, createTestUser, deleteTestUser, type TestUser } from './helpers';

describe('profiles RLS', () => {
  let alice: TestUser;
  let bob: TestUser;

  beforeAll(async () => {
    alice = await createTestUser('alice');
    bob = await createTestUser('bob');
  });

  afterAll(async () => {
    await deleteTestUser(alice);
    await deleteTestUser(bob);
  });

  it('should create a free profile when a user signs up', async () => {
    const { data } = await alice.client.from('profiles').select('plan').eq('id', alice.id).single();
    expect(data?.plan).toBe('free');
  });

  it('should hide other users profiles when querying by their id', async () => {
    const { data } = await alice.client.from('profiles').select('id').eq('id', bob.id);
    expect(data).toEqual([]);
  });

  it('should not let a user upgrade their own plan when updating from the client', async () => {
    await alice.client.from('profiles').update({ plan: 'pro' }).eq('id', alice.id);
    const { data } = await adminClient().from('profiles').select('plan').eq('id', alice.id).single();
    expect(data?.plan).toBe('free');
  });
});
```

**Run:** `npm run test:integration` → 3 PASS. **Commit:** `git commit -m "test(db): verify profiles RLS on Supabase"`

---

### Task 12: E2E — landing and auth (Playwright)

**Files:** Create: `e2e/landing.spec.ts`, `e2e/auth.spec.ts`

**Precondition:** "Confirm email" disabled in Supabase Auth (user step).

```ts
// e2e/landing.spec.ts
import { expect, test } from '@playwright/test';

test('landing explains the product, shows pricing and links to sign-up', async ({ page }) => {
  await page.goto('/');
  await expect(page.getByRole('heading', { level: 1 })).toContainText('Your docs. Instant answers.');
  const pricing = page.locator('#pricing');
  await expect(pricing).toContainText('30');
  await expect(pricing).toContainText('300');
  await expect(pricing).toContainText('$19');
  await page.getByRole('link', { name: 'Start free' }).click();
  await expect(page).toHaveURL(/\/signup$/);
});

test('landing has no horizontal scroll', async ({ page }) => {
  await page.goto('/');
  const hasOverflow = await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth);
  expect(hasOverflow).toBe(false);
});
```

```ts
// e2e/auth.spec.ts
import { expect, test } from '@playwright/test';

test('owner signs up, stays signed in after refresh, signs out', async ({ page }) => {
  const email = `e2e-${Date.now()}@example.com`;
  await page.goto('/signup');
  await page.getByLabel('Email').fill(email);
  await page.getByLabel('Password').fill('Password123!');
  await page.getByRole('button', { name: 'Create account' }).click();

  await expect(page).toHaveURL(/\/dashboard$/);
  await expect(page.getByTestId('plan-badge')).toHaveText('Free plan');
  await expect(page.getByText('Create your bot')).toBeVisible();

  await page.reload();
  await expect(page).toHaveURL(/\/dashboard$/);

  await page.getByRole('button', { name: 'Sign out' }).click();
  await expect(page).toHaveURL('/');
});

test('unauthenticated visitor is redirected from dashboard to login', async ({ page }) => {
  await page.goto('/dashboard');
  await expect(page).toHaveURL(/\/login$/);
});

test('wrong password shows an inline error and keeps the email', async ({ page }) => {
  await page.goto('/login');
  await page.getByLabel('Email').fill('nobody@example.com');
  await page.getByLabel('Password').fill('WrongPass123');
  await page.getByRole('button', { name: 'Sign in' }).click();
  await expect(page.getByRole('alert')).toHaveText('Invalid email or password.');
  await expect(page.getByLabel('Email')).toHaveValue('nobody@example.com');
});
```

**Run:** `npm run test:e2e` → all pass (desktop + mobile). E2E users created here are disposable; clean up later via MCP SQL if needed.
**Commit:** `git commit -m "test(e2e): cover landing and auth flows"`

---

### Task 13: README stub

**Files:** Modify: `README.md` — replace scaffold text with: product one-liner, stack, `cp .env.example .env.local`, `npm install`, `npm run dev`, migrations note (`supabase/migrations`, applied in order), test commands, "Confirm email must be off" note. Full README is Epic 04.

**Commit:** `git commit -m "docs: add README setup notes"`

---

### Task 14: Deployed preview — **user-assisted, can be deferred to end of Epic 01 verification**

1. Create GitHub repo and push: `gh repo create docly-ai --private --source . --push` (**needs user OK** — outward-facing).
2. Vercel dashboard → Import repo → env vars `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY`, `NEXT_PUBLIC_APP_URL` → Deploy (user does this; Vercel CLI not installed).
3. Supabase → Authentication → URL Configuration: Site URL = Vercel domain.
4. Smoke on preview: landing loads, sign-up → dashboard.

---

## Epic 01 Exit Checklist (maps to epic DoD)

- [ ] AC-01.01.1–5 landing (E2E `landing.spec.ts` + browser-verify at 375 px / 1280 px)
- [ ] AC-01.02.1–4 auth (E2E `auth.spec.ts`, integration "free profile")
- [ ] AC-01.03.1–4 protection & RLS (E2E redirect, integration RLS tests)
- [ ] AC-01.04.1–5 `lint`, `typecheck`, `test`, `build`, `test:integration`, `test:e2e` pass; migration applied; `.env.example` placeholders only; preview deployed (Task 14)
