import { createClient } from "@/lib/supabase/server";
import { NextResponse, type NextRequest } from "next/server";

export async function GET(request: NextRequest) {
  const { searchParams, origin } = new URL(request.url);
  const code = searchParams.get("code");

  if (!code) {
    return NextResponse.redirect(`${origin}/login?error=missing_code`);
  }

  const supabase = createClient();
  const { error: exchangeError } = await supabase.auth.exchangeCodeForSession(code);

  if (exchangeError) {
    return NextResponse.redirect(
      `${origin}/login?error=${encodeURIComponent(exchangeError.message)}`
    );
  }

  const {
    data: { user },
  } = await supabase.auth.getUser();

  const adminEmail = process.env.ADMIN_EMAIL;
  const isAdmin = !!user?.email && user.email === adminEmail;

  // Non-admin: verify the email has a matching client row. Reject otherwise.
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
