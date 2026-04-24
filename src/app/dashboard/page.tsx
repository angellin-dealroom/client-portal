import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { SignOutButton } from "@/components/sign-out-button";
import { cn } from "@/lib/utils";
import { LinkCard, type LinkMeta, type ProjectLink } from "./link-card";

const LINK_META: Record<string, LinkMeta> = {
  proposal:   { label: "Proposal",        description: "Review and sign your proposal." },
  contract:   { label: "Contract",        description: "Review and sign your service agreement." },
  payment:    { label: "Payment",         description: "Complete your initial payment." },
  kickoff:    { label: "Kickoff call",    description: "Book a kickoff call with us." },
  onboarding: { label: "Onboarding form", description: "Fill out the onboarding form." },
};

const LINK_ORDER = ["proposal", "contract", "payment", "kickoff", "onboarding"] as const;

const STAGES = ["discovery", "proposal", "contract", "onboarding", "active"] as const;
const STAGE_LABELS: Record<string, string> = {
  discovery: "Discovery",
  proposal: "Proposal",
  contract: "Contract",
  onboarding: "Onboarding",
  active: "Active",
  churned: "Churned",
};

export default async function DashboardPage() {
  const supabase = createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    redirect("/login");
  }

  if (user.email === process.env.ADMIN_EMAIL) {
    redirect("/admin");
  }

  const { data: client } = await supabase
    .from("clients")
    .select("id, name, company, stage, email")
    .eq("email", user.email ?? "")
    .maybeSingle();

  if (!client) {
    return (
      <main className="min-h-screen p-8">
        <div className="max-w-3xl mx-auto space-y-6">
          <div className="flex items-center justify-between">
            <h1 className="text-3xl font-semibold tracking-tight">Dashboard</h1>
            <SignOutButton />
          </div>
          <p className="text-muted-foreground">
            We couldn&apos;t find a client record for {user.email}. Please
            contact your account manager.
          </p>
        </div>
      </main>
    );
  }

  const { data: linksData } = await supabase
    .from("project_links")
    .select("id, link_type, url, status")
    .eq("client_id", client.id);

  const linksByType = new Map<string, ProjectLink>();
  (linksData ?? []).forEach((l) => linksByType.set(l.link_type, l as ProjectLink));

  const isChurned = client.stage === "churned";
  const currentStageIndex = STAGES.indexOf(client.stage as (typeof STAGES)[number]);

  return (
    <main className="min-h-screen p-8">
      <div className="max-w-4xl mx-auto space-y-10">
        <div className="flex items-center justify-between">
          <h1 className="text-3xl font-semibold tracking-tight">Dashboard</h1>
          <SignOutButton />
        </div>

        <section className="space-y-3">
          <p className="text-2xl">
            Hi, <span className="font-medium">{client.name}</span>.
          </p>
          {isChurned ? (
            <p className="text-sm text-muted-foreground">
              Your account is no longer active.
            </p>
          ) : (
            <div className="space-y-2">
              <p className="text-sm text-muted-foreground">Current stage</p>
              <div className="flex flex-wrap items-center gap-1 text-sm">
                {STAGES.map((stage, i) => (
                  <span key={stage} className="flex items-center gap-1">
                    <span
                      className={cn(
                        "px-2 py-0.5 rounded-md",
                        i === currentStageIndex
                          ? "bg-primary text-primary-foreground font-medium"
                          : i < currentStageIndex
                          ? "text-foreground"
                          : "text-muted-foreground"
                      )}
                    >
                      {STAGE_LABELS[stage]}
                    </span>
                    {i < STAGES.length - 1 && (
                      <span className="text-muted-foreground" aria-hidden>
                        →
                      </span>
                    )}
                  </span>
                ))}
              </div>
            </div>
          )}
        </section>

        <section className="space-y-4">
          <h2 className="text-lg font-medium">Your documents &amp; steps</h2>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {LINK_ORDER.map((linkType) => (
              <LinkCard
                key={linkType}
                meta={LINK_META[linkType]}
                link={linksByType.get(linkType) ?? null}
              />
            ))}
          </div>
        </section>
      </div>
    </main>
  );
}
