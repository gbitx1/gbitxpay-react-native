# Changelog

## 0.1.0 (unreleased)

Initial React Native SDK for GbitXPay.

- `GbitXPay.configure()` — validates the publishable key against `GET /v1/sdk/config` (typed error taxonomy, environment cross‑check, bounded timeout).
- `GbitXPay.present()` — opens the hosted checkout in a hardened, origin‑locked WebView and resolves a single typed `PaymentResult`.
- `<GbitXPayProvider>` host + `useGbitXPay()` hook.
- Security hardening per the mobile‑SDK design: pinned checkout origin, navigation lock, committed‑origin message trust gate, defensive message parsing + payment whitelist, single settle latch, credential redaction, file/window/cookie lockdown, expiry backstop, no native module.
- Full unit test suite over the pure core (validation, config taxonomy, message parsing, errors, redaction, controller).
