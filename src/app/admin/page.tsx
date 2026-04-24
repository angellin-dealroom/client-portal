import Link from "next/link";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { SignOutButton } from "@/components/sign-out-button";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { NewClientDialog } from "./new-client-dialog";
import { StageCell } from "./stage-cell";
import type { ClientStage } from "./constants";

function formatDateTime(iso: string): string {
  return new Date(iso).toLocaleString(undefined, {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

function describeActivity(
  action: string,
  metadata: Record<string, unknown> | null
): string {
  if (action === "viewed_link" && metadata && typeof metadata.link_type === "string") {
    return `viewed ${metadata.link_type} link`;
  }
  return action;
}

type ActivityRow = {
  id: string;
  action: string;
  metadata: Record<string, unknown> | null;
  created_at: string;
  client: { name: string; email: string } | null;
};

export default async function AdminPage() {
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

  const [clientsResult, activityResult] = await Promise.all([
    supabase
      .from("clients")
      .select("id, name, email, company, stage, updated_at")
      .order("created_at", { ascending: false }),
    supabase
      .from("activity_log")
      .select("id, action, metadata, created_at, client:clients(name, email)")
      .order("created_at", { ascending: false })
      .limit(50),
  ]);

  const clients = clientsResult.data ?? [];
  const activity = (activityResult.data ?? []) as unknown as ActivityRow[];

  return (
    <main className="min-h-screen p-8">
      <div className="max-w-6xl mx-auto space-y-10">
        <div className="flex items-center justify-between">
          <h1 className="text-3xl font-semibold tracking-tight">Admin</h1>
          <SignOutButton />
        </div>

        <section className="space-y-4">
          <div className="flex items-center justify-between">
            <h2 className="text-lg font-medium">
              Clients{" "}
              <span className="text-muted-foreground font-normal">
                ({clients.length})
              </span>
            </h2>
            <NewClientDialog />
          </div>

          {clients.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              No clients yet. Click <span className="font-medium">New client</span> to add one.
            </p>
          ) : (
            <div className="border rounded-md">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Name</TableHead>
                    <TableHead>Company</TableHead>
                    <TableHead>Email</TableHead>
                    <TableHead>Stage</TableHead>
                    <TableHead>Last updated</TableHead>
                    <TableHead className="w-[80px]"></TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {clients.map((c) => (
                    <TableRow key={c.id}>
                      <TableCell className="font-medium">{c.name}</TableCell>
                      <TableCell>{c.company ?? "—"}</TableCell>
                      <TableCell className="text-muted-foreground">
                        {c.email}
                      </TableCell>
                      <TableCell>
                        <StageCell
                          clientId={c.id}
                          stage={c.stage as ClientStage}
                        />
                      </TableCell>
                      <TableCell className="text-muted-foreground">
                        {formatDateTime(c.updated_at)}
                      </TableCell>
                      <TableCell className="text-right">
                        <Link
                          href={`/admin/clients/${c.id}`}
                          className="text-sm underline-offset-4 hover:underline"
                        >
                          Edit
                        </Link>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          )}
        </section>

        <section className="space-y-4">
          <h2 className="text-lg font-medium">Recent activity</h2>
          {activity.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              No activity yet. Client link-clicks will show up here.
            </p>
          ) : (
            <ul className="divide-y border rounded-md">
              {activity.map((a) => (
                <li
                  key={a.id}
                  className="flex items-center justify-between px-4 py-3 text-sm"
                >
                  <span>
                    <span className="font-medium">
                      {a.client?.name ?? "Unknown client"}
                    </span>{" "}
                    <span className="text-muted-foreground">
                      {describeActivity(a.action, a.metadata)}
                    </span>
                  </span>
                  <span className="text-muted-foreground tabular-nums">
                    {formatDateTime(a.created_at)}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </section>
      </div>
    </main>
  );
}
