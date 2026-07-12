// Example GbitXPay backend (Node/Express). This is the ONLY place your
// SECRET key (gk_) is ever used. The app receives just { paymentId, clientToken }.
//
//   npm i express
//   GBITX_SECRET_KEY=gk_live_… GBITX_WEBHOOK_SECRET=whsec_… node create-payment.js

import express from 'express';
import crypto from 'node:crypto';

const app = express();
const GATEWAY = process.env.GBITX_API_BASE || 'https://gateway.gbitx.com';
const SECRET_KEY = process.env.GBITX_SECRET_KEY;       // gk_live_… / gk_test_…
const WEBHOOK_SECRET = process.env.GBITX_WEBHOOK_SECRET; // whsec_…

// ── 1) Create a payment; return ONLY what the app needs ──────────────────────
app.post('/checkout', express.json(), async (req, res) => {
  const r = await fetch(`${GATEWAY}/v1/payments`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${SECRET_KEY}`,
      'Content-Type': 'application/json',
      // Idempotency-Key is recommended in production to make retries safe.
    },
    body: JSON.stringify({
      amount: 49.99,
      currency: 'USD',
      description: 'Order #1234',
      // externalRef: your internal order id (kept server-side; never sent to the app)
    }),
  });
  if (!r.ok) return res.status(502).json({ error: 'gateway_error' });
  const { payment } = await r.json();

  // NEVER send the full paymentUrl, the secret key, or anything else.
  res.json({ paymentId: payment.id, clientToken: payment.clientToken });
});

// ── 2) The signed webhook is the SOURCE OF TRUTH for fulfilment ──────────────
// Verify the HMAC over `${timestamp}.${rawBody}` and only then fulfil.
app.post('/webhooks/gbitx', express.raw({ type: '*/*' }), (req, res) => {
  const header = req.get('X-GbitX-Signature') || '';
  const parts = Object.fromEntries(header.split(',').map((p) => p.split('=').map((s) => s.trim())));
  const timestamp = Number(parts.t);
  const received = parts.v1;
  if (!timestamp || !received) return res.status(400).end();

  // Freshness (defeat replay).
  if (Math.abs(Math.floor(Date.now() / 1000) - timestamp) > 300) return res.status(400).end();

  const expected = crypto.createHmac('sha256', WEBHOOK_SECRET)
    .update(`${timestamp}.${req.body.toString('utf8')}`)
    .digest('hex');
  const a = Buffer.from(expected, 'hex');
  const b = Buffer.from(received, 'hex');
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return res.status(401).end();

  const event = JSON.parse(req.body.toString('utf8'));
  if (event.type === 'PAYMENT_CONFIRMED') {
    // ✅ Fulfil the order HERE — this is trustworthy. Not the app callback.
    // fulfilOrder(event.data.externalRef);
  }
  res.json({ received: true });
});

app.listen(3000, () => console.log('example gbitx backend on :3000'));
