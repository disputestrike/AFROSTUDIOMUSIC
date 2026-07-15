/**
 * Transactional email via Resend's REST API (no SDK — one fetch).
 * Missing configuration is an explicit skipped failure, never a sent receipt.
 */
import { escapeHtml, safeHttpUrl } from "@afrohit/shared";

const FROM = () =>
  process.env.EMAIL_FROM ?? "AfroHit Studio <noreply@afrohit.studio>";

export type EmailDelivery =
  | { ok: true; id?: string }
  | { ok: false; error: string; skipped?: boolean };

export async function sendEmail(opts: {
  to: string;
  subject: string;
  html: string;
}): Promise<EmailDelivery> {
  const key = process.env.RESEND_API_KEY;
  if (!key) {
    console.log("[email skipped: RESEND_API_KEY is not configured]");
    return { ok: false, skipped: true, error: "not_configured" };
  }
  const res = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: {
      authorization: `Bearer ${key}`,
      "content-type": "application/json",
    },
    body: JSON.stringify({
      from: FROM(),
      to: [opts.to],
      subject: opts.subject,
      html: opts.html,
    }),
    signal: AbortSignal.timeout(30_000),
  });
  if (!res.ok) {
    await res.body?.cancel().catch(() => undefined);
    console.error(`[email failed] provider status ${res.status}`);
    return { ok: false, error: "provider_http_" + res.status };
  }
  const data = (await res.json()) as { id?: string };
  return { ok: true, id: data.id };
}

// ---------- Prebuilt templates ---------------------------------------------

const wrap = (body: string) => `
<div style="font-family:Inter,system-ui,sans-serif;max-width:560px;margin:0 auto;padding:24px;color:#111">
  <div style="font-size:22px;font-weight:800;letter-spacing:-0.5px;margin-bottom:16px">AFROHIT STUDIO</div>
  ${body}
  <p style="margin-top:32px;font-size:12px;color:#888">You're receiving this because you have an AfroHit Studio account.</p>
</div>`;

export function welcomeEmail(name: string | null) {
  return {
    subject: "Welcome to AfroHit Studio 🎧",
    html: wrap(`
      <p>Hey ${escapeHtml(name ?? "there")},</p>
      <p>Your studio is live. You've got <b>$5 in onboarding credits</b> to play with.</p>
      <p>First move: open <b>Settings</b> and fill in your Artist DNA — your languages, your lane,
      your banned clichés. The more specific you are, the less generic the music.</p>
      <p>Then open Studio Chat and tell it what you want to make.</p>
    `),
  };
}

export function jobDoneEmail(
  kind: string,
  projectTitle: string | null,
  url: string | null
) {
  const kindLabel: Record<string, string> = {
    music: "Your beat is ready",
    voice: "Your vocal render is ready",
    video: "Your video render is ready",
    export: "Your release kit is ready",
  };
  const link = safeHttpUrl(url);
  return {
    subject: `${kindLabel[kind] ?? "Your render is ready"} — ${projectTitle ?? "AfroHit Studio"}`,
    html: wrap(`
      <p>${escapeHtml(kindLabel[kind] ?? "A render finished")} on <b>${escapeHtml(projectTitle ?? "your project")}</b>.</p>
      ${link ? `<p><a href="${escapeHtml(link)}" style="color:#EA580C">Listen / view it here</a></p>` : ""}
      <p>Open the project in the studio to approve it or iterate.</p>
    `),
  };
}

export function creditReceiptEmail(amountUsd: string, balanceUsd: string) {
  return {
    subject: `Credits added — ${amountUsd}`,
    html: wrap(`
      <p>Your PayPal payment went through.</p>
      <p><b>${amountUsd}</b> in credits added. New balance: <b>${balanceUsd}</b>.</p>
    `),
  };
}

export function morningDropEmail(
  stageName: string,
  hooks: Array<{ text: string; score: number | null }>
) {
  const rows = hooks
    .map(
      (h, i) =>
        `<tr><td style="padding:6px 10px;color:#EA580C;font-weight:700">${(h.score ?? 0).toFixed(1)}</td><td style="padding:6px 10px;white-space:pre-wrap">${i + 1}. ${escapeHtml(h.text)}</td></tr>`
    )
    .join("");
  return {
    subject: `☀️ Morning Drop — ${hooks.length} fresh hooks for ${stageName}`,
    html: wrap(`
      <p>While you slept, the studio wrote and scored a new batch. Top picks:</p>
      <table style="border-collapse:collapse;font-size:14px">${rows}</table>
      <p>Open Studio Chat to approve one and take it to a full demo.</p>
    `),
  };
}

export function releaseRadarEmail(
  rows: Array<{ country: string | null; events: number }>
) {
  const list = rows
    .slice(0, 10)
    .map(
      r =>
        `<li><b>${escapeHtml(r.country ?? "Unknown")}</b> — ${Number(r.events)} plays/clicks</li>`
    )
    .join("");
  return {
    subject: "📡 Release Radar — your week in listeners",
    html: wrap(`
      <p>Where your music moved in the last 7 days:</p>
      <ul>${list}</ul>
      <p>Check the heatmap in your dashboard for city-level detail.</p>
    `),
  };
}
