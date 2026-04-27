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
| **Supabase** | Action: read/write rows in our `clients`, `project_links`, `activity_log` tables | Built-in Zapier app. One connection used by all Zaps. See §2 for setup. |
| **Webhooks by Zapier** | Action: POST to our portal's `/api/notify-admin` endpoint to send branded notification emails (see §3) | Built-in. No external auth — uses a shared secret set as a Zapier connection or per-Zap header. |

You don't need separate Resend or Gmail connectors if you go with the recommended notification strategy in §3.

---

## 2. Supabase connector setup

The Zapier Supabase connector needs credentials with permission to read and write our three tables. Two viable approaches; we recommend the second.

### Option A — service role key (simplest, broader blast radius)

Use the same `SUPABASE_SERVICE_ROLE_KEY` already in `.env.local` and Vercel. This bypasses RLS entirely — Zapier can read/write everything.

**Trade-off:** anyone with access to the Zapier workspace effectively has full database access. Acceptable if Shamus and Angel are the only Zapier admins.

### Option B — dedicated Zapier role (recommended)

Create a Postgres role with permissions narrowed to exactly what the Zaps need. Run this once in **Supabase → SQL Editor** (call it migration `0003_zapier_role.sql` if you want it tracked):

```sql
-- Dedicated role for Zapier. Bypasses RLS (BYPASSRLS) so it can write
-- to clients/project_links/activity_log without a JWT, but only on
-- the public schema and only on those tables.
create role zapier with login bypassrls password '<generate-a-strong-password>';

grant usage on schema public to zapier;
grant select, insert, update on public.clients       to zapier;
grant select, insert, update on public.project_links to zapier;
grant select, insert         on public.activity_log  to zapier;

-- No delete grants — Zapier should never delete rows. If a Zap needs
-- to delete (unlikely), grant explicitly.

-- For UUID generation on inserts — usually inherited but be explicit.
grant execute on function public.gen_random_uuid() to zapier;
```

Then in **Supabase → Project Settings → Database** find the **Connection string** for the `zapier` role and use that in Zapier's Supabase connector setup.

Zapier's Supabase connector typically asks for:
- **Project URL**: `https://nzyugdbdsvpeipqbqxdg.supabase.co`
- **API key**: paste the service role key (Option A) **or** if Zapier supports custom DB connections, use the `zapier` role's connection string (Option B)

**Note:** as of late 2025, the Zapier Supabase app uses the REST API (PostgREST) and accepts an API key, not a direct Postgres connection. The REST API only respects keys issued by Supabase Auth (anon, service role) — custom Postgres roles aren't selectable through the connector. **In practice this means Option A (service role) is what you'll use** unless the Zapier connector has been updated to support custom roles. Verify when you go to set it up; if Option B isn't available through the connector, fall back to Option A and treat the Zapier workspace access as a security boundary.

### RLS considerations

Service role bypasses RLS, so Zaps can read/write everything regardless of policies. This is correct for our use case — Zaps are operating on behalf of you (the admin), not on behalf of a logged-in client.

The browser-side anon key still goes through RLS as before. Nothing about the existing client/admin login flow changes.

### Where the API key lives

In Zapier, store the service role key as part of the Supabase **connection** (set up once under Account Settings → Connections, then reused across all Zaps). Don't paste it as a per-step variable — connections are encrypted; per-step values can leak in step-history views.

In our codebase, the same value already lives in `.env.local` (local) and Vercel env vars (production). Zapier's copy is a third location. If the key is rotated, all three places need updating.

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

**Identifying the client:**
- Shamus must set `client_reference_id` on the Payment Link to the portal client's UUID when creating the link. This is the same plan we had for webhooks.
- The trigger output exposes `client_reference_id`.

**Zap steps:**

1. **Trigger:** Stripe → New Checkout Session Completed.
2. **Filter:** Only continue if `client_reference_id` is not blank. If blank, fork to a "send admin notification — payment without client_reference_id" path (see edge cases below) and stop.
3. **Action:** Supabase → **Find Row**. Table: `clients`. Filter: `id = {{trigger.client_reference_id}}`. Sets up the next steps with the client's name, email, and current stage.
4. **Filter:** only continue if Find Row returned a result. Otherwise fork to "send notification — unknown client_reference_id" and stop.
5. **Action:** Supabase → **Find Row** in `project_links`. Filter: `client_id = {{step3.id}} AND link_type = 'payment'`. Captures the row's id (or null if it doesn't exist yet).
6. **Path A — payment row exists:** Supabase → **Update Row** in `project_links`. Row id = `{{step5.id}}`. Set `status = 'completed'`.
7. **Path B — payment row doesn't exist:** Supabase → **Create Row** in `project_links`. `client_id`, `link_type='payment'`, `status='completed'`, `url=null`.
8. **Path / Filter:** Only if `step3.stage = 'contract'`, then Supabase → **Update Row** in `clients`. Row id = `{{step3.id}}`. Set `stage = 'onboarding'`.
9. **Action:** Supabase → **Create Row** in `activity_log`:
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

- **No `client_reference_id`** → notification only ("Stripe payment without client_reference_id — Stripe session: {{id}}"). Don't write to DB.
- **`client_reference_id` doesn't match any client** → notification only ("Stripe payment with unknown client_reference_id: {{ref}} — Stripe session: {{id}}"). Don't write to DB.
- **Stripe retries the event** (Zapier will dedupe based on the event ID, but only within one Zap run; if Zapier has been off, the same event could process twice). Acceptable for now — duplicates produce extra activity_log rows but no broken state. If it becomes a problem, add a unique constraint or a Zapier "Storage by Zapier" step keyed by event ID.

### 5.2 Stripe — Refund (separate Zap)

**Goal:** notify admin and log when a charge is refunded. **No DB rollback.**

**Trigger:**
- App: **Stripe**
- Event: **New Refund** (or "Charge Refunded" — name varies)

**Zap steps:**

1. **Trigger:** Stripe → New Refund.
2. **Action:** Supabase → **Find Row** in `activity_log`. Filter: `action = 'payment_completed' AND metadata->>stripe_payment_intent = {{trigger.payment_intent}}`. (You may need to use Zapier's "Custom Filter" syntax for the JSONB field. If the Supabase connector doesn't support JSONB filters, use Code by Zapier with a direct REST call to PostgREST.)
3. **Filter:** if Find Row returned a result, continue with client identification; otherwise fork to "orphan refund" path.
4. **Action (if matched):** Supabase → **Find Row** in `clients`. id = `{{step2.client_id}}`.
5. **Action:** Supabase → **Create Row** in `activity_log`:
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
3. **Action:** extract `client_id` from custom field. Supabase → **Find Row** in `clients` by id.
4. **Filter:** only continue if client found.
5. **Action:** Supabase → **Find Row** in `project_links` by `client_id` + `link_type = 'proposal'` (or `'contract'`).
6. **Action:** Supabase → **Update Row** (or Create Row if not found): set `status = 'completed'`.
7. **Filter:** for the **proposal** Zap, only continue stage-advance if `clients.stage = 'discovery'`. Action: Supabase → **Update Row** in `clients`, set `stage = 'proposal'`.
   For the **contract** Zap, only continue stage-advance if `clients.stage = 'proposal'`. Action: set `stage = 'contract'`.
8. **Action:** Supabase → **Create Row** in `activity_log`:
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
3. **Action:** Supabase → **Find Row** in `clients` by `id = {{trigger.hidden.client_id}}`.
4. **Filter:** only continue if found. Otherwise fork to notification: "Typeform submission with unknown client_id".
5. **Action:** Supabase → **Find Row** in `project_links`, `client_id` + `link_type='onboarding'`. Update or Create with `status='completed'`.
6. **Filter / Path:** if `clients.stage = 'onboarding'`, Supabase → **Update Row** in `clients` set `stage = 'active'`.
7. **Action:** Supabase → **Create Row** in `activity_log`. `action='onboarding_form_submitted'`. metadata: `{ typeform_response_id, hidden_fields, prior_stage, advanced_stage }`.
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
2. **Action:** Supabase → **Find Row** in `clients` by `email = {{trigger.attendee.email}}`.
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
2. **Zapier-side: set up the Supabase connection** with the service role key (§2). Test by running a simple "Find Row in clients" step and confirming Ada's row comes back.
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

- **Supabase connector auth:** confirm whether Zapier's current Supabase app supports custom Postgres roles or only the Supabase API keys. Likely the latter — go with service role and treat Zapier workspace access as a security boundary (§2).
- **Activity_log dedup:** for v1, accept that retries can produce duplicate rows. Revisit if the recent-activity feed becomes noisy.
- **Day.ai integration shape:** see §5.6.
- **Live Stripe rollover:** when to switch from test mode to live. After at least one real client has run through the test-mode flow successfully.
- **Zap maintenance ownership:** Shamus owns the source-app accounts (Stripe, PandaDoc, Typeform, SavvyCal, Day.ai). Angel owns the portal. Zaps span both. Establish who's on the hook for fixing Zaps when they break — probably both, with the Zapier workspace being a shared resource.

---

## Summary

- **One portal change required**: build `/api/notify-admin` so Zaps can fire branded emails through the existing scaffolder. Everything else is configured in Zapier.
- **One database role change recommended** (but not required): create a `zapier` Postgres role with narrowed permissions. Likely not usable through the Zapier connector — fall back to service role.
- **Five Zaps to build initially** (Stripe payment, Stripe refund, PandaDoc proposal, PandaDoc contract, Typeform, SavvyCal). Day.ai deferred to a separate planning session.
- **Stage advancement is conservative**: only advance forward, only when prior stage matches expectation, otherwise leave alone and warn in the notification.
- **No DB rollback on refunds/cancellations** — log + notify only.
