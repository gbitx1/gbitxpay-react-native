import { test } from 'node:test';
import assert from 'node:assert/strict';
import { redactUrl, redactSecrets } from '../src/redact';

test('redactUrl keeps origin + path, drops query and token fragment', () => {
  assert.equal(redactUrl('https://pay.gbitx.com/p/abc?embed=native#t=SECRET'), 'https://pay.gbitx.com/p/abc');
  assert.equal(redactUrl('garbage'), '[unparseable-url]');
});

test('redactSecrets scrubs keys and #t= fragments', () => {
  const keyBody = 'a'.repeat(64);
  const token = 'TOKEN1234567890';
  const s = redactSecrets(`key=pk_live_${keyBody} secret=gk_test_${keyBody} url=https://pay.gbitx.com/p/x#t=${token}`);
  assert.ok(!s.includes(keyBody));
  assert.ok(!s.includes(token));
  assert.ok(s.includes('pk_live_redacted'));
  assert.ok(s.includes('gk_test_redacted'));
  assert.ok(s.includes('#t=redacted'));
});
