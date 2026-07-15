const URL_PATTERN = /https?:\/\/[^\s"'<>]+/gi;
const EMAIL_PATTERN = /\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/gi;
const AUTH_PATTERN = /\b(Bearer|Basic)\s+[A-Za-z0-9._~+/=-]+/gi;
const NAMED_SECRET_PATTERN = /\b(api[_ -]?key|access[_ -]?token|refresh[_ -]?token|secret|password|authorization|signature)\s*[:=]\s*([^\s,;]+)/gi;

function redactUrl(raw: string): string {
  try {
    const parsed = new URL(raw);
    const hadSensitiveSuffix = !!parsed.search || !!parsed.hash || !!parsed.username || !!parsed.password;
    parsed.username = '';
    parsed.password = '';
    parsed.search = '';
    parsed.hash = '';
    return `${parsed.toString()}${hadSensitiveSuffix ? '?[redacted]' : ''}`;
  } catch {
    return '[redacted-url]';
  }
}

export function redactSensitiveText(value: unknown, maxLength = 2_000): string {
  const source = String(value ?? '');
  return source
    .replace(URL_PATTERN, redactUrl)
    .replace(EMAIL_PATTERN, '[redacted-email]')
    .replace(AUTH_PATTERN, '$1 [redacted]')
    .replace(NAMED_SECRET_PATTERN, '$1=[redacted]')
    .slice(0, maxLength);
}
