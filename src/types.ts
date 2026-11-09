// Public type surface for @gbitx/pay-react-native.
//
// This module is deliberately free of any react-native import so the core
// (types + validation + config + message parsing) stays testable in plain
// Node and safe to import anywhere.

export type Environment = 'live' | 'test';

// Mirrors the server PaymentStatus enum (gatewayService prisma schema).
export type PaymentStatus =
  | 'PENDING'
  | 'AWAITING_PAYMENT'
  | 'UNDERPAID'
  | 'CONFIRMING'
  | 'CONFIRMED'
  | 'EXPIRED'
  | 'FAILED'
  | 'CANCELLED';

// EXACTLY the fields the hosted checkout emits via serializePayment
// (gbitxpay-frontend/src/pages/PaymentPage.jsx). `address`, `txHash`,
// `cancelToken`, and `externalRef` are intentionally absent: the page
// strips them, and an app must never believe it can read on-chain or
// private fields client-side. Amounts arrive as decimal-safe strings.
export interface SanitizedPayment {
  id: string;
  status: PaymentStatus;
  amount: string;
  currency: string;
  crypto: string | null;
  network: string | null;
  amountCrypto: string | null;
  amountPaid: string | null;
  mode: 'LIVE' | 'SANDBOX';
  confirmedAt: string | null;
  expiresAt: string;
}

// Why a checkout ended without a confirmation. UX/analytics only.
export type CancelReason = 'user_closed' | 'dismissed' | 'back_button' | 'load_failed';
export type ExpiredReason = 'expired' | 'client_backstop';

// The terminal outcome of a checkout session. This is NOT an error — a
// cancelled or expired payment is a normal, expected result. `payment` is
// populated in practice for confirmed checkouts (the page always sends it)
// but is typed nullable because a bridge message is device-controllable and
// UX-only: fulfilment is driven by the signed server webhook, never by this.
export type PaymentResult =
  | { status: 'confirmed'; payment: SanitizedPayment | null }
  | { status: 'cancelled'; reason?: CancelReason; payment?: SanitizedPayment | null }
  | { status: 'expired'; reason?: ExpiredReason; payment?: SanitizedPayment | null }
  | { status: 'failed'; payment?: SanitizedPayment | null };

export interface ConfigureOptions {
  // The merchant's PUBLISHABLE key (pk_live_… / pk_test_…). Safe to embed.
  publishableKey: string;
  // Optional assertion. If set it must match BOTH the key prefix and the
  // server's reported environment, else configure() rejects with
  // 'environment_mismatch'.
  environment?: Environment;
  // Bounded timeout (ms) for the GET /v1/sdk/config validation call.
  // Default 10_000.
  timeoutMs?: number;
  // Override the GbitX API base (default https://api.gbitxpay.com). Must be
  // https. For staging/testing only — never point this at an untrusted host.
  apiBaseUrl?: string;
  // Enable redacted debug logging (never prints a key/token/full URL).
  debug?: boolean;
}

// Non-sensitive merchant info resolved at configure() time.
export interface MerchantInfo {
  name: string;
  website: string | null;
}

export type CheckoutEventType =
  | 'loaded'
  | 'confirmed'
  | 'cancelled'
  | 'expired'
  | 'failed'
  | 'closed';

export interface CheckoutEvent {
  type: CheckoutEventType;
  payment?: SanitizedPayment;
}

export interface PresentOptions {
  // From YOUR server's POST /v1/payments response (id + clientToken). The
  // app never creates payments; your server does, with the SECRET key.
  paymentId: string;
  clientToken: string;
  // Optional progress callbacks (UX only). onLoaded fires at most once when
  // the checkout is interactive; onEvent streams every bridge lifecycle event.
  onLoaded?: () => void;
  onEvent?: (event: CheckoutEvent) => void;
}
