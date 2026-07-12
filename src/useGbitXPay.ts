import { useMemo } from 'react';
import { configure } from './config';
import { present } from './controller';
import type { ConfigureOptions, PresentOptions, PaymentResult } from './types';

export interface UseGbitXPay {
  configure: (options: ConfigureOptions) => Promise<void>;
  present: (options: PresentOptions) => Promise<PaymentResult>;
}

// Hook flavor of the API for components that prefer it. Thin, stable wrapper
// over the same singleton — configure/present are module-level, so this holds
// no state of its own; the identity is memoized for dependency arrays.
export function useGbitXPay(): UseGbitXPay {
  return useMemo(() => ({ configure, present }), []);
}
