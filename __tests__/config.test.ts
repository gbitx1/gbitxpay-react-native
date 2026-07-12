import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mapConfigError, parseConfigSuccess } from '../src/config';
import { grab } from './_helpers';

test('mapConfigError: 403 ONBOARDING_REQUIRED -> onboarding_required with status meta', () => {
  const e = mapConfigError(403, { code: 'ONBOARDING_REQUIRED', message: 'not active', onboardingStatus: 'PENDING_APPROVAL' });
  assert.equal(e.code, 'onboarding_required');
  assert.equal(e.meta?.onboardingStatus, 'PENDING_APPROVAL');
});

test('mapConfigError: 403 other -> merchant_suspended', () => {
  assert.equal(mapConfigError(403, { message: 'Merchant account suspended' }).code, 'merchant_suspended');
});

test('mapConfigError: 401 and other 4xx -> invalid_key', () => {
  assert.equal(mapConfigError(401, { message: 'Invalid or revoked publishable key' }).code, 'invalid_key');
  assert.equal(mapConfigError(400, {}).code, 'invalid_key');
  assert.equal(mapConfigError(404, {}).code, 'invalid_key');
});

test('mapConfigError: 429 -> rate_limited carrying Retry-After', () => {
  const e = mapConfigError(429, {}, '30');
  assert.equal(e.code, 'rate_limited');
  assert.equal(e.meta?.retryAfterSec, 30);
  assert.equal(mapConfigError(429, {}, null).meta?.retryAfterSec, undefined);
});

test('mapConfigError: 5xx -> server_error', () => {
  assert.equal(mapConfigError(500, {}).code, 'server_error');
  assert.equal(mapConfigError(503, {}).code, 'server_error');
});

test('mapConfigError never echoes a key-shaped server message', () => {
  const e = mapConfigError(401, { message: 'rejected pk_live_' + 'a'.repeat(64) });
  assert.ok(!e.message.includes('a'.repeat(64)));
});

test('parseConfigSuccess accepts a valid body', () => {
  const r = parseConfigSuccess({ success: true, environment: 'live', checkoutBaseUrl: 'https://pay.gbitx.com', merchant: { name: 'Acme', website: 'https://acme.test' } });
  assert.equal(r.environment, 'live');
  assert.equal(r.checkoutOrigin, 'https://pay.gbitx.com');
  assert.equal(r.merchant.name, 'Acme');
  assert.equal(r.merchant.website, 'https://acme.test');
});

test('parseConfigSuccess defaults a missing merchant name and null website', () => {
  const r = parseConfigSuccess({ success: true, environment: 'test', checkoutBaseUrl: 'https://pay.gbitx.com', merchant: {} });
  assert.equal(r.merchant.name, 'Merchant');
  assert.equal(r.merchant.website, null);
});

test('parseConfigSuccess treats junk 200 bodies as server_error', () => {
  const bads: unknown[] = [
    null,
    {},
    { success: false },
    { success: true, environment: 'prod', checkoutBaseUrl: 'https://pay.gbitx.com', merchant: {} },
    { success: true, environment: 'live', checkoutBaseUrl: 'http://pay.gbitx.com', merchant: {} },
    { success: true, environment: 'live', checkoutBaseUrl: 'not-a-url', merchant: {} },
    { success: true, environment: 'live', checkoutBaseUrl: 'https://pay.gbitx.com', merchant: null },
    { success: true, environment: 'live', checkoutBaseUrl: 'https://pay.gbitx.com', merchant: [] },
  ];
  for (const b of bads) {
    assert.equal(grab(() => parseConfigSuccess(b)).code, 'server_error', JSON.stringify(b));
  }
});
