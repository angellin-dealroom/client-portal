"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { resend } from "@/lib/resend";
import {
  CLIENT_STAGES,
  LINK_STATUSES,
  LINK_TYPES,
  type ClientStage,
  type LinkStatus,
} from "./constants";

const SITE_URL =
  process.env.NEXT_PUBLIC_SITE_URL ?? "https://client-portal-five-chi.vercel.app";

const FROM_ADDRESS = "Dealroom Media <noreply@dealroom.media>";

function inviteEmailHtml(name: string, inviteLink: string): string {
  return `<!doctype html>
<html>
  <body style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; max-width: 580px; margin: 0 auto; padding: 24px; color: #18181b; line-height: 1.55;">
    <p>Hi ${escapeHtml(name)},</p>
    <p>Your client portal is ready. This is where you'll find everything for our work together, including your proposal, contract, payment, kickoff call, and onboarding. As things move along, you'll see new items appear here.</p>
    <p>Click the button below to log in.</p>
    <p style="margin: 24px 0;">
      <a href="${inviteLink}" style="display: inline-block; padding: 12px 20px; background: #18181b; color: #fafafa; text-decoration: none; border-radius: 6px; font-weight: 500;">Sign in to your portal</a>
    </p>
    <p>A few things to know about the link:</p>
    <ul>
      <li>It expires in 1 hour</li>
      <li>It can only be used once &mdash; after you click it and log in, you'll need a new link to sign in again</li>
      <li>If it expires or you need a new one, just go to <a href="${SITE_URL}/login">${SITE_URL.replace(/^https?:\/\//, "")}/login</a> and enter your email</li>
    </ul>
    <p>Talk soon,<br>Shamus</p>
  </body>
</html>`;
}

function inviteEmailText(name: string, inviteLink: string): string {
  return `Hi ${name},

Your client portal is ready. This is where you'll find everything for our work together, including your proposal, contract, payment, kickoff call, and onboarding. As things move along, you'll see new items appear here.

Click the link below to log in.

${inviteLink}

A few things to know about the link:

- It expires in 1 hour
- It can only be used once — after you click it and log in, you'll need a new link to sign in again
- If it expires or you need a new one, just go to ${SITE_URL}/login and enter your email

Talk soon,
Shamus
`;
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

const VALID_STAGES: ReadonlySet<ClientStage> = new Set<ClientStage>(CLIENT_STAGES);
const VALID_STATUSES: ReadonlySet<LinkStatus> = new Set<LinkStatus>(LINK_STATUSES);

type ActionResult = { ok: true } | { ok: false; error: string };

async function requireAdmin() {
  const supabase = createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user || user.email !== process.env.ADMIN_EMAIL) {
    return { supabase, user: null };
  }
  return { supabase, user };
}

export async function createNewClient(formData: FormData): Promise<ActionResult> {
  const { supabase, user } = await requireAdmin();
  if (!user) return { ok: false, error: "Not authorized" };

  const name = String(formData.get("name") ?? "").trim();
  const email = String(formData.get("email") ?? "").trim().toLowerCase();
  const companyRaw = String(formData.get("company") ?? "").trim();
  const company = companyRaw.length > 0 ? companyRaw : null;

  if (!name) return { ok: false, error: "Name is required" };
  if (!email) return { ok: false, error: "Email is required" };
  if (!/.+@.+\..+/.test(email)) return { ok: false, error: "Email looks invalid" };

  const { error } = await supabase.from("clients").insert({ name, email, company });

  if (error) {
    if (error.code === "23505") {
      return { ok: false, error: "A client with that email already exists" };
    }
    return { ok: false, error: error.message };
  }

  revalidatePath("/admin");
  return { ok: true };
}

export async function updateClientStage(
  clientId: string,
  stage: ClientStage
): Promise<ActionResult> {
  const { supabase, user } = await requireAdmin();
  if (!user) return { ok: false, error: "Not authorized" };

  if (!VALID_STAGES.has(stage)) {
    return { ok: false, error: "Invalid stage" };
  }

  const { error } = await supabase
    .from("clients")
    .update({ stage })
    .eq("id", clientId);

  if (error) return { ok: false, error: error.message };

  revalidatePath("/admin");
  return { ok: true };
}

export async function sendClientInvite(clientId: string): Promise<ActionResult> {
  const { supabase, user } = await requireAdmin();
  if (!user) return { ok: false, error: "Not authorized" };

  const { data: client, error: lookupErr } = await supabase
    .from("clients")
    .select("id, name, email")
    .eq("id", clientId)
    .maybeSingle();

  if (lookupErr) return { ok: false, error: lookupErr.message };
  if (!client) return { ok: false, error: "Client not found" };

  const adminClient = createAdminClient();

  // Ensure an auth.users row exists for this email. Idempotent: if the
  // user already exists we ignore the "already registered" error and
  // continue to the magic-link generation step.
  const { error: createErr } = await adminClient.auth.admin.createUser({
    email: client.email,
    email_confirm: true,
  });
  if (
    createErr &&
    !/already (been )?registered|already exists/i.test(createErr.message)
  ) {
    return { ok: false, error: `createUser: ${createErr.message}` };
  }

  // Generate a fresh magic-link token.
  const { data: linkData, error: linkErr } =
    await adminClient.auth.admin.generateLink({
      type: "magiclink",
      email: client.email,
      options: {
        redirectTo: `${SITE_URL}/auth/callback`,
      },
    });

  if (linkErr) return { ok: false, error: `generateLink: ${linkErr.message}` };

  const tokenHash = linkData?.properties?.hashed_token;
  if (!tokenHash) {
    return { ok: false, error: "Failed to extract token hash from Supabase" };
  }

  const inviteLink = `${SITE_URL}/auth/callback?token_hash=${tokenHash}&type=magiclink`;

  const { error: sendErr } = await resend.emails.send({
    from: FROM_ADDRESS,
    to: client.email,
    subject: "Welcome to your Dealroom Media client portal",
    html: inviteEmailHtml(client.name, inviteLink),
    text: inviteEmailText(client.name, inviteLink),
  });

  if (sendErr) return { ok: false, error: `Resend: ${sendErr.message}` };

  return { ok: true };
}

export async function deleteClient(clientId: string): Promise<ActionResult> {
  const { supabase, user } = await requireAdmin();
  if (!user) return { ok: false, error: "Not authorized" };

  const { error } = await supabase.from("clients").delete().eq("id", clientId);

  if (error) return { ok: false, error: error.message };

  revalidatePath("/admin");
  return { ok: true };
}

export async function saveClient(
  clientId: string,
  formData: FormData
): Promise<ActionResult> {
  const { supabase, user } = await requireAdmin();
  if (!user) return { ok: false, error: "Not authorized" };

  const name = String(formData.get("name") ?? "").trim();
  const companyRaw = String(formData.get("company") ?? "").trim();
  const company = companyRaw.length > 0 ? companyRaw : null;
  const stage = String(formData.get("stage") ?? "") as ClientStage;

  if (!name) return { ok: false, error: "Name is required" };
  if (!VALID_STAGES.has(stage)) return { ok: false, error: "Invalid stage" };

  const { error: clientErr } = await supabase
    .from("clients")
    .update({ name, company, stage })
    .eq("id", clientId);

  if (clientErr) return { ok: false, error: `Client: ${clientErr.message}` };

  for (const linkType of LINK_TYPES) {
    const urlRaw = String(formData.get(`${linkType}_url`) ?? "").trim();
    const url = urlRaw.length > 0 ? urlRaw : null;
    const status = String(formData.get(`${linkType}_status`) ?? "pending") as LinkStatus;

    if (!VALID_STATUSES.has(status)) {
      return { ok: false, error: `Invalid status for ${linkType}` };
    }

    const { error: linkErr } = await supabase
      .from("project_links")
      .upsert(
        { client_id: clientId, link_type: linkType, url, status },
        { onConflict: "client_id,link_type" }
      );

    if (linkErr) {
      return { ok: false, error: `${linkType}: ${linkErr.message}` };
    }
  }

  revalidatePath("/admin");
  revalidatePath(`/admin/clients/${clientId}`);
  return { ok: true };
}
