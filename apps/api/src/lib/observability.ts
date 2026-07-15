/**
 * Observability — Sentry error capture + PostHog event capture.
 * Both are optional: without DSN/key they silently no-op.
 * PostHog uses the plain /capture HTTP endpoint (no SDK dependency).
 */
import * as Sentry from "@sentry/node";
import { redactSensitiveText } from "@afrohit/shared";

let sentryEnabled = false;

export function sanitizeRequestUrl(value: string): string {
  return redactSensitiveText(value.split(/[?#]/, 1)[0] ?? "", 1_000);
}

export function initObservability(service: string) {
  const dsn = process.env.SENTRY_DSN;
  if (dsn) {
    Sentry.init({
      dsn,
      environment: process.env.NODE_ENV ?? "development",
      tracesSampleRate: 0.1,
      initialScope: { tags: { service } },
      sendDefaultPii: false,
      beforeSend(event) {
        if (event.request?.headers) {
          for (const name of Object.keys(event.request.headers)) {
            if (
              ["authorization", "cookie", "x-internal-secret"].includes(
                name.toLowerCase()
              )
            ) {
              delete event.request.headers[name];
            }
          }
        }
        if (event.request?.url)
          event.request.url = sanitizeRequestUrl(event.request.url);
        if (event.request) {
          delete event.request.query_string;
          delete event.request.cookies;
          delete event.request.data;
        }
        if (event.message)
          event.message = redactSensitiveText(event.message, 1_000);
        for (const value of event.exception?.values ?? []) {
          if (value.value)
            value.value = redactSensitiveText(value.value, 1_000);
          if (value.stacktrace?.frames) {
            for (const frame of value.stacktrace.frames) {
              if (frame.filename)
                frame.filename = redactSensitiveText(frame.filename, 500);
            }
          }
        }
        return event;
      },
    });
    sentryEnabled = true;
  }
}

export function captureError(err: unknown, context?: Record<string, unknown>) {
  if (sentryEnabled) {
    const safeContext = context ? { ...context } : undefined;
    if (safeContext && typeof safeContext.url === "string") {
      safeContext.url = sanitizeRequestUrl(safeContext.url);
    }
    Sentry.captureException(
      err,
      safeContext ? { extra: safeContext } : undefined
    );
  }
}

/** Fire-and-forget product analytics event. */
export function track(
  event: string,
  distinctId: string,
  properties?: Record<string, unknown>
) {
  const key = process.env.POSTHOG_KEY;
  if (!key) return;
  const host = process.env.POSTHOG_HOST ?? "https://us.i.posthog.com";
  fetch(`${host}/capture/`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      api_key: key,
      event,
      distinct_id: distinctId,
      properties: { ...properties, $lib: "afrohit-server" },
    }),
  }).catch(() => {
    /* analytics must never break the request path */
  });
}
