// Minimal example: configure once, present per payment.
//
// This screen fetches { paymentId, clientToken } from YOUR backend (which
// created the payment with the SECRET key) and opens the checkout. It fulfils
// NOTHING from the SDK result — your server does that from the signed webhook.

import React, { useEffect, useState } from 'react';
import { Button, SafeAreaView, StyleSheet, Text, View } from 'react-native';
import { GbitXPay, GbitXPayProvider, isGbitXPayError } from '@gbitx/pay-react-native';

// Point this at YOUR server (see ./server/create-payment.js).
const MY_BACKEND = 'https://your-server.example.com';
const PUBLISHABLE_KEY = 'pk_test_0000000000000000000000000000000000000000000000000000000000000000';

function CheckoutScreen() {
  const [status, setStatus] = useState<string>('idle');

  const pay = async () => {
    try {
      setStatus('creating payment…');
      // 1) Your server creates the payment with the secret key and returns
      //    only these two fields.
      const res = await fetch(`${MY_BACKEND}/checkout`, { method: 'POST' });
      const { paymentId, clientToken } = await res.json();

      // 2) Open the hosted checkout.
      setStatus('opening checkout…');
      const result = await GbitXPay.present({ paymentId, clientToken });

      // 3) UX only. Your server fulfils the order from the signed webhook.
      setStatus(`result: ${result.status}`);
    } catch (e) {
      if (isGbitXPayError(e)) setStatus(`error: ${e.code}`);
      else setStatus('error');
    }
  };

  return (
    <View style={styles.center}>
      <Text style={styles.h1}>GbitXPay example</Text>
      <Button title="Pay with crypto" onPress={pay} />
      <Text style={styles.status}>{status}</Text>
    </View>
  );
}

export default function App() {
  useEffect(() => {
    GbitXPay.configure({ publishableKey: PUBLISHABLE_KEY }).catch((e) =>
      console.warn('GbitXPay configure failed:', isGbitXPayError(e) ? e.code : e),
    );
  }, []);

  return (
    <GbitXPayProvider>
      <SafeAreaView style={styles.fill}>
        <CheckoutScreen />
      </SafeAreaView>
    </GbitXPayProvider>
  );
}

const styles = StyleSheet.create({
  fill: { flex: 1 },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 16 },
  h1: { fontSize: 20, fontWeight: '500' },
  status: { color: '#5b6660' },
});
