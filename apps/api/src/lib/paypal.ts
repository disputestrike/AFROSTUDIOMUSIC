/**
 * Minimal PayPal REST client. We deliberately use `fetch` rather than an SDK:
 *   - PayPal's first-party Node SDKs (the older `@paypal/checkout-server-sdk`
 *     is deprecated; the newer `@paypal/paypal-server-sdk` is in flux) ship a
 *     lot of generated surface area we don't need.
 *   - Our usage is narrow: create subscription, create order, capture order,
 *     cancel subscription, verify webhook signature.
 *
 * Auth: OAuth 2.0 client credentials. We cache the access token for ~85% of
 * its TTL to keep the request count low.
 */

const MODE = (process.env.PAYPAL_MODE ?? 'sandbox').toLowerCase();
export const PAYPAL_BASE =
  MODE === 'live' ? 'https://api-m.paypal.com' : 'https://api-m.sandbox.paypal.com';

interface CachedToken {
  accessToken: string;
  expiresAt: number; // epoch ms
}

let _token: CachedToken | null = null;

async function getAccessToken(): Promise<string> {
  const now = Date.now();
  if (_token && _token.expiresAt - 30_000 > now) return _token.accessToken;

  const id = process.env.PAYPAL_CLIENT_ID;
  const secret = process.env.PAYPAL_CLIENT_SECRET;
  if (!id || !secret) throw new Error('PAYPAL_CLIENT_ID / PAYPAL_CLIENT_SECRET missing');

  const basic = Buffer.from(`${id}:${secret}`).toString('base64');
  const res = await fetch(`${PAYPAL_BASE}/v1/oauth2/token`, {
    method: 'POST',
    headers: {
      authorization: `Basic ${basic}`,
      'content-type': 'application/x-www-form-urlencoded',
    },
    body: 'grant_type=client_credentials',
  });
  if (!res.ok) throw new Error(`paypal oauth ${res.status}: ${await res.text()}`);
  const data = (await res.json()) as { access_token: string; expires_in: number };
  _token = {
    accessToken: data.access_token,
    expiresAt: Date.now() + Math.floor(data.expires_in * 850), // 85% of TTL in ms
  };
  return _token.accessToken;
}

async function paypal<T>(
  method: 'GET' | 'POST' | 'PATCH',
  path: string,
  body?: unknown,
  extraHeaders?: Record<string, string>
): Promise<T> {
  const token = await getAccessToken();
  const res = await fetch(`${PAYPAL_BASE}${path}`, {
    method,
    headers: {
      authorization: `Bearer ${token}`,
      'content-type': 'application/json',
      // A unique request id makes PayPal calls idempotent server-side.
      'PayPal-Request-Id': `${Date.now()}-${Math.random().toString(36).slice(2, 10)}`,
      ...(extraHeaders ?? {}),
    },
    body: body == null ? undefined : JSON.stringify(body),
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`paypal ${method} ${path} → ${res.status}: ${text}`);
  }
  if (res.status === 204) return undefined as T;
  return (await res.json()) as T;
}

// ---------- Subscriptions ---------------------------------------------------

export interface PaypalSubscription {
  id: string;
  status: string;
  links: Array<{ rel: string; href: string; method: string }>;
}

export async function createSubscription(opts: {
  planId: string;
  workspaceId: string;
  returnUrl: string;
  cancelUrl: string;
  brandName?: string;
}): Promise<PaypalSubscription> {
  return paypal<PaypalSubscription>('POST', '/v1/billing/subscriptions', {
    plan_id: opts.planId,
    custom_id: opts.workspaceId, // surfaces in BILLING.SUBSCRIPTION.* webhooks
    application_context: {
      brand_name: opts.brandName ?? 'AfroHit Studio',
      user_action: 'SUBSCRIBE_NOW',
      payment_method: { payer_selected: 'PAYPAL', payee_preferred: 'IMMEDIATE_PAYMENT_REQUIRED' },
      return_url: opts.returnUrl,
      cancel_url: opts.cancelUrl,
    },
  });
}

export async function cancelSubscription(subscriptionId: string, reason = 'user_request'): Promise<void> {
  await paypal('POST', `/v1/billing/subscriptions/${encodeURIComponent(subscriptionId)}/cancel`, { reason });
}

export async function getSubscription(subscriptionId: string) {
  return paypal<{ id: string; status: string; plan_id: string; custom_id?: string }>(
    'GET',
    `/v1/billing/subscriptions/${encodeURIComponent(subscriptionId)}`
  );
}

// ---------- Orders (one-time credit packs) ----------------------------------

export interface PaypalOrder {
  id: string;
  status: string;
  links: Array<{ rel: string; href: string; method: string }>;
}

export async function createOrder(opts: {
  amountUsd: number; // e.g. 25 for a $25 pack
  workspaceId: string;
  packKey: string; // "pack_25"
  creditsCents: number; // micro-cents of credit to grant
  returnUrl: string;
  cancelUrl: string;
}): Promise<PaypalOrder> {
  return paypal<PaypalOrder>('POST', '/v2/checkout/orders', {
    intent: 'CAPTURE',
    purchase_units: [
      {
        amount: { currency_code: 'USD', value: opts.amountUsd.toFixed(2) },
        description: `AfroHit Studio credits — ${opts.packKey}`,
        // custom_id surfaces on the capture event for idempotent crediting.
        custom_id: JSON.stringify({
          workspaceId: opts.workspaceId,
          pack: opts.packKey,
          creditsCents: opts.creditsCents,
        }),
      },
    ],
    application_context: {
      brand_name: 'AfroHit Studio',
      user_action: 'PAY_NOW',
      return_url: opts.returnUrl,
      cancel_url: opts.cancelUrl,
    },
  });
}

export async function captureOrder(orderId: string) {
  return paypal<{
    id: string;
    status: string;
    purchase_units: Array<{
      payments?: {
        captures?: Array<{ id: string; status: string; amount: { value: string; currency_code: string }; custom_id?: string }>;
      };
    }>;
  }>('POST', `/v2/checkout/orders/${encodeURIComponent(orderId)}/capture`, {});
}

// ---------- Webhook signature verification ----------------------------------

export interface WebhookHeaders {
  'paypal-auth-algo'?: string;
  'paypal-cert-url'?: string;
  'paypal-transmission-id'?: string;
  'paypal-transmission-sig'?: string;
  'paypal-transmission-time'?: string;
}

export async function verifyWebhookSignature(opts: {
  headers: WebhookHeaders;
  webhookId: string;
  body: unknown; // PARSED body (object), not the raw bytes
}): Promise<boolean> {
  const result = await paypal<{ verification_status: string }>('POST', '/v1/notifications/verify-webhook-signature', {
    auth_algo: opts.headers['paypal-auth-algo'],
    cert_url: opts.headers['paypal-cert-url'],
    transmission_id: opts.headers['paypal-transmission-id'],
    transmission_sig: opts.headers['paypal-transmission-sig'],
    transmission_time: opts.headers['paypal-transmission-time'],
    webhook_id: opts.webhookId,
    webhook_event: opts.body,
  });
  return result.verification_status === 'SUCCESS';
}

// ---------- Helpers ---------------------------------------------------------

export function approveUrlOf(links: Array<{ rel: string; href: string }>): string | undefined {
  return links.find((l) => l.rel === 'approve')?.href ?? links.find((l) => l.rel === 'payer-action')?.href;
}
