// The ONE public error type. Terminal payment outcomes (cancelled / expired
// / failed) are NOT errors — they resolve as a PaymentResult. Throw/reject
// only for SDK or credential faults. `code` is a stable, closed union;
// changing it is a semver-major event.

export type GbitXPayErrorCode =
  // present() called before configure() completed successfully.
  | 'not_configured'
  // present() called with no <GbitXPayProvider> mounted in the tree.
  | 'not_mounted'
  // publishable key wrong/revoked/malformed, or a config 4xx.
  | 'invalid_key'
  // a SECRET key (gk_) was handed to the SDK — a serious integration bug.
  | 'secret_key_used'
  // key environment and server environment disagree.
  | 'environment_mismatch'
  // merchant not yet approved for this (live) key.
  | 'onboarding_required'
  // merchant account suspended.
  | 'merchant_suspended'
  // config endpoint rate-limited (429).
  | 'rate_limited'
  // could not reach GbitX (DNS/TLS/offline/timeout).
  | 'network_error'
  // GbitX reachable but returned 5xx or an unusable body.
  | 'server_error'
  // bad arguments to configure()/present() (e.g. malformed paymentId).
  | 'invalid_arguments';

// Publicly readable meta — ONLY safe, serializable fields. The transport
// `cause` is accepted by the constructor but is never placed on an enumerable
// property (see below), so it can't be captured by `{...error}`, JSON, or a
// crash reporter that walks own-enumerable keys.
export interface GbitXPayErrorMeta {
  // Present on 'onboarding_required'.
  onboardingStatus?: string;
  // Present on 'rate_limited' when the server sent Retry-After.
  retryAfterSec?: number;
}

// What the constructor accepts. `cause` may reference a Request/URL holding a
// token, so it is stored non-enumerably on the standard Error `cause` slot and
// kept out of `meta`, `message`, and `toJSON()`.
export type GbitXPayErrorInit = GbitXPayErrorMeta & { cause?: unknown };

export class GbitXPayError extends Error {
  readonly code: GbitXPayErrorCode;
  readonly meta?: GbitXPayErrorMeta;

  constructor(code: GbitXPayErrorCode, message: string, init?: GbitXPayErrorInit) {
    super(message);
    this.name = 'GbitXPayError';
    this.code = code;

    // Only safe fields go on the enumerable, serializable `meta`.
    const meta: GbitXPayErrorMeta = {};
    if (init?.onboardingStatus) meta.onboardingStatus = init.onboardingStatus;
    if (typeof init?.retryAfterSec === 'number') meta.retryAfterSec = init.retryAfterSec;
    this.meta = Object.keys(meta).length ? meta : undefined;

    // The cause (if any) is stored NON-enumerably so spreads / JSON / crash
    // reporters that walk own-enumerable keys never see it.
    if (init && 'cause' in init) {
      Object.defineProperty(this, 'cause', { value: init.cause, enumerable: false, writable: false, configurable: true });
    }

    // Keep instanceof working across transpile targets / bundlers.
    Object.setPrototypeOf(this, GbitXPayError.prototype);
  }

  // Custom serialization so a crash reporter or JSON.stringify() can never
  // leak `cause` (which might hold the checkout URL with #t=<clientToken>).
  // Only the safe, non-sensitive fields are emitted.
  toJSON() {
    const out: Record<string, unknown> = {
      name: this.name,
      code: this.code,
      message: this.message,
    };
    if (this.meta?.onboardingStatus) out.onboardingStatus = this.meta.onboardingStatus;
    if (typeof this.meta?.retryAfterSec === 'number') out.retryAfterSec = this.meta.retryAfterSec;
    return out;
  }
}

// Narrowing helper for consumers who don't want `instanceof`.
export function isGbitXPayError(e: unknown): e is GbitXPayError {
  return e instanceof GbitXPayError || (typeof e === 'object' && e !== null && (e as { name?: string }).name === 'GbitXPayError');
}
