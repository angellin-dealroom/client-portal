import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";

export const metadata: Metadata = {
  title: "Welcome to your portal — Dealroom Media",
};

export default async function Home() {
  const supabase = createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (user) {
    if (user.email === process.env.ADMIN_EMAIL) {
      redirect("/admin");
    }
    redirect("/dashboard");
  }

  return (
    <main className="min-h-screen flex items-center justify-center p-8">
      <Card className="w-full max-w-md">
        <CardHeader>
          <CardTitle>Welcome to your portal</CardTitle>
          <CardDescription>
            Everything for our work together — proposals, contracts, payments,
            kickoff calls, and onboarding — lives here in one place.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <Button asChild className="w-full">
            <Link href="/login">Sign in</Link>
          </Button>
        </CardContent>
        <CardFooter>
          <p className="text-xs text-muted-foreground">
            Lost your invite? Email{" "}
            <a
              href="mailto:shamus@dealroom.media"
              className="underline underline-offset-4 hover:text-foreground"
            >
              shamus@dealroom.media
            </a>
            .
          </p>
        </CardFooter>
      </Card>
    </main>
  );
}
