import { GbitXPayError } from './errors';
import { assertPaymentArgs, buildCheckoutUrl } from './validation';
import { getResolvedConfig, isConfigured, type ResolvedConfig } from './config';
import type { PaymentResult, PresentOptions } from './types';

// One active checkout session, handed to the mounted host (GbitXPayProvider)
// to render. `settle` is the SINGLE exit: the controller dedupes it and
// resolves the present() promise, then tells the host to unmount.
export interface CheckoutSession {
  paymentId: string;
  clientToken: string;
  url: string;
  config: ResolvedConfig;
  onLoaded?: () => void;
  onEvent?: PresentOptions['onEvent'];
  settle: (result: PaymentResult) => void;
}

type HostListener = (session: CheckoutSession | null) => void;

let _host: HostListener | null = null;
let _active: CheckoutSession | null = null;

// The provider registers exactly one host. If a host is already registered
// (two providers mounted — a merchant mistake), the last one wins and we warn
// via the returned unregister being scoped to the specific listener.
export function registerHost(listener: HostListener): () => void {
  _host = listener;
  if (_active) listener(_active); // replay a pending session to a late host
  return () => {
    if (_host === listener) _host = null;
  };
}

export function hasHost(): boolean {
  return _host !== null;
}

// Test-only.
export function __resetControllerForTest(): void {
  _host = null;
  _active = null;
}

// Open the hosted checkout for one payment. Resolves with the terminal
// PaymentResult (confirmed / cancelled / expired / failed). Rejects ONLY for
// SDK/credential faults (GbitXPayError). A terminal outcome is never a reject.
export function present(options: PresentOptions): Promise<PaymentResult> {
  return new Promise<PaymentResult>((resolve, reject) => {
    if (!isConfigured()) {
      reject(new GbitXPayError('not_configured', 'Call and await GbitXPay.configure({ publishableKey }) before present().'));
      return;
    }
    if (!_host) {
      reject(new GbitXPayError('not_mounted', 'Mount <GbitXPayProvider> once near your app root before calling present().'));
      return;
    }
    if (_active) {
      reject(new GbitXPayError('invalid_arguments', 'A checkout is already open.'));
      return;
    }

    let args: { paymentId: string; clientToken: string };
    try {
      args = assertPaymentArgs(options?.paymentId, options?.clientToken);
    } catch (e) {
      reject(e);
      return;
    }

    const config = getResolvedConfig();
    if (!config) {
      // Guarded by isConfigured() above; defensive.
      reject(new GbitXPayError('not_configured', 'Configuration was lost. Call configure() again.'));
      return;
    }

    const url = buildCheckoutUrl(config.checkoutOrigin, args.paymentId, args.clientToken);

    let done = false;
    const session: CheckoutSession = {
      paymentId: args.paymentId,
      clientToken: args.clientToken,
      url,
      config,
      onLoaded: options.onLoaded,
      onEvent: options.onEvent,
      settle: (result: PaymentResult) => {
        if (done) return; // controller-level latch (the modal has its own too)
        done = true;
        _active = null;
        _host?.(null); // ask the host to unmount the modal/WebView
        resolve(result);
      },
    };

    _active = session;
    _host(session);
  });
}
