import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mayLoadInWebView, isTrustedMessageSource, isTrustedMessageOrigin } from '../src/webviewPolicy';

const ORIGIN = 'https://pay.gbitx.com';

test('isTrustedMessageOrigin accepts the pinned origin with OR without a path (iOS full URL vs Android origin-only)', () => {
  // Android sender shape: bare origin, no path — MUST be trusted.
  assert.equal(isTrustedMessageOrigin(ORIGIN, 'https://pay.gbitx.com'), true);
  // iOS sender shape: full frame URL — also trusted.
  assert.equal(isTrustedMessageOrigin(ORIGIN, 'https://pay.gbitx.com/p/abc?embed=native#t=x'), true);
  // look-alikes / wrong scheme still rejected.
  for (const bad of ['https://pay.gbitx.com.evil.com', 'https://pay.gbitx.company', 'https://pay.gbitx.com@evil.com/', 'http://pay.gbitx.com', 'https://sub.pay.gbitx.com', '', undefined, null]) {
    assert.equal(isTrustedMessageOrigin(ORIGIN, bad as unknown as string), false, `should reject: ${String(bad)}`);
  }
});

test('message trust: the four (senderUrl, committedUrl) shapes gate correctly', () => {
  // Helper mirroring CheckoutModal.handleMessage's gate.
  const trusted = (sender: string, committed: string) => {
    const committedOk = isTrustedMessageSource(ORIGIN, committed);
    if (sender !== '') return isTrustedMessageOrigin(ORIGIN, sender) && committedOk;
    return committedOk;
  };
  // iOS: full sender URL + committed /p/  -> trusted
  assert.equal(trusted('https://pay.gbitx.com/p/abc', 'https://pay.gbitx.com/p/abc'), true);
  // modern Android: origin-only sender + committed /p/  -> trusted (the regression this fixes)
  assert.equal(trusted('https://pay.gbitx.com', 'https://pay.gbitx.com/p/abc'), true);
  // no sender url: fall back to committed /p/  -> trusted
  assert.equal(trusted('', 'https://pay.gbitx.com/p/abc'), true);
  // hostile sender origin (even with a good committed url) -> rejected
  assert.equal(trusted('https://pay.gbitx.com.evil.com', 'https://pay.gbitx.com/p/abc'), false);
  // committed frame not on /p/ (e.g. navigated away) -> rejected
  assert.equal(trusted('https://pay.gbitx.com', 'https://pay.gbitx.com/login'), false);
});

test('mayLoadInWebView allows only the exact pinned origin over https', () => {
  assert.equal(mayLoadInWebView(ORIGIN, 'https://pay.gbitx.com/p/abc?embed=native#t=x'), true);
  assert.equal(mayLoadInWebView(ORIGIN, 'https://pay.gbitx.com/assets/app.js'), true);
});

test('mayLoadInWebView rejects look-alike / suffix / prefix hosts (the originWhitelist prefix hole)', () => {
  for (const u of [
    'https://pay.gbitx.com.evil.com/p/abc',
    'https://pay.gbitx.company/p/abc',
    'https://evil.com/pay.gbitx.com',
    'https://pay.gbitx.com@evil.com/',
    'http://pay.gbitx.com/p/abc',
    'https://sub.pay.gbitx.com/p/abc',
    'bitcoin:xyz',
    'javascript:alert(1)',
    'data:text/html,x',
    'about:blank',
    'file:///etc/passwd',
    'not a url',
    '',
    undefined,
    null,
  ]) {
    assert.equal(mayLoadInWebView(ORIGIN, u as unknown as string), false, `should block: ${String(u)}`);
  }
});

test('isTrustedMessageSource requires exact origin AND a /p/ path', () => {
  assert.equal(isTrustedMessageSource(ORIGIN, 'https://pay.gbitx.com/p/abc'), true);
  assert.equal(isTrustedMessageSource(ORIGIN, 'https://pay.gbitx.com/p/abc?x#t=y'), true);
  // right origin, wrong path
  assert.equal(isTrustedMessageSource(ORIGIN, 'https://pay.gbitx.com/'), false);
  assert.equal(isTrustedMessageSource(ORIGIN, 'https://pay.gbitx.com/login'), false);
  // look-alikes must fail even on a /p/ path
  assert.equal(isTrustedMessageSource(ORIGIN, 'https://pay.gbitx.com.evil.com/p/abc'), false);
  assert.equal(isTrustedMessageSource(ORIGIN, 'https://pay.gbitx.company/p/abc'), false);
  assert.equal(isTrustedMessageSource(ORIGIN, 'http://pay.gbitx.com/p/abc'), false);
  assert.equal(isTrustedMessageSource(ORIGIN, ''), false);
  assert.equal(isTrustedMessageSource(ORIGIN, undefined as unknown as string), false);
});
