// Shared test helpers. Named without `.test.ts` so the runner's glob skips it.
import { GbitXPayError } from '../src/errors';

// Capture a synchronous throw as a GbitXPayError (assert.throws doesn't return
// the error, and we want to inspect .code).
export function grab(fn: () => unknown): GbitXPayError {
  try {
    fn();
  } catch (e) {
    return e as GbitXPayError;
  }
  throw new Error('expected a throw, got none');
}

export async function grabAsync(fn: () => Promise<unknown>): Promise<GbitXPayError> {
  try {
    await fn();
  } catch (e) {
    return e as GbitXPayError;
  }
  throw new Error('expected a rejection, got none');
}

// A minimal fetch Response stand-in for stubbing global fetch in config tests.
export function fakeResponse(status: number, body: unknown, headers: Record<string, string> = {}): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
    headers: { get: (k: string) => headers[k.toLowerCase()] ?? null },
  } as unknown as Response;
}
