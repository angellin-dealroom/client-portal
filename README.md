# Client Portal

A simple portal where clients log in with a magic link, see where they are in your onboarding pipeline, and click through to their proposal, contract, payment, kickoff call, and onboarding form. The admin (you) has a separate view to create and manage clients.

## Status

Live on Vercel. Auth, database, client dashboard, and admin CRUD are all working. Production URL: <https://client-portal-five-chi.vercel.app>. Custom domain (`portal.dealroom.media`) is on the roadmap.

## Tech stack (in plain terms)

- **Next.js 14 (App Router) + TypeScript** — the framework that runs both the website and the back-end API routes. "App Router" is just the newer way Next.js organizes pages, and TypeScript is JavaScript with type checking to catch mistakes early.
- **Tailwind CSS + shadcn/ui** — Tailwind is a way to style things with short class names (`p-4`, `text-xl`) instead of writing separate CSS files. shadcn/ui is a set of pre-built, customizable components (buttons, cards, forms) that live inside your project so you can tweak them freely.
- **Supabase** — your database (Postgres) and authentication provider. Handles the magic-link login flow.
- **Resend** — transactional email (added later).
- **Vercel** — where the site will be hosted once deployed.

## Run it locally

From this folder:

```
npm run dev
```

Then open <http://localhost:3000> in your browser. The dev server auto-reloads when you change files. Stop it with `Ctrl+C`.

Other commands you might use:

- `npm run build` — make a production build (useful to check nothing is broken)
- `npm run start` — run the production build locally
- `npm run lint` — check for common code issues

## Folder map

```
client-portal/
├── src/
│   ├── app/                    ← every page in the site lives here
│   │   ├── page.tsx              · the landing page at /
│   │   ├── layout.tsx            · the shared shell wrapping every page
│   │   ├── globals.css           · Tailwind + theme variables
│   │   ├── dashboard/
│   │   │   └── page.tsx          · the client dashboard at /dashboard
│   │   └── admin/
│   │       └── page.tsx          · the admin panel at /admin
│   ├── components/
│   │   └── ui/                   · shadcn/ui components (button, etc.)
│   └── lib/
│       └── utils.ts              · small shared helpers
├── public/                     ← static files served as-is (images, favicon)
├── .env.local                  ← your secrets (gitignored — stays on your machine)
├── .env.example                ← template showing which env vars are needed
├── components.json             ← shadcn/ui config
├── tailwind.config.ts          ← Tailwind config
├── next.config.mjs             ← Next.js config
├── package.json                ← project dependencies and scripts
└── tsconfig.json               ← TypeScript config
```

**In one sentence:** your pages live in `src/app/`, reusable bits live in `src/components/` and `src/lib/`, and everything else is configuration.

## Environment variables

Real values live in `.env.local` on your machine only (never committed to git). The placeholder `.env.example` shows which keys exist.

- `NEXT_PUBLIC_SUPABASE_URL` — your Supabase project's URL. Safe for the browser.
- `NEXT_PUBLIC_SUPABASE_ANON_KEY` — the publishable key (starts with `sb_publishable_...`). Safe for the browser.
- `ADMIN_EMAIL` — the email that gets admin access to `/admin`.

Anything prefixed with `NEXT_PUBLIC_` is bundled into the browser. Anything without that prefix is server-only and stays on the server.

## Deployment

Production runs on Vercel, auto-deploys from `main` on every push. Pushes to other branches create preview deploys at unique `*.vercel.app` URLs.

### Vercel environment variables

Set in Vercel → Project Settings → Environment Variables, scoped to Production + Preview + Development:

- `NEXT_PUBLIC_SUPABASE_URL`
- `NEXT_PUBLIC_SUPABASE_ANON_KEY`
- `ADMIN_EMAIL`

### Supabase URL configuration

Supabase → Authentication → URL Configuration:

- **Site URL**: `https://client-portal-five-chi.vercel.app` (the value `{{ .SiteURL }}` expands to in email templates)
- **Redirect URLs**:
  - `http://localhost:3000/auth/callback` (local dev)
  - `https://*.vercel.app/auth/callback` (Vercel previews + production)
  - `https://portal.dealroom.media/auth/callback` (pre-authorized for the future custom domain)

### Magic-link email template

Supabase → Authentication → Email Templates → Magic Link uses the token-hash flow rather than the default PKCE redirect:

```html
<a href="{{ .SiteURL }}/auth/callback?token_hash={{ .TokenHash }}&type=magiclink">Log In</a>
```

This is what allows magic links to work cross-browser and cross-device (the PKCE default needs the verifier cookie on the originating browser).

### Custom SMTP

Auth emails route through Resend, sender `noreply@dealroom.media` on the verified `dealroom.media` domain. Configured under Supabase → Project Settings → Auth → SMTP. Lifts the default per-hour rate limits.

## Database migrations

Tracked in `supabase/migrations/`. Applied manually via Supabase SQL Editor (no Supabase CLI workflow yet).

- `0001_initial_schema.sql` — `clients`, `project_links`, `activity_log` tables, enums, updated_at triggers, `is_admin()` helper, RLS policies.
- `0002_record_link_click.sql` — `SECURITY DEFINER` RPC the dashboard calls when a client clicks an Open button.

The `is_admin()` SQL function hardcodes the admin email — if `ADMIN_EMAIL` ever changes, update both the env var AND the function.

## Roadmap

In priority order:

1. **Send invite email from admin** — admin clicks a button on a client row, client receives a branded magic-link email inviting them in.
2. **Real landing page** — replace the placeholder with a minimal explainer + Sign in button.
3. **Mobile responsiveness pass** — dashboard cards, stage indicator, admin table.
4. **Branded magic-link email** via Resend, applied to both regular sign-in and the invite email from #1.
5. **Email notifications to admin** when a client views a link.

Deferred:

- Custom domain `portal.dealroom.media` (DNS access pending).
- 404 / 500 / loading states polish.
- Vercel Analytics + error monitoring.
- E2E tests.
