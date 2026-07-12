# Example

- [`App.tsx`](./App.tsx) — a minimal RN screen: `configure()` once, `present()` per payment, and reading the result (UX only).
- [`server/create-payment.js`](./server/create-payment.js) — the backend half: creates the payment with the **secret** key and returns `{ paymentId, clientToken }`, plus a signed‑webhook handler that is the real source of truth for fulfilment.

Wire `App.tsx`'s `MY_BACKEND` to your server and set a real `PUBLISHABLE_KEY` (`pk_test_…`).

The golden rule: the app never sees the secret key, and the order is fulfilled on the server from the `PAYMENT_CONFIRMED` webhook — never from the SDK result.
