import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { SignOutButton } from "@/components/sign-out-button";

export default async function DashboardPage() {
  const supabase = createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    redirect("/login");
  }

  return (
    <main className="min-h-screen p-8">
      <div className="max-w-3xl mx-auto space-y-6">
        <div className="flex items-center justify-between">
          <h1 className="text-3xl font-semibold tracking-tight">Dashboard</h1>
          <SignOutButton />
        </div>
        <p className="text-muted-foreground">
          Signed in as <span className="text-foreground">{user.email}</span>.
          Client dashboard content comes in the next step.
        </p>
      </div>
    </main>
  );
}
