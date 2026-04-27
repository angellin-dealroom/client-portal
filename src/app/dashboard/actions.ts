"use server";

import { createClient } from "@/lib/supabase/server";
import { resend } from "@/lib/resend";
import {
  brandedEmailHtml,
  brandedEmailText,
  type EmailContent,
} from "@/lib/email-template";
import type { LinkType } from "@/app/admin/constants";

const SITE_URL =
  process.env.NEXT_PUBLIC_SITE_URL ?? "https://client-portal-five-chi.vercel.app";

const FROM_ADDRESS = "Dealroom Media <noreply@dealroom.media>";

const LINK_LABEL_LOWER: Record<LinkType, string> = {
  proposal: "proposal",
  contract: "contract",
  payment: "payment",
  kickoff: "kickoff call",
  onboarding: "onboarding form",
};

const STAGE_LABEL: Record<string, string> = {
  discovery: "Discovery",
  proposal: "Proposal",
  contract: "Contract",
  onboarding: "Onboarding",
  active: "Active",
  churned: "Churned",
};

type ActionResult = { ok: true } | { ok: false; error: string };

type LinkBeforeRow = {
  status: "pending" | "viewed" | "completed";
  link_type: LinkType;
  client_id: string;
  client: { name: string; email: string; stage: string } | null;
};

export async function recordLinkClick(linkId: string): Promise<ActionResult> {
  const supabase = createClient();

  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { ok: false, error: "Not authenticated" };

  // Read current state under the user's session (RLS lets clients SELECT
  // their own rows; admin can SELECT anything).
  const { data: linkBeforeRaw, error: lookupErr } = await supabase
    .from("project_links")
    .select("status, link_type, client_id, client:clients!inner(name, email, stage)")
    .eq("id", linkId)
    .maybeSingle();

  if (lookupErr) return { ok: false, error: lookupErr.message };
  if (!linkBeforeRaw) return { ok: false, error: "Link not found" };

  const linkBefore = linkBeforeRaw as unknown as LinkBeforeRow;
  const wasFirstView = linkBefore.status === "pending";

  // Run the SECURITY DEFINER RPC. It does its own caller-owns-link check
  // and bumps status pending -> viewed plus inserts an activity_log row.
  const { error: rpcErr } = await supabase.rpc("record_link_click", {
    p_link_id: linkId,
  });
  if (rpcErr) return { ok: false, error: rpcErr.message };

  // Fire-and-forget admin notification on first view only. We don't await
  // it: notification failures should never surface to the client. Errors
  // are logged for the server logs.
  if (wasFirstView && linkBefore.client) {
    void notifyAdminFirstView({
      clientId: linkBefore.client_id,
      clientName: linkBefore.client.name,
      clientEmail: linkBefore.client.email,
      clientStage: linkBefore.client.stage,
      linkType: linkBefore.link_type,
    }).catch((err) => {
      console.error("Admin first-view notification failed:", err);
    });
  }

  return { ok: true };
}

async function notifyAdminFirstView(params: {
  clientId: string;
  clientName: string;
  clientEmail: string;
  clientStage: string;
  linkType: LinkType;
}): Promise<void> {
  const adminEmail = process.env.ADMIN_EMAIL;
  if (!adminEmail) return;

  const linkLabel = LINK_LABEL_LOWER[params.linkType] ?? params.linkType;
  const stageLabel = STAGE_LABEL[params.clientStage] ?? params.clientStage;
  const adminLink = `${SITE_URL}/admin/clients/${params.clientId}`;

  const content: EmailContent = {
    preheader: "First view of this link in their portal.",
    greeting: "Heads up,",
    blocks: [
      {
        kind: "text",
        content: `${params.clientName} (${params.clientEmail}) just viewed the ${linkLabel} link in their portal.`,
      },
      {
        kind: "text",
        content: `Their stage is ${stageLabel}.`,
      },
      {
        kind: "cta",
        label: "Open in admin →",
        url: adminLink,
      },
    ],
  };

  const { error } = await resend.emails.send({
    from: FROM_ADDRESS,
    to: adminEmail,
    subject: `${params.clientName} viewed their ${linkLabel} link`,
    html: brandedEmailHtml(content),
    text: brandedEmailText(content),
  });

  if (error) {
    throw new Error(`Resend: ${error.message}`);
  }
}
