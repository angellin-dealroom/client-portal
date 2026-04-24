"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import {
  CLIENT_STAGES,
  LINK_STATUSES,
  LINK_TYPES,
  type ClientStage,
  type LinkStatus,
} from "./constants";

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
