import { NextResponse, type NextRequest } from "next/server";
import { timingSafeEqual } from "crypto";
import { resend } from "@/lib/resend";
import {
  brandedEmailHtml,
  brandedEmailText,
  type EmailContent,
} from "@/lib/email-template";

const FROM_ADDRESS = "Dealroom Media <noreply@dealroom.media>";

const MAX_SUBJECT_LEN = 200;
const MAX_PARAGRAPHS = 10;
const MAX_PARAGRAPH_LEN = 2000;
const MAX_LABEL_LEN = 80;
const MAX_URL_LEN = 2000;

type Body = {
  subject: string;
  paragraphs: string[];
  cta?: { label: string; url: string };
};

function constantTimeEquals(a: string, b: string): boolean {
  // Length must be checked first because timingSafeEqual throws on
  // mismatched lengths; that throw itself leaks length info.
  const aBuf = Buffer.from(a);
  const bBuf = Buffer.from(b);
  if (aBuf.length !== bBuf.length) return false;
  return timingSafeEqual(aBuf, bBuf);
}

function validateBody(raw: unknown): { ok: true; body: Body } | { ok: false; error: string } {
  if (!raw || typeof raw !== "object") {
    return { ok: false, error: "Body must be a JSON object" };
  }
  const obj = raw as Record<string, unknown>;

  // subject
  if (typeof obj.subject !== "string" || obj.subject.trim().length === 0) {
    return { ok: false, error: "subject must be a non-empty string" };
  }
  if (obj.subject.length > MAX_SUBJECT_LEN) {
    return { ok: false, error: `subject must be ≤${MAX_SUBJECT_LEN} chars` };
  }

  // paragraphs
  if (!Array.isArray(obj.paragraphs) || obj.paragraphs.length === 0) {
    return { ok: false, error: "paragraphs must be a non-empty array" };
  }
  if (obj.paragraphs.length > MAX_PARAGRAPHS) {
    return { ok: false, error: `paragraphs must contain ≤${MAX_PARAGRAPHS} entries` };
  }
  for (const p of obj.paragraphs) {
    if (typeof p !== "string" || p.trim().length === 0) {
      return { ok: false, error: "every paragraph must be a non-empty string" };
    }
    if (p.length > MAX_PARAGRAPH_LEN) {
      return { ok: false, error: `each paragraph must be ≤${MAX_PARAGRAPH_LEN} chars` };
    }
  }

  // cta (optional)
  let cta: Body["cta"] | undefined;
  if (obj.cta !== undefined && obj.cta !== null) {
    if (typeof obj.cta !== "object") {
      return { ok: false, error: "cta must be an object with label + url" };
    }
    const ctaObj = obj.cta as Record<string, unknown>;
    if (typeof ctaObj.label !== "string" || ctaObj.label.trim().length === 0) {
      return { ok: false, error: "cta.label must be a non-empty string" };
    }
    if (ctaObj.label.length > MAX_LABEL_LEN) {
      return { ok: false, error: `cta.label must be ≤${MAX_LABEL_LEN} chars` };
    }
    if (typeof ctaObj.url !== "string" || ctaObj.url.length === 0) {
      return { ok: false, error: "cta.url must be a non-empty string" };
    }
    if (ctaObj.url.length > MAX_URL_LEN) {
      return { ok: false, error: `cta.url must be ≤${MAX_URL_LEN} chars` };
    }
    try {
      const parsed = new URL(ctaObj.url);
      if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
        return { ok: false, error: "cta.url must be http(s)" };
      }
    } catch {
      return { ok: false, error: "cta.url is not a valid URL" };
    }
    cta = { label: ctaObj.label, url: ctaObj.url };
  }

  return {
    ok: true,
    body: {
      subject: obj.subject,
      paragraphs: obj.paragraphs as string[],
      cta,
    },
  };
}

export async function POST(request: NextRequest) {
  const expectedSecret = process.env.NOTIFY_SECRET;
  if (!expectedSecret) {
    console.error("NOTIFY_SECRET not configured");
    return NextResponse.json({ error: "Server misconfigured" }, { status: 500 });
  }

  const presentedSecret = request.headers.get("x-notify-secret") ?? "";
  if (!constantTimeEquals(presentedSecret, expectedSecret)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  let raw: unknown;
  try {
    raw = await request.json();
  } catch {
    return NextResponse.json({ error: "Body must be valid JSON" }, { status: 400 });
  }

  const validated = validateBody(raw);
  if (!validated.ok) {
    return NextResponse.json({ error: validated.error }, { status: 400 });
  }
  const { subject, paragraphs, cta } = validated.body;

  const adminEmail = process.env.ADMIN_EMAIL;
  if (!adminEmail) {
    console.error("ADMIN_EMAIL not configured");
    return NextResponse.json({ error: "Server misconfigured" }, { status: 500 });
  }

  const content: EmailContent = {
    preheader: subject,
    greeting: "Heads up,",
    blocks: [
      ...paragraphs.map(
        (p): EmailContent["blocks"][number] => ({ kind: "text", content: p })
      ),
      ...(cta
        ? [{ kind: "cta" as const, label: cta.label, url: cta.url }]
        : []),
    ],
  };

  try {
    const { error } = await resend.emails.send({
      from: FROM_ADDRESS,
      to: adminEmail,
      subject,
      html: brandedEmailHtml(content),
      text: brandedEmailText(content),
    });
    if (error) {
      console.error("Resend notify-admin failed:", error.message);
      return NextResponse.json({ error: `Resend: ${error.message}` }, { status: 500 });
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : "send failed";
    console.error("Resend notify-admin threw:", message);
    return NextResponse.json({ error: message }, { status: 500 });
  }

  return NextResponse.json({ ok: true });
}
