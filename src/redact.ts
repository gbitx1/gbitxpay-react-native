// Credential hygiene. The publishable key, the client token, and the full
// checkout URL (which carries #t=<clientToken>) must NEVER hit a log, a
// breadcrumb, or a serialized error. Everything here is defensive: even the
// debug logger routes through redaction.

// Reduce a URL to origin + pathname, dropping the query and fragment (where
// the token lives). Use this anywhere a URL might be surfaced.
export function redactUrl(url: string): string {
  try {
    const u = new URL(url);
    return `${u.origin}${u.pathname}`;
  } catch {
    return '[unparseable-url]';
  }
}

// Scrub key-shaped and token substrings from arbitrary text.
export function redactSecrets(input: string): string {
  return input
    // gk_/pk_ live/test keys -> keep the class prefix, redact the body.
    .replace(/([gp]k_(?:live|test)_)[0-9a-f]{6,}/gi, '$1redacted')
    // t= token in a fragment OR query string (#t=…, ?t=…, &t=…).
    .replace(/([#?&]t=)[^\s&"']+/g, '$1redacted')
    // Authorization: Bearer <key/token>.
    .replace(/(Bearer\s+)[^\s"']+/gi, '$1redacted');
}

function safeStringify(value: unknown): string {
  const seen = new WeakSet<object>();
  try {
    return JSON.stringify(value, (_k, v) => {
      if (typeof v === 'object' && v !== null) {
        if (seen.has(v)) return '[circular]';
        seen.add(v);
      }
      return v;
    });
  } catch {
    return String(value);
  }
}

let _debug = false;
export function setDebug(on: boolean): void {
  _debug = !!on;
}

// Debug logger. Off by default; even when on it redacts every line.
export function debugLog(...parts: unknown[]): void {
  if (!_debug) return;
  try {
    const line = parts.map((p) => (typeof p === 'string' ? p : safeStringify(p))).join(' ');
    // eslint-disable-next-line no-console
    console.log('[GbitXPay]', redactSecrets(line));
  } catch {
    /* logging must never throw */
  }
}
