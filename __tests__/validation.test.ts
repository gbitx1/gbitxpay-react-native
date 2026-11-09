import { test } from 'node:test';
import assert from 'node:assert/strict';
import { assertPublishableKey, assertPaymentArgs, assertHttpsOrigin, buildCheckoutUrl } from '../src/validation';
import { grab } from './_helpers';

const PK_TEST = 'pk_test_' + 'a'.repeat(64);
const PK_LIVE = 'pk_live_' + 'b'.repeat(64);

test('assertPublishableKey accepts valid keys and infers environment', () => {
  assert.deepEqual(assertPublishableKey(PK_TEST), { key: PK_TEST, environment: 'test' });
  assert.deepEqual(assertPublishableKey(PK_LIVE), { key: PK_LIVE, environment: 'live' });
});

test('assertPublishableKey trims surrounding whitespace', () => {
  assert.equal(assertPublishableKey(`  ${PK_TEST}  `).key, PK_TEST);
});

test('assertPublishableKey rejects a secret key with secret_key_used and never echoes it', () => {
  const secret = 'gk_live_' + 'c'.repeat(64);
  const err = grab(() => assertPublishableKey(secret));
  assert.equal(err.code, 'secret_key_used');
  assert.ok(!err.message.includes(secret));
});

test('assertPublishableKey rejects malformed / empty / non-string keys', () => {
  const bads: unknown[] = ['pk_live_xyz', 'pk_prod_' + 'a'.repeat(64), 'pk_test_' + 'a'.repeat(63), 'PK_TEST_' + 'a'.repeat(64), '', '   ', 42, null, undefined, {}];
  for (const bad of bads) {
    const err = grab(() => assertPublishableKey(bad));
    assert.ok(err.code === 'invalid_key' || err.code === 'secret_key_used', `key ${String(bad)} -> ${err.code}`);
  }
});

test('assertPaymentArgs accepts a cuid-like id and hex token', () => {
  const r = assertPaymentArgs('ckpayment12345', 'a'.repeat(32));
  assert.deepEqual(r, { paymentId: 'ckpayment12345', clientToken: 'a'.repeat(32) });
});

test('assertPaymentArgs rejects url-breaking / malformed values', () => {
  const bads: Array<[unknown, unknown]> = [
    ['bad/id', 'a'.repeat(32)],
    ['id with space', 'a'.repeat(32)],
    ['id#frag', 'a'.repeat(32)],
    ['id?q=1', 'a'.repeat(32)],
    ['short', 'a'.repeat(32)],
    ['okpaymentid', 'tok'],
    ['okpaymentid', 'a'.repeat(200)],
    ['okpaymentid', 'has space toktoktoktok'],
    ['okpaymentid', 'tok#frag' + 'x'.repeat(20)],
    [null, 'a'.repeat(32)],
    ['okpaymentid', null],
  ];
  for (const [id, tok] of bads) {
    const err = grab(() => assertPaymentArgs(id, tok));
    assert.equal(err.code, 'invalid_arguments', `${String(id)} / ${String(tok)}`);
  }
});

test('assertHttpsOrigin enforces https and returns canonical origin', () => {
  assert.equal(assertHttpsOrigin('https://www.gbitxpay.com/p/x?y#z', 'checkoutBaseUrl'), 'https://www.gbitxpay.com');
  assert.equal(grab(() => assertHttpsOrigin('http://www.gbitxpay.com', 'x')).code, 'invalid_arguments');
  assert.equal(grab(() => assertHttpsOrigin('not a url', 'x')).code, 'invalid_arguments');
});

test('buildCheckoutUrl embeds embed=native and the token fragment', () => {
  const url = buildCheckoutUrl('https://www.gbitxpay.com', 'pay123456', 'a'.repeat(32));
  assert.ok(url.startsWith('https://www.gbitxpay.com/p/pay123456?embed=native#t='));
  assert.ok(url.endsWith('#t=' + 'a'.repeat(32)));
});
