import type { CheckoutEventType, PaymentResult, PaymentStatus, SanitizedPayment } from './types';

// Exact set of bridge event types the checkout page emits. Anything else is
// dropped. Keys are the wire `type` strings; values are the short event names.
const KNOWN_TYPES: Record<string, CheckoutEventType> = {
  'gbitx:payment:loaded': 'loaded',
  'gbitx:payment:confirmed': 'confirmed',
  'gbitx:payment:cancelled': 'cancelled',
  'gbitx:payment:expired': 'expired',
  'gbitx:payment:failed': 'failed',
  'gbitx:payment:closed': 'closed',
};

// A bridge message is a single JSON string. Cap it well under any sane size so
// a hostile page can't feed us a giant string before we even parse.
const MAX_MESSAGE_BYTES = 8192;

const PAYMENT_STATUSES: readonly PaymentStatus[] = [
  'PENDING', 'AWAITING_PAYMENT', 'UNDERPAID', 'CONFIRMING', 'CONFIRMED', 'EXPIRED', 'FAILED', 'CANCELLED',
];

export interface ParsedMessage {
  type: CheckoutEventType;
  // null for :loaded (the page sends {}) or when a payment payload is absent
  // / malformed. Terminal handling tolerates null (webhook is truth).
  payment: SanitizedPayment | null;
}

function asString(v: unknown): string | null {
  return typeof v === 'string' ? v : null;
}

// Accept string OR finite number for decimal amount fields (the page sends
// strings — Prisma Decimal — but we stay tolerant) and normalize to a plain
// decimal string. A number whose String() form uses exponential notation
// (very large, or small like 1e-8) is dropped to null rather than surfaced as
// "1e-8"/"1e+21"; the field is display-only, so null is safer than a
// misleading exponent.
function asDecimalString(v: unknown): string | null {
  if (typeof v === 'string') return v;
  if (typeof v === 'number' && Number.isFinite(v)) {
    const s = String(v);
    return s.includes('e') || s.includes('E') ? null : s;
  }
  return null;
}

// Re-pick ONLY the whitelisted fields into a fresh object. This discards any
// extra keys (prototype-pollution vectors, functions, nested junk, and the
// fields the page deliberately strips). Returns null if the payload is not a
// usable payment (no id or unknown status).
export function sanitizePayment(input: unknown): SanitizedPayment | null {
  if (!input || typeof input !== 'object' || Array.isArray(input)) return null;
  const p = input as Record<string, unknown>;

  const id = asString(p.id);
  const status = asString(p.status);
  if (!id || !status || !(PAYMENT_STATUSES as readonly string[]).includes(status)) return null;

  const mode = p.mode === 'LIVE' || p.mode === 'SANDBOX' ? p.mode : 'SANDBOX';

  return {
    id,
    status: status as PaymentStatus,
    amount: asDecimalString(p.amount) ?? '',
    currency: asString(p.currency) ?? '',
    crypto: asString(p.crypto),
    network: asString(p.network),
    amountCrypto: asDecimalString(p.amountCrypto),
    amountPaid: asDecimalString(p.amountPaid),
    mode,
    confirmedAt: asString(p.confirmedAt),
    expiresAt: asString(p.expiresAt) ?? '',
  };
}

// Defensively parse a raw onMessage string into a known event, or null. Never
// throws. Callers MUST have already verified the message origin (the WebView's
// committed top-frame URL) before invoking this.
export function parseBridgeMessage(raw: unknown): ParsedMessage | null {
  if (typeof raw !== 'string' || raw.length === 0 || raw.length > MAX_MESSAGE_BYTES) return null;

  let obj: unknown;
  try {
    obj = JSON.parse(raw);
  } catch {
    return null;
  }
  if (!obj || typeof obj !== 'object' || Array.isArray(obj)) return null;

  const type = (obj as { type?: unknown }).type;
  if (typeof type !== 'string') return null;
  const mapped = KNOWN_TYPES[type];
  if (!mapped) return null;

  return {
    type: mapped,
    payment: sanitizePayment((obj as { payment?: unknown }).payment),
  };
}

// True for the events that end a checkout session.
export function isTerminal(type: CheckoutEventType): boolean {
  return type !== 'loaded';
}

// Map a terminal event to a PaymentResult. `loaded` is non-terminal -> null.
// `closed` and `cancelled` collapse to a single cancelled representation.
export function terminalResult(type: CheckoutEventType, payment: SanitizedPayment | null): PaymentResult | null {
  switch (type) {
    case 'confirmed':
      return { status: 'confirmed', payment };
    case 'cancelled':
    case 'closed':
      return { status: 'cancelled', reason: 'user_closed', payment };
    case 'expired':
      return { status: 'expired', reason: 'expired', payment };
    case 'failed':
      return { status: 'failed', payment };
    case 'loaded':
    default:
      return null;
  }
}
