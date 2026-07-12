// @gbitx/pay-react-native — public entrypoint.
//
// Accept crypto payments in your React Native app. Your SERVER creates the
// payment with your SECRET key and hands the app { paymentId, clientToken };
// the app opens the hardened hosted checkout in a WebView. Fulfilment is
// driven by the signed server webhook — SDK callbacks are UX only.

export { GbitXPay } from './GbitXPay';
export type { GbitXPayApi } from './GbitXPay';
export { GbitXPayProvider } from './GbitXPayProvider';
export { useGbitXPay } from './useGbitXPay';
export type { UseGbitXPay } from './useGbitXPay';

export { GbitXPayError, isGbitXPayError } from './errors';
export type { GbitXPayErrorCode, GbitXPayErrorMeta } from './errors';

export { setDebug } from './redact';

export { SDK_VERSION } from './version';

export type {
  Environment,
  PaymentStatus,
  SanitizedPayment,
  PaymentResult,
  CancelReason,
  ExpiredReason,
  ConfigureOptions,
  PresentOptions,
  MerchantInfo,
  CheckoutEvent,
  CheckoutEventType,
} from './types';
