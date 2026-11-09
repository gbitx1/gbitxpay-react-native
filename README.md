# @gbitx/pay-react-native

Accept crypto payments in your React Native app with **GbitXPay**. The SDK opens the hosted GbitX checkout inside a hardened, origin‑locked WebView and hands you a single typed result.

- One‑line `present()` per payment; `configure()` once at startup.
- No secret key, no address handling, no wallet code ever ships in your app.
- Pure JS over `react-native-webview` — no native module of its own. Works on the New Architecture.
- TypeScript‑first. Fully typed public surface.

> **Read this first.** Fulfilment is driven **only** by the signed server webhook (or a server‑side read of the payment with your secret key). The SDK's `confirmed` result is a **UX signal**, not proof of payment — it can be forged on a compromised device. Never release goods or credit an account from an SDK callback.

---

## How it works

```
Your server (SECRET key gk_)                 Your app (PUBLISHABLE key pk_)
────────────────────────────                 ─────────────────────────────
POST /v1/payments  ──────────────▶  { id, clientToken }
   │                                          │
   └── hands { id, clientToken } to app ──────┘
                                              │
                                   GbitXPay.present({ paymentId, clientToken })
                                              │
                                   opens www.gbitxpay.com checkout in a WebView
                                              │
   signed webhook  ◀──── PAYMENT_CONFIRMED ───┤ (source of truth)
   fulfil the order here                      └── result: { status: 'confirmed', … }  (UX only)
```

Your **server** creates the payment with your **secret** key and gives the app only `{ paymentId, clientToken }`. The app never calls `POST /v1/payments`, and the secret key must **never** be in your app binary.

The SDK validates your publishable key against the API host `api.gbitxpay.com` (the `apiBaseUrl` default), which returns the separate, pinned checkout origin `www.gbitxpay.com` that the WebView locks to. They are intentionally different hosts. (`doc.gbitxpay.com` is the docs site.)

---

## Install

```sh
npm install @gbitx/pay-react-native react-native-webview
# or: yarn add @gbitx/pay-react-native react-native-webview
cd ios && pod install    # bare RN only
```

`react`, `react-native`, and `react-native-webview` are **peer dependencies** you provide (`react-native-webview` **>=13 and <15**). Minimum: iOS 13 / Android 6 (API 23) with an up‑to‑date System WebView.

---

## Quickstart

**1. Mount the provider once at your app root:**

```tsx
import { GbitXPayProvider } from '@gbitx/pay-react-native';

export default function App() {
  return (
    <GbitXPayProvider>
      <RootNavigator />
    </GbitXPayProvider>
  );
}
```

**2. Configure once (e.g. on startup), with your publishable key:**

```ts
import { GbitXPay } from '@gbitx/pay-react-native';

await GbitXPay.configure({ publishableKey: 'pk_live_…' });
```

**3. Present a checkout when the user pays:**

```ts
// paymentId + clientToken come from YOUR server's POST /v1/payments response.
const result = await GbitXPay.present({ paymentId, clientToken });

switch (result.status) {
  case 'confirmed': showThankYou(result.payment); break;   // UX only — fulfil via webhook
  case 'cancelled': /* user closed */ break;
  case 'expired':   /* 60‑min window elapsed */ break;
  case 'failed':    /* payment failed */ break;
}
```

Prefer hooks?

```tsx
import { useGbitXPay } from '@gbitx/pay-react-native';
const { present } = useGbitXPay();
```

---

## Your server: creating the payment

The app must receive `{ paymentId, clientToken }` from your backend. Your backend calls `POST /v1/payments` with the **secret** key:

```js
// Node/Express — on YOUR server. Never in the app.
app.post('/checkout', async (req, res) => {
  const r = await fetch('https://api.gbitxpay.com/v1/payments', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${process.env.GBITX_SECRET_KEY}`, // gk_live_…
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ amount: 49.99, currency: 'USD', description: 'Order #1234' }),
  });
  const { payment } = await r.json();
  // Send ONLY these two to the app:
  res.json({ paymentId: payment.id, clientToken: payment.clientToken });
});
```

Then handle the signed webhook (`PAYMENT_CONFIRMED`) to fulfil the order. See the [example server](./example/server/create-payment.js).

---

## Security model

Three credentials, so nothing dangerous ever ships in a binary:

| Credential | Lives | Can do |
| --- | --- | --- |
| **Secret key** `gk_` | Your **server** | Create/read all payments |
| **Publishable key** `pk_` | Your **app** (this SDK) | Identify your account. **No** payment authority |
| **Client token** | Your app, per payment | Drive **one** 60‑minute checkout |

The SDK additionally:

- **Pins the checkout origin** from your validated config and locks the WebView to it (`originWhitelist`, navigation lock, no child windows, no file access, `mixedContentMode: never`).
- **Gates every bridge message** on the WebView's committed origin and re‑validates its shape; unknown/oversized/malformed messages are dropped.
- **Never logs** your key or the client token, and never surfaces the checkout URL (only its origin + path, redacted, when debug is on). The client token rides in the URL *fragment* (`#t=…`), so the **SDK itself never transmits it** and holds it in memory only, clearing it when the checkout closes. (The pinned checkout page forwards it over TLS to its own origin's gateway to poll status / authorize cancel — inside the pinned‑origin trust boundary.)
- Settles each checkout **exactly once** and never treats a `confirmed` event as fulfilment.

### Must‑know rules

- **Fulfil on your server, from the signed webhook** (`PAYMENT_CONFIRMED`) or a server‑side `GET /v1/payments/:id` with your secret key. SDK callbacks are UX only and forgeable on a compromised device.
- **The app holds a publishable key only.** Passing a `gk_` secret key throws `secret_key_used` — remove it from your app immediately.
- **The client token is single‑payment and short‑lived** (dies with the 60‑minute payment). The SDK never persists it and it must never be logged. A new attempt requires your server to mint a new payment.
- **Networking is HTTPS‑only to www.gbitxpay.com.** Do **not** add an iOS ATS exception (`NSAllowsArbitraryLoads`) or Android cleartext (`usesCleartextTraffic="true"`) on the SDK's behalf — none is needed and it weakens your whole app.

---

## App Store & Play Store

Crypto is permitted for **physical goods** and **real‑world services** (Apple Guideline 3.1.1 / Google Play Billing policy). **Digital goods or services consumed in‑app must use Apple IAP / Google Play Billing** — do not use this SDK for those. Crypto‑touching apps should be published under an established legal entity.

---

## API

### `GbitXPay.configure(options): Promise<void>`

| Option | Type | Default | Notes |
| --- | --- | --- | --- |
| `publishableKey` | `string` | — | `pk_live_…` / `pk_test_…`. Validated against the server. |
| `environment` | `'live' \| 'test'` | inferred | If set, must match the key and the server. |
| `timeoutMs` | `number` | `10000` | Bounded timeout for the validation call. |
| `apiBaseUrl` | `string` | `https://api.gbitxpay.com` | Override for staging. Must be https. |
| `debug` | `boolean` | `false` | Redacted debug logging (never prints key/token). |

Must complete before `present()`. Rejects with a typed `GbitXPayError` (see below).

### `GbitXPay.present(options): Promise<PaymentResult>`

| Option | Type | Notes |
| --- | --- | --- |
| `paymentId` | `string` | From your server's create response. |
| `clientToken` | `string` | From your server's create response. |
| `onLoaded?` | `() => void` | Fires once when the checkout is interactive. |
| `onEvent?` | `(e: CheckoutEvent) => void` | Streams lifecycle events (UX only). |

Resolves with a `PaymentResult`:

```ts
type PaymentResult =
  | { status: 'confirmed'; payment: SanitizedPayment | null }
  | { status: 'cancelled'; reason?: 'user_closed' | 'dismissed' | 'back_button' | 'load_failed'; payment?: SanitizedPayment | null }
  | { status: 'expired';   reason?: 'expired' | 'client_backstop'; payment?: SanitizedPayment | null }
  | { status: 'failed';    payment?: SanitizedPayment | null };
```

A cancelled/expired/failed outcome is a **normal result**, not an error. It **rejects** only for SDK/credential faults.

### Errors — `GbitXPayError`

`error.code` is one of:

| code | meaning |
| --- | --- |
| `not_configured` | `present()` before a successful `configure()` |
| `not_mounted` | no `<GbitXPayProvider>` in the tree |
| `invalid_key` | key wrong/revoked/malformed |
| `secret_key_used` | a `gk_` secret key was passed — remove it from the app |
| `environment_mismatch` | key env and server env disagree |
| `onboarding_required` | merchant not yet approved for this live key (`meta.onboardingStatus`) |
| `merchant_suspended` | merchant account inactive |
| `rate_limited` | too many config calls (`meta.retryAfterSec`) |
| `network_error` | couldn't reach GbitX (offline/DNS/TLS/timeout) |
| `server_error` | GbitX returned 5xx or an unusable response |
| `invalid_arguments` | bad `paymentId`/`clientToken`, or a checkout already open |

```ts
import { GbitXPayError, isGbitXPayError } from '@gbitx/pay-react-native';
try {
  await GbitXPay.configure({ publishableKey });
} catch (e) {
  if (isGbitXPayError(e) && e.code === 'secret_key_used') { /* fix your integration */ }
}
```

### `SanitizedPayment`

Exactly the fields the checkout emits — `address`, `txHash`, and `externalRef` are intentionally **not** included (never readable client‑side). Amounts are decimal‑safe strings.

```ts
interface SanitizedPayment {
  id: string;
  status: 'PENDING' | 'AWAITING_PAYMENT' | 'UNDERPAID' | 'CONFIRMING' | 'CONFIRMED' | 'EXPIRED' | 'FAILED' | 'CANCELLED';
  amount: string; currency: string;
  crypto: string | null; network: string | null;
  amountCrypto: string | null; amountPaid: string | null;
  mode: 'LIVE' | 'SANDBOX';
  confirmedAt: string | null; expiresAt: string;
}
```

---

## Requirements

| | Version |
| --- | --- |
| react | ≥ 17 |
| react-native | ≥ 0.71 (New Architecture supported) |
| react-native-webview | ≥ 13 < 15 |
| iOS | 13+ |
| Android | 6 / API 23+ |

## License

MIT © GBIT TECHNOLOGIES LIMITED COMPANY
