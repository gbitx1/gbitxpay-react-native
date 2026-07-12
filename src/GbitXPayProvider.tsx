import React, { useEffect, useState } from 'react';
import { registerHost, type CheckoutSession } from './controller';
import { CheckoutModal } from './CheckoutModal';

// Mount ONCE near your app root. It renders nothing until a checkout is
// presented, then hosts the full-screen checkout modal. Imperative
// GbitXPay.present() drives it via the module controller.
//
//   export default function App() {
//     return (
//       <GbitXPayProvider>
//         <YourApp />
//       </GbitXPayProvider>
//     );
//   }
export function GbitXPayProvider({ children }: { children?: React.ReactNode }): React.ReactElement {
  const [session, setSession] = useState<CheckoutSession | null>(null);

  useEffect(() => registerHost(setSession), []);

  return (
    <>
      {children}
      {/* key by paymentId so each checkout gets a fresh modal (fresh latch,
          fresh state) and nothing leaks across payments. */}
      {session ? <CheckoutModal key={session.paymentId} session={session} /> : null}
    </>
  );
}
