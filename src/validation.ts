import { GbitXPayError } from './errors';
import type { Environment } from './types';

// A publishable key: pk_{live|test}_ + 32 random bytes hex (256-bit), exactly
// matching generateApiKey() in gatewayService/src/utils/crypto.js.
const PUBLISHABLE_KEY_RE = /^pk_(live|test)_[0-9a-f]{64}$/;

// paymentId is a cuid from Prisma (@default(cuid())): url-safe, no
// slash/dot/whitespace. We reject anything that could rewrite the URL
// path/query/fragment rather than relying on encoding alone.
const PAYMENT_ID_RE = /^[A-Za-z0-9_-]{8,64}$/;

// clientToken is the payment cancelToken (crypto.randomBytes(16).hex = 32 hex
// chars today). Kept a bounded alphanumeric charset so it can never carry
// control chars into the URL fragment; permissive on length for future-proofing.
const CLIENT_TOKEN_RE = /^[A-Za-z0-9]{16,128}$/;

// Validate the publishable key BEFORE any network call. A secret key gets its
// own security-flavored error so an integrator immediately pulls it out of the
// binary. The key value is NEVER included in an error message.
export function assertPublishableKey(publishableKey: unknown): { key: string; environment: Environment } {
  if (typeof publishableKey !== 'string' || publishableKey.trim() === '') {
    throw new GbitXPayError('invalid_key', 'A publishableKey string is required.');
  }
  const key = publishableKey.trim();
  if (key.startsWith('gk_')) {
    throw new GbitXPayError(
      'secret_key_used',
      'A SECRET key (gk_) was passed to the SDK. Use a publishable key (pk_) only, and remove the secret key from your app immediately.',
    );
  }
  if (!PUBLISHABLE_KEY_RE.test(key)) {
    throw new GbitXPayError('invalid_key', 'publishableKey must look like pk_live_… or pk_test_….');
  }
  const environment: Environment = key.startsWith('pk_live_') ? 'live' : 'test';
  return { key, environment };
}

// Validate present() arguments BEFORE building any URL or presenting anything.
export function assertPaymentArgs(
  paymentId: unknown,
  clientToken: unknown,
): { paymentId: string; clientToken: string } {
  const id = typeof paymentId === 'string' ? paymentId.trim() : '';
  const token = typeof clientToken === 'string' ? clientToken.trim() : '';
  if (!PAYMENT_ID_RE.test(id)) {
    throw new GbitXPayError('invalid_arguments', 'paymentId is missing or malformed.');
  }
  if (!CLIENT_TOKEN_RE.test(token)) {
    throw new GbitXPayError('invalid_arguments', 'clientToken is missing or malformed.');
  }
  return { paymentId: id, clientToken: token };
}

// Assert an https origin and return its canonical origin form. Used for both
// the API base and the server-returned checkout base.
export function assertHttpsOrigin(raw: unknown, label: string): string {
  if (typeof raw !== 'string' || raw.trim() === '') {
    throw new GbitXPayError('invalid_arguments', `${label} is required.`);
  }
  let u: URL;
  try {
    u = new URL(raw.trim());
  } catch {
    throw new GbitXPayError('invalid_arguments', `${label} is not a valid URL.`);
  }
  if (u.protocol !== 'https:') {
    throw new GbitXPayError('invalid_arguments', `${label} must be https.`);
  }
  return u.origin;
}

// Build the checkout URL. Args are pre-validated; we still encodeURIComponent
// as belt-and-suspenders. The clientToken rides in the fragment (#t=) exactly
// like POST /v1/payments returns, so the page's existing hash-capture works.
export function buildCheckoutUrl(checkoutOrigin: string, paymentId: string, clientToken: string): string {
  return `${checkoutOrigin}/p/${encodeURIComponent(paymentId)}?embed=native#t=${encodeURIComponent(clientToken)}`;
}
