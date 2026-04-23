# Client Portal

A simple portal where clients log in with a magic link, see where they are in your onboarding pipeline, and click through to their proposal, contract, payment, kickoff call, and onboarding form. The admin (you) has a separate view to create and manage clients.

## Status

Scaffolded. Auth, database, and admin tools will be added in later steps.

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

## What's next

1. Create the Supabase tables (`clients`, `project_links`, `activity_log`) with Row Level Security.
2. Build the magic-link auth flow.
3. Build the client dashboard and admin panel.
4. Deploy to Vercel.
