# Security

This SDK opens the GbitXPay hosted checkout inside a hardened `react-native-webview`. It was built against a written hardening spec and passed an adversarial review. This document states the trust model, what the SDK guarantees, and the residual risks it cannot close on its own.

## The one invariant

**Fulfilment is driven only by the signed server webhook** (`PAYMENT_CONFIRMED`) or a server‑side `GET /v1/payments/:id` authenticated with your **secret** key. The SDK's `confirmed` result is a **UX signal**, not proof of payment. Everything below assumes you honor this — it is what bounds the blast radius of every residual risk.

## What the SDK enforces

- **Pinned origin.** The checkout origin is taken from your validated `GET /v1/sdk/config`, asserted `https`, and frozen. `present()` cannot override it.
- **Sole‑gate navigation lock.** `originWhitelist` is `['*']` so the library never auto‑decides (its built‑in whitelist is a loose *prefix* match); every navigation is routed to an exact‑origin check. Only the pinned origin over `https` may load. Off‑origin navigations are blocked and opened **nowhere** — the SDK never calls `Linking.openURL`, so a compromised page cannot force‑launch an external URL or wallet deep‑link.
- **Authenticated message trust gate.** Bridge messages are trusted on the WebView's **authenticated sender origin** (`event.nativeEvent.url` — iOS `WKScriptMessage.frameInfo`, Android `WebMessageListener` sourceOrigin), with exact origin + `/p/` path equality, falling back to the committed top‑frame only when the platform provides no sender URL. Messages are **bound to the active `paymentId`**.
- **Defensive parsing.** Bridge payloads are size‑capped, `JSON.parse`d in a guard, shape‑validated against a known event set, and re‑picked into a fresh object holding only the whitelisted payment fields (no `address`, `txHash`, `externalRef`; no prototype‑pollution or function keys survive).
- **Single settle.** Each checkout resolves exactly once; a native dismissal (back, swipe, unmount) still settles so `present()` never hangs, and a fixed 65‑minute client backstop (just beyond the 60‑minute server payment expiry) bounds the session.
- **Credential hygiene.** The publishable key, client token, and full checkout URL never reach a log. The token rides in the URL *fragment* (`#t=…`), so **the SDK itself never transmits it in a request** and holds it in memory only, clearing it when the checkout closes. (The pinned checkout page's own JS does read the fragment and forward the token over TLS to its own origin's gateway to poll status and authorize cancel — that is inside the pinned‑origin trust boundary, not a leak to a third party.) `GbitXPayError` keeps its transport `cause` non‑enumerable.
- **WebView lockdown.** No file access, no multiple windows, no third‑party/shared cookies, `mixedContentMode: 'never'`, no injected JS, no camera/mic grants.

## Residual risks (cannot be closed client‑side)

1. **A compromised checkout origin can emit a forged `confirmed`.** If `pay.gbitx.com` itself is compromised or MITM'd, a same‑origin page can send any bridge event. No client can distinguish this. **Mitigation: webhook‑is‑truth** — never fulfil from the SDK result. TLS + the origin lock prevent MITM; this is why fulfilment lives on your server.
2. **Android sub‑frame navigations aren't gated by `onShouldStartLoadWithRequest`** (a platform limitation). The checkout page ships no iframes and `mixedContentMode: 'never'` blocks `http` frames; any off‑origin frame that did load could not forge a trusted message (the authenticated‑origin gate rejects it) nor navigate the top frame. Defense in depth belongs in the page's CSP (`frame-src`).
3. **iOS App‑Bound Domains** (`WKAppBoundDomains` / `limitsNavigationsToAppBoundDomains`) is an optional native origin lock we do **not** force, because it requires merchant `Info.plist` entries and constrains other WebViews in the app. Consider adding it if your app uses only a small set of WebView domains.
4. **TLS public‑key pinning** for `pay.gbitx.com` is a recommended fast‑follow, not enabled by default.

## Reporting a vulnerability

Email **security@gbitx.com**. Please do not open a public issue for security reports.
