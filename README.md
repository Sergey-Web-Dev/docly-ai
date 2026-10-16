# Docly AI

Your docs. Instant answers. Upload company documents, ask questions in a chat, and embed the same assistant on your website.

## Stack

- Next.js (App Router) + TypeScript
- Tailwind CSS + shadcn/ui (base-nova) + Lucide icons
- Supabase (Auth, Postgres with RLS)
- Vitest (unit and integration) and Playwright (E2E)

## Setup

```bash
cp .env.example .env.local   # then fill in your Supabase values
npm install
npm run dev
```

Open http://localhost:3000.

### Supabase

- Migrations live in `supabase/migrations` and are applied in filename order.
- In the Supabase dashboard, go to Authentication > Providers > Email and turn **Confirm email off**. Sign-up signs the user in immediately and relies on this.

## Tests

```bash
npm run lint
npm run typecheck
npm test                  # unit tests
npm run test:integration  # needs SUPABASE_SECRET_KEY in .env.local
npm run test:e2e          # Playwright
```

A full README (architecture, widget embedding, deployment) arrives in Epic 04.
