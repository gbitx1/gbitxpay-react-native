# Changelog

## 0.2.0 (2026-11-09)

- Default API base is now `https://api.gbitxpay.com` (GbitXPay moved to its own domain). Earlier versions default to `https://gateway.gbitx.com`, which is being retired, so upgrade to keep receiving payments.
- The checkout origin is still whatever `GET /v1/sdk/config` returns (now `https://www.gbitxpay.com`); nothing to configure.
- Docs and homepage: `https://doc.gbitxpay.com`.

## 0.1.0 (2026-07-12)

Initial React Native SDK for GbitXPay.

- `GbitXPay.configure()` — validates the publishable key against `GET /v1/sdk/config` (typed error taxonomy, environment cross‑check, bounded timeout).
- `GbitXPay.present()` — opens the hosted checkout in a hardened, origin‑locked WebView and resolves a single typed `PaymentResult`.
- `<GbitXPayProvider>` host + `useGbitXPay()` hook.
- Security hardening per the mobile‑SDK design: pinned checkout origin, navigation lock, committed‑origin message trust gate, defensive message parsing + payment whitelist, single settle latch, credential redaction, file/window/cookie lockdown, expiry backstop, no native module.
- Full unit test suite over the pure core (validation, config taxonomy, message parsing, errors, redaction, controller).
