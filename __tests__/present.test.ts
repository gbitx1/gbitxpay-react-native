import { test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { configure, __resetConfigForTest } from '../src/config';
import { present, registerHost, __resetControllerForTest, type CheckoutSession } from '../src/controller';
import { grabAsync, fakeResponse } from './_helpers';

const PK = 'pk_test_' + 'a'.repeat(64);
const okBody = { success: true, environment: 'test', checkoutBaseUrl: 'https://pay.gbitx.com', merchant: { name: 'Acme', website: null } };

function stubFetch(fn: () => Promise<Response>) {
  (globalThis as unknown as { fetch: unknown }).fetch = fn;
}

async function configureOk() {
  stubFetch(async () => fakeResponse(200, okBody));
  await configure({ publishableKey: PK });
}

beforeEach(() => {
  __resetConfigForTest();
  __resetControllerForTest();
});

test('present() before configure() -> not_configured', async () => {
  const e = await grabAsync(() => present({ paymentId: 'pay12345', clientToken: 'a'.repeat(32) }));
  assert.equal(e.code, 'not_configured');
});

test('present() after configure() but no provider mounted -> not_mounted', async () => {
  await configureOk();
  const e = await grabAsync(() => present({ paymentId: 'pay12345', clientToken: 'a'.repeat(32) }));
  assert.equal(e.code, 'not_mounted');
});

test('present() with malformed args -> invalid_arguments', async () => {
  await configureOk();
  registerHost(() => {});
  const e = await grabAsync(() => present({ paymentId: 'bad/id', clientToken: 'a'.repeat(32) }));
  assert.equal(e.code, 'invalid_arguments');
});

test('present() opens one session, blocks a second, and settle() resolves', async () => {
  await configureOk();
  let active: CheckoutSession | null = null;
  registerHost((s) => { active = s; });

  const p = present({ paymentId: 'pay12345', clientToken: 'a'.repeat(32) });
  assert.ok(active, 'host received a session synchronously');
  const session = active as unknown as CheckoutSession;
  assert.ok(session.url.startsWith('https://pay.gbitx.com/p/pay12345?embed=native#t='));

  const e = await grabAsync(() => present({ paymentId: 'pay67890', clientToken: 'b'.repeat(32) }));
  assert.equal(e.code, 'invalid_arguments'); // "a checkout is already open"

  session.settle({ status: 'confirmed', payment: null });
  const result = await p;
  assert.equal(result.status, 'confirmed');

  // host was told to unmount (null) after settle
  assert.equal(active, null);
});

test('configure(): environment_mismatch when key prefix and server disagree', async () => {
  stubFetch(async () => fakeResponse(200, { ...okBody, environment: 'live' }));
  const e = await grabAsync(() => configure({ publishableKey: PK })); // PK is pk_test_
  assert.equal(e.code, 'environment_mismatch');
});

test('configure(): 401 -> invalid_key, network throw -> network_error, 429 -> rate_limited', async () => {
  stubFetch(async () => fakeResponse(401, { success: false, message: 'Invalid or revoked publishable key' }));
  assert.equal((await grabAsync(() => configure({ publishableKey: PK }))).code, 'invalid_key');

  stubFetch(async () => { throw new Error('offline'); });
  assert.equal((await grabAsync(() => configure({ publishableKey: PK }))).code, 'network_error');

  stubFetch(async () => fakeResponse(429, {}, { 'retry-after': '15' }));
  const rl = await grabAsync(() => configure({ publishableKey: PK }));
  assert.equal(rl.code, 'rate_limited');
  assert.equal(rl.meta?.retryAfterSec, 15);
});

test('configure(): a secret key is rejected before any network call', async () => {
  let called = false;
  stubFetch(async () => { called = true; return fakeResponse(200, okBody); });
  const e = await grabAsync(() => configure({ publishableKey: 'gk_live_' + 'a'.repeat(64) }));
  assert.equal(e.code, 'secret_key_used');
  assert.equal(called, false);
});
