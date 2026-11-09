import { test } from 'node:test';
import assert from 'node:assert/strict';
import { GbitXPayError, isGbitXPayError } from '../src/errors';

test('GbitXPayError carries code + message and is a real Error', () => {
  const e = new GbitXPayError('invalid_key', 'bad');
  assert.ok(e instanceof Error);
  assert.ok(e instanceof GbitXPayError);
  assert.equal(e.code, 'invalid_key');
  assert.equal(e.name, 'GbitXPayError');
});

test('isGbitXPayError narrows correctly', () => {
  assert.ok(isGbitXPayError(new GbitXPayError('server_error', 'x')));
  assert.ok(!isGbitXPayError(new Error('x')));
  assert.ok(!isGbitXPayError(null));
  assert.ok(!isGbitXPayError({ code: 'invalid_key' }));
});

test('toJSON never leaks cause or a token', () => {
  const e = new GbitXPayError('network_error', 'nope', {
    cause: new Error('boom at https://www.gbitxpay.com/p/x#t=SUPERSECRETTOKEN'),
  });
  const json = JSON.stringify(e);
  assert.ok(!json.includes('SUPERSECRETTOKEN'));
  assert.ok(!json.includes('cause'));
  assert.ok(json.includes('network_error'));
});

test('toJSON surfaces onboardingStatus + retryAfterSec when present', () => {
  assert.ok(JSON.stringify(new GbitXPayError('onboarding_required', 'x', { onboardingStatus: 'PENDING_APPROVAL' })).includes('PENDING_APPROVAL'));
  assert.ok(JSON.stringify(new GbitXPayError('rate_limited', 'x', { retryAfterSec: 42 })).includes('42'));
});
