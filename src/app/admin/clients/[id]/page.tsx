import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { SignOutButton } from "@/components/sign-out-button";
import type { ClientStage, LinkStatus, LinkType } from "../../constants";
import { InviteButton } from "../../invite-button";
import { EditClientForm } from "./edit-form";
import { DeleteClientDialog } from "./delete-client-dialog";

export default async function ClientDetailPage({
  params,
}: {
  params: { id: string };
}) {
  const supabase = createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    redirect("/login");
  }

  if (user.email !== process.env.ADMIN_EMAIL) {
    redirect("/dashboard");
  }

  const { data: client } = await supabase
    .from("clients")
    .select("id, name, email, company, stage")
    .eq("id", params.id)
    .maybeSingle();

  if (!client) {
    notFound();
  }

  const { data: links } = await supabase
    .from("project_links")
    .select("link_type, url, status")
    .eq("client_id", client.id);

  type LinkRow = { link_type: LinkType; url: string | null; status: LinkStatus };
  const linksByType = new Map<LinkType, LinkRow>();
  (links ?? []).forEach((l) => linksByType.set(l.link_type as LinkType, l as LinkRow));

  return (
    <main className="min-h-screen p-8">
      <div className="max-w-3xl mx-auto space-y-8">
        <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
          <div className="space-y-1">
            <Link
              href="/admin"
              className="text-sm text-muted-foreground hover:text-foreground"
            >
              ← Back to clients
            </Link>
            <h1 className="text-3xl font-semibold tracking-tight">
              {client.name}
            </h1>
          </div>
          <div className="flex items-center gap-2">
            <InviteButton
              clientId={client.id}
              clientEmail={client.email}
              variant="outline"
              size="default"
            />
            <SignOutButton />
          </div>
        </div>

        <EditClientForm
          client={{
            id: client.id,
            name: client.name,
            email: client.email,
            company: client.company,
            stage: client.stage as ClientStage,
          }}
          links={Object.fromEntries(
            Array.from(linksByType.entries()).map(([k, v]) => [
              k,
              { url: v.url, status: v.status },
            ])
          )}
        />

        <DeleteClientDialog clientId={client.id} clientName={client.name} />
      </div>
    </main>
  );
}
