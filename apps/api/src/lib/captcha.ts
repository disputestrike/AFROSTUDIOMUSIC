/**
 * CAPTCHA (audit 2026-07-17, owner: "maybe we need captcha"). Bot-signup and
 * public-form abuse defense. Provider-agnostic server verify — Cloudflare
 * Turnstile and hCaptcha share the same {secret, response} → {success} shape.
 *
 * DISABLED until the operator sets CAPTCHA_SECRET (and the web sets its site
 * key): captchaRequired() is false, so the flow is unchanged. Once armed,
 * signup requires a valid token. This is the switch the owner flips at launch.
 */
const VERIFY_URLS: Record<string, string> = {
  turnstile: "https://challenges.cloudflare.com/turnstile/v0/siteverify",
  hcaptcha: "https://hcaptcha.com/siteverify",
};

export function captchaRequired(): boolean {
  return !!process.env.CAPTCHA_SECRET;
}

export async function verifyCaptcha(token: string | undefined): Promise<boolean> {
  const secret = process.env.CAPTCHA_SECRET;
  if (!secret) return true; // not armed → pass (scaffold, no behavior change)
  if (!token) return false;
  const provider = (process.env.CAPTCHA_PROVIDER ?? "turnstile").toLowerCase();
  const url = VERIFY_URLS[provider] ?? VERIFY_URLS.turnstile!;
  try {
    const body = new URLSearchParams({ secret, response: token });
    const res = await fetch(url, {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body,
      signal: AbortSignal.timeout(8_000),
    });
    if (!res.ok) return false;
    const data = (await res.json()) as { success?: boolean };
    return data.success === true;
  } catch {
    return false; // verification unreachable → reject (fail closed on the gate)
  }
}
