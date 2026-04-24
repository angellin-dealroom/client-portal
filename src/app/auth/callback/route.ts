import { createClient } from "@/lib/supabase/server";
import { NextResponse, type NextRequest } from "next/server";
import type { EmailOtpType } from "@supabase/supabase-js";

/**
 * Handles both patterns:
 *   - Token-hash verify (preferred, works cross-browser/device):
 *       /auth/callback?token_hash=...&type=magiclink
 *   - PKCE code exchange (legacy, same-browser only):
 *       /auth/callback?code=...
 * The Supabase Magic Link email template determines which one is used.
 */
export async function GET(request: NextRequest) {
  const { searchParams, origin } = new URL(request.url);
  const code = searchParams.get("code");
  const tokenHash = searchParams.get("token_hash");
  const type = searchParams.get("type") as EmailOtpType | null;

  const supabase = createClient();

  let authError: string | null = null;

  if (tokenHash && type) {
    const { error } = await supabase.auth.verifyOtp({
      type,
      token_hash: tokenHash,
    });
    if (error) authError = error.message;
  } else if (code) {
    const { error } = await supabase.auth.exchangeCodeForSession(code);
    if (error) authError = error.message;
  } else {
    authError = "missing_code";
  }

  if (authError) {
    return NextResponse.redirect(
      `${origin}/login?error=${encodeURIComponent(authError)}`
    );
  }

  const {
    data: { user },
  } = await supabase.auth.getUser();

  const adminEmail = process.env.ADMIN_EMAIL;
  const isAdmin = !!user?.email && user.email === adminEmail;

  if (!isAdmin) {
    const { data: client } = await supabase
      .from("clients")
      .select("id")
      .eq("email", user?.email ?? "")
      .maybeSingle();

    if (!client) {
      await supabase.auth.signOut();
      return NextResponse.redirect(
        `${origin}/login?error=email_not_registered`
      );
    }
  }

  return NextResponse.redirect(`${origin}${isAdmin ? "/admin" : "/dashboard"}`);
}
