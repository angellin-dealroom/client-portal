/**
 * Branded email scaffolder.
 *
 * Used by transactional emails we send from our own code (e.g. the
 * admin send-invite flow). Also used as the visual reference for the
 * Supabase auth magic-link template — that template can't import this
 * module (it lives in the Supabase dashboard), so its HTML is
 * hand-crafted to match the output of `brandedEmailHtml`. If you change
 * styling here, regenerate `supabase/email-templates/magic-link.template.html`
 * and paste it into Supabase → Authentication → Email Templates → Magic Link.
 */

export type EmailBlock =
  | { kind: "text"; content: string }
  | { kind: "cta"; label: string; url: string }
  | { kind: "list"; items: string[] };

export type EmailContent = {
  preheader?: string;
  greeting: string;
  blocks: EmailBlock[];
  /** Multi-line allowed; rendered with <br> in HTML, newlines in text. */
  signoff: string;
};

const ACCENT = "#18181b";
const FOREGROUND = "#18181b";
const MUTED = "#71717a";
const BORDER = "#e4e4e7";
const SURFACE = "#ffffff";
const PAGE = "#fafafa";

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function escapeAndLinkify(s: string): string {
  const escaped = escapeHtml(s);
  return escaped.replace(
    /(https?:\/\/[^\s<]+)/g,
    `<a href="$1" style="color: ${ACCENT}; text-decoration: underline;">$1</a>`
  );
}

function renderBlockHtml(block: EmailBlock): string {
  switch (block.kind) {
    case "text":
      return `<p style="margin: 0 0 16px 0;">${escapeAndLinkify(block.content)}</p>`;
    case "cta":
      return `<p style="margin: 24px 0;">
  <a href="${block.url}" style="display: inline-block; padding: 12px 22px; background: ${ACCENT}; color: #fafafa; text-decoration: none; border-radius: 6px; font-weight: 500;">${escapeHtml(block.label)}</a>
</p>`;
    case "list":
      return `<ul style="margin: 0 0 16px 0; padding-left: 20px;">
${block.items
  .map((it) => `  <li style="margin: 0 0 6px 0;">${escapeAndLinkify(it)}</li>`)
  .join("\n")}
</ul>`;
  }
}

export function brandedEmailHtml(content: EmailContent): string {
  const blocksHtml = content.blocks.map(renderBlockHtml).join("\n");

  const signoffHtml = content.signoff
    .split("\n")
    .map((line) => escapeHtml(line))
    .join("<br>");

  const preheader = content.preheader
    ? `<div style="display: none; max-height: 0; overflow: hidden; mso-hide: all; opacity: 0; color: transparent;">${escapeHtml(content.preheader)}</div>`
    : "";

  return `<!doctype html>
<html>
  <head>
    <meta charset="utf-8">
    <meta name="viewport" content="width=device-width, initial-scale=1">
  </head>
  <body style="margin: 0; padding: 0; background: ${PAGE}; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; color: ${FOREGROUND};">
    ${preheader}
    <table width="100%" cellpadding="0" cellspacing="0" border="0" style="background: ${PAGE};">
      <tr>
        <td align="center" style="padding: 32px 16px;">
          <table width="100%" cellpadding="0" cellspacing="0" border="0" style="max-width: 540px; background: ${SURFACE}; border: 1px solid ${BORDER}; border-radius: 8px;">
            <tr>
              <td style="padding: 32px;">
                <p style="margin: 0 0 20px 0; font-size: 12px; font-weight: 600; letter-spacing: 0.06em; text-transform: uppercase; color: ${MUTED};">Dealroom Media</p>
                <div style="font-size: 15px; line-height: 1.55; color: ${FOREGROUND};">
                  <p style="margin: 0 0 16px 0;">${escapeHtml(content.greeting)}</p>
                  ${blocksHtml}
                  <p style="margin: 24px 0 0 0;">${signoffHtml}</p>
                </div>
              </td>
            </tr>
            <tr>
              <td style="padding: 0 32px 24px 32px;">
                <p style="margin: 0; font-size: 12px; color: ${MUTED};">Dealroom Media &middot; Client Portal</p>
              </td>
            </tr>
          </table>
        </td>
      </tr>
    </table>
  </body>
</html>`;
}

export function brandedEmailText(content: EmailContent): string {
  const blocksText = content.blocks
    .map((block) => {
      switch (block.kind) {
        case "text":
          return block.content;
        case "cta":
          return `${block.label}:\n${block.url}`;
        case "list":
          return block.items.map((it) => `- ${it}`).join("\n");
      }
    })
    .join("\n\n");

  return `${content.greeting}

${blocksText}

${content.signoff}
`;
}
