# Zapier Integration Handbook

How the client portal integrates with Stripe, PandaDoc, Typeform, SavvyCal, and Day.ai — all wired through Zapier rather than custom webhook handlers in this codebase.

Audience: Angel and Shamus, building Zaps in the Dealroom Media Zapier workspace. Read this end-to-end before building the first Zap; sections are cross-referenced.

> **This document is the source of truth for Zap behavior.** Zaps live in Zapier's UI and can't be version-controlled like code. When you change a Zap (add a step, edit a filter, swap a field mapping, retire a Zap, add a new one), **update the matching section in this doc in the same session**, then commit. If the doc and the live Zap drift, the doc wins for purposes of review — meaning if the Zap behavior surprises you, fix the Zap to match the doc, then evaluate if the doc needs updating. Treat this file like you treat the code: PR-style discipline.

---

## 1. Connectors required

| Connector | Purpose | Notes |
|---|---|---|
| **Stripe** | Trigger: payment events from Shamus's Stripe account | Built-in Zapier app. Requires Shamus to authorize Zapier in Stripe. |
| **PandaDoc** | Trigger: document state changes (signed, completed) | Built-in Zapier app. Requires Shamus to authorize. |
| **Typeform** | Trigger: form submissions | Built-in Zapier app. Requires Shamus to authorize. |
| **SavvyCal** | Trigger: meeting scheduled / cancelled | Built-in Zapier app. May be limited; verify trigger options when setting up. |
| **Day.ai** | Bidirectional sync with Day.ai contacts/timeline | TBD — see §5.5. May not have a first-party Zapier app; fallback is Webhooks by Zapier. |
| **PostgreSQL** | Action: read/write rows in our `clients`, `project_links`, `activity_log` tables via direct DB connection | Built-in Zapier app. **Supabase has not built a first-party Zapier app**; we connect to Supabase's underlying Postgres directly. One connection reused by all Zaps. See §2 for setup. |
| **Webhooks by Zapier** | Action: POST to our portal's `/api/notify-admin` endpoint to send branded notification emails (see §3) | Built-in. No external auth — uses a shared secret set as a Zapier connection or per-Zap header. |

You don't need separate Resend or Gmail connectors if you go with the recommended notification strategy in §3.

---

## 2. PostgreSQL connection to Supabase

Zapier doesn't have a first-party Supabase app (verified late 2025; Zapier's own page says "Supabase has not yet built an integration on Zapier"). The standard workaround is to use Zapier's **PostgreSQL** connector and point it at Supabase's underlying Postgres database directly. Same outcome: Zaps can read/write our three tables.

### 2.1 Create a dedicated `zapier` Postgres role

Run this **once** in **Supabase → SQL Editor**. Save the SQL as `supabase/migrations/0003_zapier_role.sql` so it's tracked alongside the other migrations.

**Generate a strong password before running** — e.g. `openssl rand -base64 32` in your terminal — and substitute it for the placeholder. Save the password somewhere safe (1Password, etc.); you'll paste it into Zapier next.

```sql
-- Dedicated Postgres role for Zapier's direct DB connection.
-- BYPASSRLS lets it read/write tables that have RLS enabled
-- (clients, project_links, activity_log) without needing JWT
-- context — RLS policies require a logged-in user, which Zapier
-- is not. Narrowed grants below restrict it to the three tables
-- we actually need.
create role zapier with login bypassrls password 'REPLACE-WITH-STRONG-PASSWORD';

grant usage on schema public to zapier;

grant select, insert, update on public.clients       to zapier;
grant select, insert, update on public.project_links to zapier;
grant select, insert         on public.activity_log  to zapier;

-- No DELETE grants — Zaps should never delete rows. If a future
-- Zap genuinely needs delete, grant explicitly then.

-- PKs default to gen_random_uuid() so no sequence grants needed.
```

### 2.2 Find Supabase's Postgres connection credentials

Supabase dashboard → **Project Settings** → **Database**. Two sections matter:

- **Connection info** (top): the **direct connection**. Host typically `db.<project-ref>.supabase.co`, port `5432`, database `postgres`.
- **Connection pooling**: the **transaction pooler**. Host `aws-0-<region>.pooler.supabase.com`, port `6543`, database `postgres`.

**Use the transaction pooler (port 6543).** Zapier opens a fresh connection for each step, which is exactly what poolers are designed for. Direct connections work but are wasteful for short-lived workloads and Supabase's free tier has stricter limits there.

### 2.3 Configure Zapier's PostgreSQL connector

In Zapier: top-right avatar → **My Apps** → **Add connection** → search **PostgreSQL**.

| Field | Value |
|---|---|
| Host | from the pooler row, e.g. `aws-0-<region>.pooler.supabase.com` (read it off Supabase's dashboard — region varies) |
| Port | `6543` |
| Database | `postgres` |
| Username | **`zapier.nzyugdbdsvpeipqbqxdg`** (the role name **suffixed with the project ref**) |
| Password | the password you set in §2.1 |
| Schema | `public` |
| SSL | **Required** (Supabase enforces it) |

The username suffix (`.nzyugdbdsvpeipqbqxdg`) is how Supabase's transaction pooler routes connections to the right project — it's not part of the Postgres role name itself. If you connect to the direct port (5432) instead, the username is just `zapier` with no suffix.

Connection name: `Supabase Postgres — Dealroom Media production`.

After saving, run a quick **Test connection** if Zapier offers it; otherwise the next phase will exercise it.

### 2.4 RLS considerations

The `zapier` role has `BYPASSRLS`, so policies don't apply to its queries. That's correct: Zaps act as the admin on automated paths, not as an authenticated client. Browser-side traffic still goes through PostgREST + RLS as before — nothing about the existing client/admin login flow changes.

### 2.5 Security boundaries

**Treat Zapier workspace access as production database access.** The `zapier` role has read/write access to every client record. Whoever can edit Zaps can effectively read or modify any client data.

Required hygiene:
- **2FA on the Zapier account.** Non-negotiable.
- **2FA on the Supabase account** that holds the database password.
- **Workspace members:** only Angel and Shamus, no contractors or interns. If that needs to change, rotate the `zapier` password (run `alter role zapier with password '...'` in Supabase SQL Editor) and update the Zapier connection under a fresh workspace user.
- **No third-party Zapier apps.** Don't connect Zaps to external apps outside this handbook (logging tools, "AI summarizer" apps, etc.) — they'd see Postgres row data flowing through. If you ever do, audit what data they receive.
- **If the Zapier account is compromised:** treat it as a Supabase data breach. Rotate the `zapier` password as a single emergency operation. The portal's `SUPABASE_SERVICE_ROLE_KEY` is a separate credential and doesn't need rotation just because Zapier is compromised.

### 2.6 Where the password lives

The Zapier PostgreSQL connection stores the password encrypted, scoped to your workspace. **Do not** put this password in `.env.local`, Vercel, or anywhere in the codebase — the portal doesn't need it. The only places it should exist are:
1. The Zapier connection
2. Your password manager (1Password, etc.) for backup

If rotated, update both.

### Security boundaries

**Treat Zapier workspace access as production database access.** The service role key inside Zapier bypasses RLS and can read/write every table. Whoever can edit Zaps can effectively read or modify any client data.

Required hygiene:
- **2FA on the Zapier account.** Non-negotiable.
- **2FA on the Supabase account** that holds the service role key.
- **Workspace members:** only Angel and Shamus, no contractors or interns. If that needs to change, rotate the service role key first and re-add it to Zapier under a fresh workspace user (Zapier doesn't expose key values to existing members but assume any member who has *seen* a Zap step's setup screen has effective access).
- **No third-party Zapier apps.** Don't connect Zaps to apps outside this handbook (e.g. logging tools, "AI summarizer" apps) — they'd see Supabase row data flowing through. If you ever do, audit what data they receive.
- **If the Zapier account is compromised:** treat it as a Supabase data breach. Rotate the service role key in Supabase + Vercel + `.env.local` + Zapier as a single emergency operation.

---

## 3. Notification email strategy

When an integration event fires, you want a branded notification email. Three options:

| Option | What | Pros | Cons |
|---|---|---|---|
| **(a)** Email by Zapier | Zapier's built-in plain-text email | Zero setup | Generic visual, doesn't match the existing branded emails |
| **(b)** Resend via Zapier (Webhooks → Resend API) | Direct call to Resend's send-email API | Same sender domain | You'd reimplement the HTML scaffolder inside Zapier templates — drift over time |
| **(c) — recommended** | A small **Webhooks by Zapier** step that POSTs to a new portal route `/api/notify-admin` | Same scaffolder produces every email — perfect visual consistency. One change to the scaffolder updates every integration's emails. | Requires building one route handler in the portal |

**Going with (c).** This means before we build any Zaps, we add one route to the portal — see §3.1.

### 3.1 The `/api/notify-admin` endpoint (portal-side, build first)

This is **the only portal code change** for the Zapier strategy. Once it exists, every Zap can fire branded emails the same way.

**Behavior:**
- `POST /api/notify-admin` accepts `{ subject: string, paragraphs: string[], cta?: { label: string, url: string } }` as JSON.
- Validates a shared secret in the `x-notify-secret` header against `NOTIFY_SECRET` env var.
- Sends an email via Resend using the existing `brandedEmailHtml` / `brandedEmailText` scaffolder (no greeting; "Heads up," internal-notification style with no signoff).
- Returns 200 on success, 401 on bad secret, 400 on bad payload.

**Env vars to add:**
- `NOTIFY_SECRET` — random string. Generate with `openssl rand -hex 32`. Paste into `.env.local`, Vercel, and Zapier's Webhooks step header.

**To use from a Zap:**
1. Add a **Webhooks by Zapier → POST** step.
2. URL: `https://client-portal-five-chi.vercel.app/api/notify-admin`
3. Payload type: JSON
4. Headers: `x-notify-secret: <NOTIFY_SECRET value>`
5. Data:
   ```
   subject     = "{Subject for this notification}"
   paragraphs  = ["First paragraph.", "Second paragraph."]
   cta_label   = "Open in admin →"
   cta_url     = "https://client-portal-five-chi.vercel.app/admin/clients/{{client_id}}"
   ```
   (Zapier flattens nested objects; you may need to provide `paragraphs` as a comma-separated list and have the route split it. We'll figure out the exact shape when we build the route.)

We'll build `/api/notify-admin` as the first task once you've reviewed this handbook.

---

## 4. Stage advancement rules

Same conservative rules we agreed on for the webhook approach: **only advance forward, only when the prior stage matches the expected predecessor**, otherwise leave stage as-is and flag in the notification email.

| Source event | Required prior stage | New stage | If prior stage doesn't match |
|---|---|---|---|
| **Stripe payment completed** | `contract` | `onboarding` | Leave stage as-is. Notification body includes "⚠ stage was {X}, not Contract — left as-is, please review." |
| **PandaDoc proposal signed** | `discovery` | `proposal` | Leave as-is + warn in notification. |
| **PandaDoc contract signed** | `proposal` | `contract` | Leave as-is + warn in notification. |
| **SavvyCal kickoff scheduled** | _(no advance)_ | _(no advance)_ | N/A — only updates `project_links.status` to `completed`. The kickoff being booked doesn't move the client through the pipeline; the kickoff *happening* later might. |
| **SavvyCal kickoff cancelled** | _(no rollback)_ | _(no rollback)_ | **Notify only, no DB change.** `project_links.status` stays `completed` even after a cancellation. If they re-book, the New Booking Zap fires again and is idempotent. |
| **Typeform onboarding submitted** | `onboarding` | `active` | Leave as-is + warn in notification. |

In every Zap, the stage-advance step is a **Filter (only continue if)** or **Path** — it runs only when the prior stage matches. The activity_log insert and the email notification always run regardless.

Refunds (Stripe `charge.refunded`) and cancellations (PandaDoc, SavvyCal, Typeform) **do not** roll stage back. They send a notification and log an activity_log row but don't change any project_links.status or clients.stage.

---

## 5. Per-integration playbooks

Each playbook is a step-by-step blueprint for a Zap. Naming convention: `[Source] - [Event] → Portal`.

### 5.1 Stripe — Payment Completed

**Goal:** when a client pays via Stripe Payment Link, mark their portal payment card as completed, optionally advance stage Contract → Onboarding, log activity, notify admin.

**Trigger:**
- App: **Stripe**
- Event: **New Checkout Session Completed** (this fires when `checkout.session.completed` arrives — same event the webhook approach was going to handle)
- *If that exact event isn't available in Zapier's Stripe connector, fall back to "New Charge" and add a filter on `paid = true`.*

**Identifying the client — three-stage match (Customer Details Email → Individual Name → Cardholder/Company):**

Discovered during trigger-sample inspection: Stripe's top-level `customer_email` is *often blank* depending on the payment method. The reliable signals live under `customer_details`:

- `customer_details.email` — consistently populated. **Stage 1 input.**
- `customer_details.individual_name` — the actual person's name, populated even when paying with a corporate card. **Stage 2 input** against `clients.name`.
- `customer_details.name` — the cardholder name. Often shows the company name on corporate cards, the person's name on personal cards. **Stage 3 input** against `clients.company`.

Three-stage match logic:

1. **Stage 1 — email** (case-insensitive, trimmed). Compare `customer_details.email` against `clients.email`. Hit → matched, stop.
2. **Stage 2 — individual name** (case-insensitive, trimmed). Runs only when Stage 1 was empty. Compare `customer_details.individual_name` against `clients.name`. **Exactly one row** → matched, stop. **Multiple rows** → `orphan_ambiguous_name`, stop. **Zero rows** → continue to Stage 3.
3. **Stage 3 — cardholder/company** (case-insensitive, trimmed). Runs only when Stage 2 found zero. Compare `customer_details.name` against `clients.company`. **Exactly one row** → matched, stop. **Multiple rows** → `orphan_ambiguous_company`, stop. **Zero rows** → `orphan_no_match`.

**`match_reason` values:** `email`, `name`, `company`, `orphan_ambiguous_name`, `orphan_ambiguous_company`, `orphan_no_match`.

**Why three stages.** Apple Pay sometimes inserts iCloud relay addresses that won't match. Corporate-card payments often have the company name as cardholder rather than the individual. Falling through email → individual → company catches the realistic spread of how Stripe Checkout fields get populated. Collisions go to orphan-notify so we never guess.

**No Shamus behavior change.** He creates Payment Links as before; we match whatever Stripe captures from the customer.

**`client_reference_id` still not used in v1.** Could be added as a deterministic stage-zero match if reliability ever needs to beat Shamus's ergonomics.

**Zap steps:**

**Zap structure (high level):**

```
Trigger: Stripe Checkout Session Completed
  ↓
Filter: payment_status = "paid"
  ↓
PostgreSQL Custom Query: three-stage match (match_reason, matched_*, ambiguity_*)
  ↓
Paths by Zapier:
  ├── A. Matched (email, name, or company)            → main flow
  ├── B. Orphan — ambiguous (name OR company)         → notify admin, end
  └── C. Orphan — no match                            → notify admin, end
```

**Zap steps:**

1. **Trigger:** Stripe → Checkout Session Completed.

2. **Filter:** Only continue if `payment_status` exactly matches `paid`. Defensive — Stripe fires `checkout.session.completed` for any completed session, including ones where the payment is still `unpaid` (e.g. delayed payment methods like ACH that haven't cleared). We only want to advance portal state on actual money-received events.

3. **PostgreSQL Custom Query (three-stage match in one SQL pass).** Always returns exactly one row. The downstream Path step branches on `match_reason`. Output fields: `match_reason`, `matched_id`, `matched_name`, `matched_email`, `matched_stage`, `name_match_count`, `company_match_count`, `ambiguity_type`, `ambiguity_count`.

   **Why inline values rather than parameter binding.** Zapier's PostgreSQL "Find Rows via Custom Query" action does not expose `$1`/`$2` parameter slots — it only takes a Query field, with merge fields substituted as raw text. We use **PostgreSQL dollar-quoting** (`$drm_8a3f$...$drm_8a3f$`) around each merge field so apostrophes and other special characters in customer names are treated as literal characters, not SQL syntax. The tag `drm_8a3f` is intentionally arbitrary and unique to this Zap — keep it the same wherever it appears in the query so the tags balance, and don't paste the tag into anything customer-visible. See §2.5 on workspace-access being the trust boundary.

   Replace **each** placeholder with the corresponding Zapier merge field. Five total placeholders, three distinct merge fields:
   - `<<DETAILS EMAIL>>` — appears 1× → map `customer_details.email`
   - `<<INDIVIDUAL NAME>>` — appears 2× → map `customer_details.individual_name` (same field both times)
   - `<<CARDHOLDER NAME>>` — appears 2× → map `customer_details.name` (same field both times)

   **Use the merge-field picker for every placeholder — don't type values.**

   ```sql
   with
     by_email as (
       select id, name, email, stage
       from clients
       where lower(trim(email)) = lower(trim($drm_8a3f$<<DETAILS EMAIL>>$drm_8a3f$))
       limit 1
     ),
     by_name_count as (
       select count(*) as cnt
       from clients
       where lower(trim(name)) = lower(trim($drm_8a3f$<<INDIVIDUAL NAME>>$drm_8a3f$))
     ),
     by_name as (
       select id, name, email, stage
       from clients
       where lower(trim(name)) = lower(trim($drm_8a3f$<<INDIVIDUAL NAME>>$drm_8a3f$))
       limit 1
     ),
     by_company_count as (
       select count(*) as cnt
       from clients
       where company is not null
         and lower(trim(company)) = lower(trim($drm_8a3f$<<CARDHOLDER NAME>>$drm_8a3f$))
     ),
     by_company as (
       select id, name, email, stage
       from clients
       where company is not null
         and lower(trim(company)) = lower(trim($drm_8a3f$<<CARDHOLDER NAME>>$drm_8a3f$))
       limit 1
     )
   select
     case
       when (select count(*) from by_email) > 0 then 'email'
       when (select cnt from by_name_count) = 1 then 'name'
       when (select cnt from by_name_count) > 1 then 'orphan_ambiguous_name'
       when (select cnt from by_company_count) = 1 then 'company'
       when (select cnt from by_company_count) > 1 then 'orphan_ambiguous_company'
       else 'orphan_no_match'
     end as match_reason,
     case
       when (select count(*) from by_email) > 0 then (select id from by_email)
       when (select cnt from by_name_count) = 1 then (select id from by_name)
       when (select cnt from by_company_count) = 1 then (select id from by_company)
     end as matched_id,
     case
       when (select count(*) from by_email) > 0 then (select name from by_email)
       when (select cnt from by_name_count) = 1 then (select name from by_name)
       when (select cnt from by_company_count) = 1 then (select name from by_company)
     end as matched_name,
     case
       when (select count(*) from by_email) > 0 then (select email from by_email)
       when (select cnt from by_name_count) = 1 then (select email from by_name)
       when (select cnt from by_company_count) = 1 then (select email from by_company)
     end as matched_email,
     case
       when (select count(*) from by_email) > 0 then (select stage from by_email)
       when (select cnt from by_name_count) = 1 then (select stage from by_name)
       when (select cnt from by_company_count) = 1 then (select stage from by_company)
     end as matched_stage,
     (select cnt from by_name_count) as name_match_count,
     (select cnt from by_company_count) as company_match_count,
     case
       when (select cnt from by_name_count) > 1 then 'name'
       when (select cnt from by_name_count) = 0 and (select cnt from by_company_count) > 1 then 'company'
     end as ambiguity_type,
     case
       when (select cnt from by_name_count) > 1 then (select cnt from by_name_count)
       when (select cnt from by_name_count) = 0 and (select cnt from by_company_count) > 1 then (select cnt from by_company_count)
     end as ambiguity_count;
   ```

   **Edge case — value contains the literal tag string `$drm_8a3f$`.** Dollar-quoting fails if a customer-supplied value happens to contain the closing tag verbatim. The SQL would fail to parse, Zapier marks the run as errored, and Zapier's built-in error alerts email you. Manually reconcile via Stripe dashboard. Probability of accidental occurrence is ~1 in 4 billion for an 8-hex-char tag; deliberate attack would require workspace access (which already implies DB access). If the tag is ever leaked publicly, generate a new one and update this query — the tag value isn't load-bearing beyond uniqueness.

4. **Paths by Zapier — three branches** keyed off `match_reason`:

   - **Path A — Matched** (rule: `match_reason` exactly matches `email` OR `name` OR `company`): continue with the main flow below.
   - **Path B — Orphan, ambiguous** (rule: `match_reason` exactly matches `orphan_ambiguous_name` OR `orphan_ambiguous_company`): single Webhooks-by-Zapier POST → `/api/notify-admin`. Subject `Stripe payment from {{customer_details.email}} — ambiguous {{ambiguity_type}} match`. Body uses `ambiguity_type` (`name` or `company`) and `ambiguity_count` to describe the collision. No DB writes. End of path.
   - **Path C — Orphan, no match** (rule: `match_reason` exactly matches `orphan_no_match`): single Webhooks-by-Zapier POST → `/api/notify-admin`. Subject `Stripe payment from {{customer_details.email}} — no portal match`. Body explains, includes session id. End of path.

   **(Path A only — main flow:)**

5. **PostgreSQL → Find Row** in `project_links`. Filter: `client_id = {{step3.matched_id}} AND link_type = 'payment'`. Captures the row's id (or null if it doesn't exist yet).
5. **Action:** PostgreSQL → **Find Row** in `project_links`. Filter: `client_id = {{step3.id}} AND link_type = 'payment'`. Captures the row's id (or null if it doesn't exist yet).
6. **Path A — payment row exists:** PostgreSQL → **Update Row** in `project_links`. Row id = `{{step5.id}}`. Set `status = 'completed'`.
7. **Path B — payment row doesn't exist:** PostgreSQL → **New Row** in `project_links`. `client_id`, `link_type='payment'`, `status='completed'`, `url=null`.
8. **Path / Filter:** Only if `step3.stage = 'contract'`, then PostgreSQL → **Update Row** in `clients`. Row id = `{{step3.id}}`. Set `stage = 'onboarding'`.
9. **Action:** PostgreSQL → **New Row** in `activity_log`:
   - `client_id = {{step3.id}}`
   - `action = 'payment_completed'`
   - `metadata = { "stripe_session_id": "{{trigger.id}}", "stripe_payment_intent": "{{trigger.payment_intent}}", "amount_cents": {{trigger.amount_total}}, "currency": "{{trigger.currency}}", "prior_stage": "{{step3.stage}}", "advanced_stage": {{step3.stage == 'contract'}} }` (exact JSON shape may need tweaking based on how Zapier handles JSONB fields).
10. **Action:** Webhooks by Zapier → POST to `/api/notify-admin`. See §3.1 for payload shape. Subject:
    > Payment from {{step3.name}} ({{trigger.amount_total / 100}} {{trigger.currency | upper}})

    Paragraphs:
    1. `{{step3.name}} ({{step3.email}}) just completed their payment of {{formatted amount}}.`
    2. *(conditional)* If `step3.stage == 'contract'`: `Their stage moved from Contract to Onboarding.` Otherwise: `Their stage was {{step3.stage_label}} — left as-is. You may want to review.`

    CTA: `Open in admin → https://client-portal-five-chi.vercel.app/admin/clients/{{step3.id}}`

**Edge cases:**

- **Stripe top-level `customer_email` is blank** → ignored. We use `customer_details.email` (consistently populated) as the Stage 1 input. The Filter step now gates on `payment_status = 'paid'` instead of email presence.
- **Session has `payment_status = 'unpaid'`** (delayed payment methods like ACH that haven't cleared) → silent stop at the Filter. Stripe will fire a separate event when the payment actually succeeds; that's what we want to act on. *(If we later care about tracking "payment initiated but not yet cleared" as a portal stage, we'd add a separate Zap.)*
- **Apple Pay relay address** (`*@privaterelay.appleid.com`) doesn't match anyone in `clients` → Stage 1 misses, Stage 2 takes over with `customer_details.individual_name`. If the customer's individual name is unique in the portal, the payment processes correctly.
- **Corporate-card payment** where the cardholder name is the company → Stage 1 might miss (relay or unmatched email), Stage 2 might miss (cardholder isn't the individual), Stage 3 catches it via `clients.company`.
- **Stage 2 finds multiple clients with the same individual name** (`orphan_ambiguous_name`) → Path B notification: "ambiguous name match (N clients have this name)". Don't write to DB. Manual reconcile: contact the customer or rename one of the duplicate-named portal clients.
- **Stage 3 finds multiple clients with the same company** (`orphan_ambiguous_company`) → Path B notification: "ambiguous company match (N clients have this company)". Don't write to DB. Manual reconcile: same approach — contact or de-duplicate.
- **All three stages miss** (`orphan_no_match`) → Path C notification: "no portal match." Could be a non-portal customer who paid by mistake, or a portal client whose email/individual-name/company don't match what Stripe captured. Manual reconcile.
- **Multiple portal clients with the same email** → can't happen. `clients.email` has a unique constraint at the DB level (set in `0001_initial_schema.sql`). The `by_email` CTE returns one row or zero.
- **Stripe retries the event** (Zapier dedupes within a single Zap run; if Zapier was off and the same event arrives twice, the writes happen twice — idempotent for `project_links.status = 'completed'` but extra `activity_log` rows would appear). Acceptable for v1.

**Future enhancement (not v1) — pre-generate Payment Links from the portal.**

The current flow leaves Payment Link creation as a manual Stripe-side step for Shamus, with the per-client price entered in Stripe's UI each time. A nicer flow:

- Admin opens `/admin/clients/[id]`, enters an amount (e.g. matching the client's proposal), clicks "Generate payment link."
- A new portal server action calls Stripe's API (using a server-only `STRIPE_SECRET_KEY`) to create a Payment Link with that amount and `client_reference_id` set to the client's UUID.
- The returned URL is auto-saved to that client's `project_links.payment.url`.

Benefits: zero manual Payment Link work; `client_reference_id` is always set so client matching is foolproof; payment amounts are version-controlled with the client record. Worth doing once the volume of clients makes manual link-creation feel painful, or when reliability of client matching becomes a priority over Shamus's setup ease.

### 5.2 Stripe — Refund (separate Zap)

**Goal:** notify admin and log when a charge is refunded. **No DB rollback.**

**Trigger:**
- App: **Stripe**
- Event: **New Refund** (or "Charge Refunded" — name varies)

**Zap steps:**

1. **Trigger:** Stripe → New Refund.
2. **Action:** PostgreSQL → **Find Row** in `activity_log`. Filter: `action = 'payment_completed' AND metadata->>stripe_payment_intent = {{trigger.payment_intent}}`. (You may need to use Zapier's "Custom Filter" syntax for the JSONB field. If the Supabase connector doesn't support JSONB filters, use Code by Zapier with a direct REST call to PostgREST.)
3. **Filter:** if Find Row returned a result, continue with client identification; otherwise fork to "orphan refund" path.
4. **Action (if matched):** PostgreSQL → **Find Row** in `clients`. id = `{{step2.client_id}}`.
5. **Action:** PostgreSQL → **New Row** in `activity_log`:
   - `client_id = {{step4.id}}`
   - `action = 'payment_refunded'`
   - `metadata = { stripe_charge_id, stripe_payment_intent, amount_refunded_cents, currency, reason }`
6. **Action:** Webhooks by Zapier → POST to `/api/notify-admin`. Subject: `Refund processed for {{step4.name}} ({{amount}})`. Paragraphs explain refund + stage left as-is. CTA links to `/admin/clients/{{step4.id}}`.

**Orphan-refund path** (no matching prior payment_completed log): notification only. Subject: `Refund processed (orphan)`. Paragraphs: amount + Stripe charge id + payment_intent.

### 5.3 PandaDoc — Document Signed (proposal or contract)

**Goal:** when a PandaDoc document is signed, mark the right `project_links` row as completed and (depending on which document) advance stage.

**Critical setup on PandaDoc side (Shamus's job).** Every document sent to a client must have **both** of these custom fields populated at create time:

| Custom field | Value | Why |
|---|---|---|
| `client_id` | the portal client's UUID (copy from `/admin/clients/[id]` URL) | Identifies which client the document belongs to. Email matching is unreliable — emails change, recipients can be CCs, etc. |
| `document_type` | exactly `proposal` or `contract` | Identifies which `link_type` row to update. Filtering on document name is fragile (typos, name changes); explicit document_type is unambiguous. |

If either field is missing on a signed document, the Zap notifies admin instead of writing to the DB. Document naming is for human readability and not relied on by automations.

**Trigger:**
- App: **PandaDoc**
- Event: **Document State Changed** with state filter = `document.completed` (signed by all parties), or **Document Completed** if the connector exposes that as a separate trigger.

**Zap steps:**

1. **Trigger:** PandaDoc → Document Completed.
2. **Filter:** Only continue if `document_type` custom field equals `proposal` (for the proposal Zap) or `contract` (build a separate Zap; same shape, different filter and different stage transition). Do **not** filter on document name — name is for humans, `document_type` is the contract.
3. **Action:** extract `client_id` from custom field. PostgreSQL → **Find Row** in `clients` by id.
4. **Filter:** only continue if client found.
5. **Action:** PostgreSQL → **Find Row** in `project_links` by `client_id` + `link_type = 'proposal'` (or `'contract'`).
6. **Action:** PostgreSQL → **Update Row** (or Create Row if not found): set `status = 'completed'`.
7. **Filter:** for the **proposal** Zap, only continue stage-advance if `clients.stage = 'discovery'`. Action: PostgreSQL → **Update Row** in `clients`, set `stage = 'proposal'`.
   For the **contract** Zap, only continue stage-advance if `clients.stage = 'proposal'`. Action: set `stage = 'contract'`.
8. **Action:** PostgreSQL → **New Row** in `activity_log`:
   - `action = 'proposal_signed'` or `'contract_signed'`
   - `metadata = { pandadoc_document_id, document_name, recipient_email, prior_stage, advanced_stage }`
9. **Action:** Webhooks by Zapier → POST to `/api/notify-admin`. Subject: `{{step3.name}} signed their {proposal|contract}`. Paragraphs explain + stage note. CTA to admin client page.

**Edge cases:**

- **Missing `client_id` custom field** → notification only, "PandaDoc {document name} signed but missing client_id custom field — manual reconciliation needed."
- **Missing `document_type` custom field** → neither the proposal Zap nor the contract Zap matches; document gets ignored silently. Add a third Zap that catches "document signed AND `document_type` is empty" and fires a notification: "Document signed without document_type custom field — manual reconciliation needed (document id: {{id}})."
- **`document_type` is something other than `proposal` or `contract`** → both Zaps' filters reject; same outcome as missing field. The catch-all Zap above also fires.
- **Both Zaps fire for one document** (shouldn't happen unless `document_type` is set wrong on PandaDoc side) → status updates are idempotent, but you'd get two notifications. Worth being careful when populating the field.

### 5.4 Typeform — Onboarding Form Submitted

**Goal:** when the onboarding Typeform is submitted, mark the onboarding `project_links` row as completed and advance stage Onboarding → Active.

**Critical setup on Typeform side (Shamus's job):** the onboarding form must include a **hidden field** named `client_id`. When generating the URL for a client, append `?client_id=<their-uuid>`. Typeform's Zapier trigger exposes hidden fields as part of the form response.

**Trigger:**
- App: **Typeform**
- Event: **New Entry** for the specific Typeform form (you'll select the form when configuring).

**Zap steps:**

1. **Trigger:** Typeform → New Entry.
2. **Filter:** Only continue if `hidden.client_id` is not blank.
3. **Action:** PostgreSQL → **Find Row** in `clients` by `id = {{trigger.hidden.client_id}}`.
4. **Filter:** only continue if found. Otherwise fork to notification: "Typeform submission with unknown client_id".
5. **Action:** PostgreSQL → **Find Row** in `project_links`, `client_id` + `link_type='onboarding'`. Update or Create with `status='completed'`.
6. **Filter / Path:** if `clients.stage = 'onboarding'`, PostgreSQL → **Update Row** in `clients` set `stage = 'active'`.
7. **Action:** PostgreSQL → **New Row** in `activity_log`. `action='onboarding_form_submitted'`. metadata: `{ typeform_response_id, hidden_fields, prior_stage, advanced_stage }`.
8. **Action:** Webhooks by Zapier → POST to `/api/notify-admin`. Subject: `{{step3.name}} submitted their onboarding form`.

**Edge cases:**
- **No hidden client_id** (someone shared the bare form URL or a client clicked a stale link) → notification: "Onboarding form submitted without client_id — manual reconciliation needed (response id: {{id}})."
- **Submission fires while client.stage isn't 'onboarding'** (e.g. they're already 'active' — they re-submitted) → status stays 'completed', no stage change, notification still fires.

### 5.5 SavvyCal — Kickoff Call Scheduled

**Goal:** when a client books their kickoff call, mark the kickoff `project_links` row as completed (the call being booked is good enough — we don't track post-call). No stage advance.

**Identifying the client:** SavvyCal exposes the booker's email. Match against `clients.email`.

**Trigger:**
- App: **SavvyCal**
- Event: **New Booking** (or whatever the connector calls a confirmed event scheduling).

**Zap steps:**

1. **Trigger:** SavvyCal → New Booking.
2. **Action:** PostgreSQL → **Find Row** in `clients` by `email = {{trigger.attendee.email}}`.
3. **Filter:** only continue if found.
4. **Action:** Supabase → Find/Update/Create in `project_links` for `kickoff` link_type. Set `status='completed'`.
5. **Action:** Supabase → Create Row in `activity_log`. `action='kickoff_scheduled'`. metadata: `{ savvycal_event_id, scheduled_at, scheduling_url }`.
6. **Action:** Webhooks by Zapier → POST to `/api/notify-admin`. Subject: `{{step2.name}} booked their kickoff call`.

**Edge cases:**
- **Email doesn't match any client** → notification: "Kickoff booked by {{email}} — no matching portal client. Manual reconciliation needed."
- **SavvyCal cancellation** (separate event, possibly a separate Zap): set `status` back to `pending`? Or leave as-is and just notify? **My recommendation: notify only, leave status alone** — consistent with the no-rollback rule for Stripe refunds. Re-scheduling will re-fire the booking Zap.

### 5.6 Day.ai — Bidirectional sync (decision pending)

**Two use cases mentioned:**
- **A:** Portal pushes activity to Day.ai. When something happens in the portal (client logs in, client views a link, admin sends an invite), a record is added to Day.ai's timeline for that contact.
- **B:** Day.ai contacts → portal clients. When Shamus adds a contact in Day.ai with a "becomes a client" tag (or moves them to a stage), automatically create a row in our `clients` table.

**Open questions to resolve before building:**
1. **Does Day.ai have a first-party Zapier app?** As of late 2025, Day.ai's integration story is uneven — they've published webhooks and an API but Zapier presence varies. Verify by searching the Zapier App Directory.
2. **If no Zapier app:** use Webhooks by Zapier in/out of Day.ai's API.
3. **Use case A trigger source:** the portal doesn't currently emit events Zapier can listen to. We have two ways to feed activity into a Zap:
   - **Polling:** Zapier polls Supabase's `activity_log` table on a schedule (every N minutes), forwards new rows to Day.ai. Simple but laggy.
   - **Push:** the portal POSTs to a Zapier webhook URL on activity events. Real-time but requires a small portal change (similar to the `/api/notify-admin` pattern).
4. **Use case B mapping:** when Day.ai sends us a new contact, what fields map to our `clients` columns? Need a clear field-to-field plan.

**Recommendation:** defer Day.ai until 5.1–5.4 are working. We'll do a focused planning session for Day.ai once we know the exact shape of their Zapier integration (or API).

---

## 6. Recommended build order

Build incrementally. Don't move on until each Zap has been tested with a real (or test-mode) event end-to-end.

1. **Portal-side: build `/api/notify-admin`** (one-time portal task — see §3.1). Test by curling it locally and from a Zapier Webhooks step.
2. **Zapier-side: set up the PostgreSQL connection** to Supabase (§2). Test by running a simple "Find Row in clients" step and confirming Ada's row comes back.
3. **Zap 1: Stripe — Payment Completed** (§5.1). Trigger a test-mode Payment Link with a real `client_reference_id`, watch the Zap run.
4. **Zap 2: Stripe — Refund** (§5.2). Refund the test-mode payment from step 3 and watch the orphan-vs-matched paths.
5. **Zap 3: PandaDoc — Proposal Signed** (§5.3). Send a test document to yourself, sign it, watch the Zap.
6. **Zap 4: PandaDoc — Contract Signed** (separate Zap, same shape).
7. **Zap 5: Typeform — Onboarding Submitted** (§5.4). Submit a test response with hidden client_id.
8. **Zap 6: SavvyCal — Kickoff Scheduled** (§5.5). Book a test event.
9. **Day.ai planning session** (§5.6) — only after the above are working.

Each Zap should be left **OFF** in Zapier until tested with at least one real event in test mode (where applicable) or one synthetic event (Stripe CLI, PandaDoc test send, etc.). Once tested, turn on.

---

## 7. Testing approach per integration

### 7.1 Stripe

- Test mode is the natural sandbox. Create a real Payment Link in Stripe **test mode**, set `client_reference_id` to Ada's UUID, pay it with `4242 4242 4242 4242` / any future expiry / any CVC.
- For refunds: in the Stripe dashboard (test mode), click the test payment, "Refund payment." Refund event fires.
- The same Zap shape will work in live mode — you'll just flip the Zap's Stripe connection to the live account when ready.

### 7.2 PandaDoc

- PandaDoc has a sandbox / test mode. Send yourself a test document with a `client_id` custom field, sign it, watch the Zap run.

### 7.3 Typeform

- Submit a response with a hidden `client_id` matching Ada's UUID using `https://your-typeform-url?client_id=<ada-uuid>`.

### 7.4 SavvyCal

- Book a test event using your own email (matching an existing portal client's email — easiest is to set Ada's email to your real email temporarily for testing).

### 7.5 Day.ai

- TBD per §5.6.

### General

- Use Zapier's **Zap History** liberally during testing — it shows the input, output, and any error per step.
- After every Zap test, verify:
  - The right `project_links` row updated to `completed`.
  - The right `activity_log` row appeared (visible on `/admin`'s Recent activity feed).
  - Stage advanced if applicable.
  - Branded notification email arrived in your inbox.

---

## 8. Open questions / decisions still to make

- **JSONB metadata in PG connector:** the `activity_log.metadata` column is JSONB. Zapier's PostgreSQL "New Row" action may or may not handle JSONB cleanly via the column-by-column UI. If it doesn't, fall back to the **SQL Statement** action with a parameterized `insert into activity_log (...) values (..., '{...}'::jsonb)` query. Verify when building the first Zap that touches activity_log.
- **Activity_log dedup:** for v1, accept that retries can produce duplicate rows. Revisit if the recent-activity feed becomes noisy.
- **Day.ai integration shape:** see §5.6.
- **Live Stripe rollover:** when to switch from test mode to live. After at least one real client has run through the test-mode flow successfully.
- **Zap maintenance ownership:** Shamus owns the source-app accounts (Stripe, PandaDoc, Typeform, SavvyCal, Day.ai). Angel owns the portal. Zaps span both. Establish who's on the hook for fixing Zaps when they break — probably both, with the Zapier workspace being a shared resource.

---

## Summary

- **One portal change required**: build `/api/notify-admin` so Zaps can fire branded emails through the existing scaffolder. Everything else is configured in Zapier.
- **One database role required**: create a `zapier` Postgres role with narrowed permissions and BYPASSRLS, used by Zapier's PostgreSQL connector (Supabase has no first-party Zapier app).
- **Five Zaps to build initially** (Stripe payment, Stripe refund, PandaDoc proposal, PandaDoc contract, Typeform, SavvyCal). Day.ai deferred to a separate planning session.
- **Stage advancement is conservative**: only advance forward, only when prior stage matches expectation, otherwise leave alone and warn in the notification.
- **No DB rollback on refunds/cancellations** — log + notify only.
