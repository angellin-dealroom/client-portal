"use client";

import { useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";

type Status = "idle" | "sending" | "sent" | "error";

function messageForInitialError(code?: string): string | null {
  switch (code) {
    case "email_not_registered":
      return "This email isn't registered. Please contact your account manager.";
    case "missing_code":
      return "The sign-in link was invalid. Please request a new one.";
    default:
      return code ? decodeURIComponent(code) : null;
  }
}

export function LoginForm({ initialError }: { initialError?: string }) {
  const [email, setEmail] = useState("");
  const [status, setStatus] = useState<Status>("idle");
  const [errorMessage, setErrorMessage] = useState<string | null>(
    messageForInitialError(initialError)
  );

  async function handleSubmit(event: React.FormEvent) {
    event.preventDefault();
    setStatus("sending");
    setErrorMessage(null);

    const supabase = createClient();
    const { error } = await supabase.auth.signInWithOtp({
      email,
      options: {
        emailRedirectTo: `${window.location.origin}/auth/callback`,
      },
    });

    if (error) {
      setStatus("error");
      setErrorMessage(error.message);
      return;
    }

    setStatus("sent");
  }

  return (
    <main className="min-h-screen flex items-center justify-center p-8">
      <Card className="w-full max-w-md">
        <CardHeader>
          <CardTitle>Sign in</CardTitle>
          <CardDescription>
            Enter your email and we&apos;ll send you a magic link.
          </CardDescription>
        </CardHeader>
        <CardContent>
          {status === "sent" ? (
            <div className="space-y-2 text-sm">
              <p className="font-medium">Check your email.</p>
              <p className="text-muted-foreground">
                We sent a sign-in link to{" "}
                <span className="font-medium text-foreground">{email}</span>. It
                may take a minute to arrive. You can close this tab after
                clicking the link.
              </p>
            </div>
          ) : (
            <form onSubmit={handleSubmit} className="space-y-4">
              <div className="space-y-2">
                <Label htmlFor="email">Email</Label>
                <Input
                  id="email"
                  type="email"
                  required
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  placeholder="you@example.com"
                  autoComplete="email"
                  disabled={status === "sending"}
                />
              </div>
              {errorMessage && (
                <p className="text-sm text-destructive">{errorMessage}</p>
              )}
              <Button
                type="submit"
                className="w-full"
                disabled={status === "sending" || email.length === 0}
              >
                {status === "sending" ? "Sending…" : "Send magic link"}
              </Button>
            </form>
          )}
        </CardContent>
      </Card>
    </main>
  );
}
