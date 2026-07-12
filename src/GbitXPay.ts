import { configure } from './config';
import { present } from './controller';

// The imperative singleton. `configure` once at startup; `present` per payment.
//
//   import { GbitXPay } from '@gbitx/pay-react-native';
//   await GbitXPay.configure({ publishableKey: 'pk_live_…' });
//   const result = await GbitXPay.present({ paymentId, clientToken });
//   if (result.status === 'confirmed') showThankYou();
//   // …but only fulfil the order from your signed server webhook.
export const GbitXPay = {
  configure,
  present,
} as const;

export type GbitXPayApi = typeof GbitXPay;
