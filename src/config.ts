import { GbitXPayError } from './errors';
import { assertPublishableKey, assertHttpsOrigin } from './validation';
import { debugLog, setDebug, redactSecrets } from './redact';
import type { ConfigureOptions, Environment, MerchantInfo } from './types';

// Bootstrap API base — where /v1/sdk/config lives (distinct from the checkout
// host returned by that endpoint). Overridable via configure({ apiBaseUrl })
// for staging, but must be https.
const DEFAULT_API_BASE = 'https://gateway.gbitx.com';
const DEFAULT_TIMEOUT_MS = 10_000;
const MIN_TIMEOUT_MS = 1_000;
const MAX_TIMEOUT_MS = 60_000;

export interface ResolvedConfig {
  publishableKey: string;
  environment: Environment;
  // Frozen https origin of the checkout host (e.g. https://pay.gbitx.com).
  // The single root of trust for the WebView source, originWhitelist, and
  // every message-origin check. Server-authoritative, asserted https.
  checkoutOrigin: string;
  merchant: MerchantInfo;
}

type State = 'unconfigured' | 'configuring' | 'configured' | 'configure_failed';

let _state: State = 'unconfigured';
let _config: ResolvedConfig | null = null;
let _inflight: Promise<ResolvedConfig> | null = null;
let _inflightKey: string | null = null;

export function isConfigured(): boolean {
  return _state === 'configured' && _config !== null;
}

export function getResolvedConfig(): ResolvedConfig | null {
  return _config;
}

// Test-only reset of module state. Not exported from the package index.
export function __resetConfigForTest(): void {
  _state = 'unconfigured';
  _config = null;
  _inflight = null;
  _inflightKey = null;
}

function normalizeTimeout(ms: unknown): number {
  if (typeof ms !== 'number' || !Number.isFinite(ms)) return DEFAULT_TIMEOUT_MS;
  return Math.min(MAX_TIMEOUT_MS, Math.max(MIN_TIMEOUT_MS, Math.floor(ms)));
}

// Only echo a server-provided message after scrubbing it (defense in depth —
// the publishableKeyAuth messages are static today, but never trust that).
function safeMessage(msg: unknown, fallback: string): string {
  return typeof msg === 'string' && msg.trim() ? redactSecrets(msg.trim()) : fallback;
}

// Map a non-2xx GET /v1/sdk/config response to a typed error, keyed off the
// real backend shapes (publishableKeyAuth.js). Pure + unit-tested.
export function mapConfigError(
  status: number,
  body: { code?: string; message?: string; onboardingStatus?: string } | null | undefined,
  retryAfterHeader?: string | null,
): GbitXPayError {
  const b = body || {};
  if (status === 403 && b.code === 'ONBOARDING_REQUIRED') {
    return new GbitXPayError('onboarding_required', safeMessage(b.message, 'This publishable key is not active yet. Complete onboarding to activate.'), {
      onboardingStatus: typeof b.onboardingStatus === 'string' ? b.onboardingStatus : undefined,
    });
  }
  if (status === 403) {
    return new GbitXPayError('merchant_suspended', safeMessage(b.message, 'This merchant account is not active.'));
  }
  if (status === 429) {
    const ra = Number(retryAfterHeader);
    return new GbitXPayError('rate_limited', safeMessage(b.message, 'Too many requests. Please try again shortly.'), {
      retryAfterSec: Number.isFinite(ra) && ra > 0 ? ra : undefined,
    });
  }
  if (status >= 500) {
    return new GbitXPayError('server_error', safeMessage(b.message, 'GbitXPay is temporarily unavailable. Please try again.'));
  }
  // 401 and any other 4xx -> the key was rejected.
  return new GbitXPayError('invalid_key', safeMessage(b.message, 'The publishable key was rejected.'));
}

// Validate a 2xx body's shape so 'configured' means the REAL backend answered
// correctly (a captive portal / CDN error page / partial deploy that returns
// 200 with junk is treated as server_error, not silently accepted). Pure.
export function parseConfigSuccess(body: unknown): { environment: Environment; checkoutOrigin: string; merchant: MerchantInfo } {
  const b = body as {
    success?: unknown;
    environment?: unknown;
    checkoutBaseUrl?: unknown;
    merchant?: { name?: unknown; website?: unknown } | null;
  } | null;

  if (!b || b.success !== true) {
    throw new GbitXPayError('server_error', 'Unexpected response while validating the key.');
  }
  if (b.environment !== 'live' && b.environment !== 'test') {
    throw new GbitXPayError('server_error', 'Unexpected config response (environment).');
  }
  let checkoutOrigin: string;
  try {
    checkoutOrigin = assertHttpsOrigin(b.checkoutBaseUrl, 'checkoutBaseUrl');
  } catch {
    throw new GbitXPayError('server_error', 'Insecure or invalid checkout origin from server.');
  }
  const m = b.merchant;
  if (!m || typeof m !== 'object' || Array.isArray(m)) {
    throw new GbitXPayError('server_error', 'Unexpected config response (merchant).');
  }
  const name = typeof m.name === 'string' && m.name.trim() ? m.name.trim() : 'Merchant';
  const website = typeof m.website === 'string' && m.website.trim() ? m.website.trim() : null;
  return { environment: b.environment, checkoutOrigin, merchant: { name, website } };
}

async function fetchConfig(key: string, apiBase: string, timeoutMs: number): Promise<ResolvedConfig> {
  const url = `${apiBase}/v1/sdk/config`;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  let res: Response;
  try {
    res = await fetch(url, {
      method: 'GET',
      signal: controller.signal,
      headers: { Authorization: `Bearer ${key}`, Accept: 'application/json' },
    });
  } catch (cause) {
    throw new GbitXPayError('network_error', 'Could not reach GbitXPay to validate the publishable key.', { cause });
  } finally {
    clearTimeout(timer);
  }

  // Body may be non-JSON (proxy/CDN error page) — parse defensively.
  const body = await res.json().catch(() => null);

  if (!res.ok) {
    throw mapConfigError(res.status, body as never, res.headers?.get?.('retry-after'));
  }

  const parsed = parseConfigSuccess(body);
  return {
    publishableKey: key,
    environment: parsed.environment,
    checkoutOrigin: parsed.checkoutOrigin,
    merchant: parsed.merchant,
  };
}

// Validate the publishable key against the GbitX backend and prepare the SDK.
// Must complete successfully before present() can run. Safe to call more than
// once (an in-flight call for the SAME key is shared; the last successful
// configure wins).
export async function configure(options: ConfigureOptions): Promise<void> {
  if (options && options.debug) setDebug(true);

  const { key, environment: prefixEnv } = assertPublishableKey(options?.publishableKey);

  if (options.environment && options.environment !== prefixEnv) {
    throw new GbitXPayError('environment_mismatch', 'The environment option does not match the publishable key.');
  }

  const timeoutMs = normalizeTimeout(options.timeoutMs);
  const apiBase = options.apiBaseUrl ? assertHttpsOrigin(options.apiBaseUrl, 'apiBaseUrl') : DEFAULT_API_BASE;

  // Share an in-flight configure for the same key.
  if (_inflight && _inflightKey === key) {
    await _inflight;
    return;
  }

  _state = 'configuring';
  debugLog('configure: validating key against', `${apiBase}/v1/sdk/config`);

  const run = (async (): Promise<ResolvedConfig> => {
    const resolved = await fetchConfig(key, apiBase, timeoutMs);
    // Cross-check the key prefix against the server's environment. A mismatch
    // is a fatal misconfiguration (mis-issued/tampered key or wrong backend).
    if (resolved.environment !== prefixEnv) {
      throw new GbitXPayError('environment_mismatch', 'Key environment and server environment disagree.');
    }
    if (options.environment && options.environment !== resolved.environment) {
      throw new GbitXPayError('environment_mismatch', 'The environment option does not match the server environment.');
    }
    return resolved;
  })();

  _inflight = run;
  _inflightKey = key;

  try {
    const resolved = await run;
    // Only commit if THIS run is still the current in-flight one. A later
    // configure() (different key) may have superseded us while we awaited; a
    // stale, superseded run must never overwrite the winning checkoutOrigin
    // (the root of trust). If superseded, drop our result silently.
    if (_inflight === run) {
      _config = resolved;
      _state = 'configured';
      debugLog('configure: ok, environment =', resolved.environment);
    }
  } catch (err) {
    // Only flip to failed if this run is still the current one (a newer
    // configure() may have superseded us).
    if (_inflight === run) {
      _state = 'configure_failed';
      _config = null;
    }
    throw err;
  } finally {
    if (_inflight === run) {
      _inflight = null;
      _inflightKey = null;
    }
  }
}
