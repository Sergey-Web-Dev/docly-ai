# Dark Space Theme — Implementation Plan

**Task:** TASK-003 · **Branch:** `feature/space-theme` (from `main`)

**Goal:** GitHub-homepage-style dark space look on `/`, `/login`, `/signup`. Dashboard, chat, billing, checkout and `/embed` stay light with the current light star field untouched.

**Stack:** existing (Next.js 16, Tailwind v4, canvas 2D). No new runtime dependencies.

## Steps

1. **Pure logic (TDD)** — `src/lib/space-sky.ts` + `space-sky.test.ts`: power-law star generation (size/brightness), colour temperature palette (blue-white, white, warm, rare orange), 3 depth layers, Milky-Way band stars, sparkle selection (brightest ~3%), scintillation (`twinkle`), shooting-star scheduler (4-9 s delay, random direction/speed, progress).
2. **Rendering** — `src/lib/space-draw.ts`: offscreen sprites (dot glow, 4-point spike cross, shooting tail) built once per resize/DPR; per-frame only `drawImage`/`fillRect`. Pointer parallax + brighten reuse `FieldState`.
3. **Component** — `starfield-background.tsx` gets a `variant` (`light` | `space`) chosen from the pathname; scene abstraction so the loop, DPR cap, visibility pause, 30 fps throttle, low-power density and reduced-motion static frame are shared. Space adds a CSS layer (deep gradient `#05060f → #0b1026`, 3 blurred drifting nebulas, faint band) behind the canvas.
4. **Dark UI** — landing sections, header/footer, hero chat preview, pricing (`tone` prop so billing stays light), auth pages/form: zinc-100/200 text, zinc-400 body, `bg-white/5 border-white/10 backdrop-blur` cards, indigo CTA with glow, visible focus rings, AA contrast.
5. **Verify** — scratch Playwright screenshots (`/` 1280x800 t≈1s/6s + 375x812, `/login`, `/signup`, `/dashboard` unchanged), iterate; regenerate walkthrough; lint, typecheck, `npm test`, `npm run test:e2e`, build.

## Commits
1. plan + pure helpers + tests  2. space renderer + variant  3. dark landing/auth UI  4. walkthrough screenshots (and any e2e tweaks)
