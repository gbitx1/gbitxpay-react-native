import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseBridgeMessage, sanitizePayment, terminalResult, isTerminal } from '../src/messageHandler';

const goodPayment = {
  id: 'pay1', status: 'CONFIRMED', amount: '10.00', currency: 'USD',
  crypto: 'BTC', network: 'bitcoin', amountCrypto: '0.0003', amountPaid: '0.0003',
  mode: 'LIVE', confirmedAt: '2026-07-10T00:00:00Z', expiresAt: '2026-07-10T01:00:00Z',
};

test('parseBridgeMessage accepts a known confirmed event', () => {
  const m = parseBridgeMessage(JSON.stringify({ type: 'gbitx:payment:confirmed', payment: goodPayment }));
  assert.equal(m?.type, 'confirmed');
  assert.equal(m?.payment?.id, 'pay1');
  assert.equal(m?.payment?.status, 'CONFIRMED');
});

test('parseBridgeMessage: loaded may arrive with no payment', () => {
  const m = parseBridgeMessage(JSON.stringify({ type: 'gbitx:payment:loaded' }));
  assert.equal(m?.type, 'loaded');
  assert.equal(m?.payment, null);
});

test('parseBridgeMessage drops unknown types, non-strings, bad json, arrays, oversized', () => {
  assert.equal(parseBridgeMessage(JSON.stringify({ type: 'gbitx:payment:hacked' })), null);
  assert.equal(parseBridgeMessage(JSON.stringify({ type: 'nope' })), null);
  assert.equal(parseBridgeMessage(JSON.stringify({ notype: 1 })), null);
  assert.equal(parseBridgeMessage(123 as unknown as string), null);
  assert.equal(parseBridgeMessage('{not json'), null);
  assert.equal(parseBridgeMessage(JSON.stringify([1, 2, 3])), null);
  assert.equal(parseBridgeMessage('x'.repeat(9000)), null);
  assert.equal(parseBridgeMessage(''), null);
});

test('sanitizePayment strips address/txHash/externalRef and any extra keys', () => {
  const p = sanitizePayment({
    ...goodPayment,
    address: 'bc1qevil',
    txHash: 'deadbeef',
    externalRef: 'secret-order-42',
    evilFn: 'x',
    nested: { a: 1 },
  }) as unknown as Record<string, unknown>;
  assert.ok(p);
  assert.equal(p.address, undefined);
  assert.equal(p.txHash, undefined);
  assert.equal(p.externalRef, undefined);
  assert.equal(p.evilFn, undefined);
  assert.equal(p.nested, undefined);
  // whitelist survives
  assert.equal(p.id, 'pay1');
  assert.equal(p.amount, '10.00');
});

test('sanitizePayment rejects payloads with no id or an unknown status', () => {
  assert.equal(sanitizePayment({ status: 'CONFIRMED' }), null);
  assert.equal(sanitizePayment({ id: 'x', status: 'HACKED' }), null);
  assert.equal(sanitizePayment(null), null);
  assert.equal(sanitizePayment('str'), null);
  assert.equal(sanitizePayment([]), null);
});

test('sanitizePayment coerces finite numeric amounts to strings', () => {
  const p = sanitizePayment({ id: 'p', status: 'PENDING', amount: 10, amountCrypto: 0.5, expiresAt: 'x' });
  assert.equal(p?.amount, '10');
  assert.equal(p?.amountCrypto, '0.5');
  assert.equal(p?.mode, 'SANDBOX'); // defaulted when absent
});

test('sanitizePayment drops numbers that stringify to exponential notation', () => {
  const p = sanitizePayment({ id: 'p', status: 'PENDING', amount: 1e-8, amountCrypto: 1e21, expiresAt: 'x' });
  // never surface "1e-8" / "1e+21" to a merchant: amount falls back to '',
  // the nullable amountCrypto becomes null.
  assert.equal(p?.amount, '');
  assert.equal(p?.amountCrypto, null);
});

test('terminalResult maps every terminal type; loaded is non-terminal', () => {
  assert.equal(terminalResult('loaded', null), null);
  assert.deepEqual(terminalResult('confirmed', null), { status: 'confirmed', payment: null });
  assert.equal(terminalResult('cancelled', null)?.status, 'cancelled');
  assert.equal(terminalResult('closed', null)?.status, 'cancelled');
  assert.equal(terminalResult('expired', null)?.status, 'expired');
  assert.equal(terminalResult('failed', null)?.status, 'failed');
  assert.equal(isTerminal('loaded'), false);
  assert.equal(isTerminal('confirmed'), true);
});
