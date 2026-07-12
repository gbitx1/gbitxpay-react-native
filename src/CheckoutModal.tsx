import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator,
  BackHandler,
  Modal,
  Platform,
  StatusBar,
  StyleSheet,
  Text,
  TouchableOpacity,
  useColorScheme,
  View,
} from 'react-native';
import { WebView } from 'react-native-webview';
import type {
  ShouldStartLoadRequest,
  WebViewMessageEvent,
  WebViewNavigation,
} from 'react-native-webview/lib/WebViewTypes';

import type { CheckoutSession } from './controller';
import type { PaymentResult } from './types';
import { parseBridgeMessage, terminalResult } from './messageHandler';
import { mayLoadInWebView, isTrustedMessageSource, isTrustedMessageOrigin } from './webviewPolicy';
import { debugLog, redactUrl } from './redact';

// Absolute ceiling on a single checkout session. The server payment expires in
// 60 minutes; this fixed backstop (payment window + grace) guarantees present()
// resolves even if the WebView is backgrounded/offline and the page can never
// emit its own 'expired'. Fixed (not derived from any device-controlled
// payload) so it can neither be shortened by a hostile page nor overflow the
// 32-bit setTimeout delay.
const SESSION_MAX_MS = 65 * 60 * 1000;

interface ThemeTokens {
  bg: string;
  text: string;
  sub: string;
  border: string;
  spinner: string;
}

function useTheme(): ThemeTokens {
  const scheme = useColorScheme();
  return scheme === 'dark'
    ? { bg: '#0a0f0c', text: '#f2f5f3', sub: '#9aa5a0', border: '#1c2620', spinner: '#3ecf6b' }
    : { bg: '#ffffff', text: '#0a0f0c', sub: '#5b6660', border: '#e6ebe8', spinner: '#07811f' };
}

export function CheckoutModal({ session }: { session: CheckoutSession }): React.ReactElement {
  const theme = useTheme();
  const checkoutOrigin = session.config.checkoutOrigin;

  const [pageReady, setPageReady] = useState(false);
  const [loadError, setLoadError] = useState(false);

  // Refs so async handlers always see current values without re-subscribing.
  const settledRef = useRef(false);
  const loadedFiredRef = useRef(false);
  const committedUrlRef = useRef<string>(session.url);
  const backstopRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const webViewRef = useRef<WebView>(null);

  // The SINGLE exit. Idempotent. Clears timers, forgets the token-bearing URL,
  // and hands the result to the controller (which also dedupes and unmounts us).
  const settle = useCallback(
    (result: PaymentResult) => {
      if (settledRef.current) return;
      settledRef.current = true;
      if (backstopRef.current) {
        clearTimeout(backstopRef.current);
        backstopRef.current = null;
      }
      committedUrlRef.current = ''; // drop the URL (carries #t=token) from memory
      debugLog('settle', result.status, 'reason' in result ? result.reason ?? '' : '');
      session.settle(result);
    },
    [session],
  );

  // ── WebView: navigation lock (sole authoritative gate) ─────────────────────
  // originWhitelist is set to ['*'] so the library never auto-decides (its
  // whitelist is a loose prefix match); every navigation is routed here and only
  // the exact pinned origin over https may load. Off-origin is blocked and NOT
  // opened anywhere.
  const handleShouldStart = useCallback(
    (req: ShouldStartLoadRequest): boolean => mayLoadInWebView(checkoutOrigin, req.url),
    [checkoutOrigin],
  );

  // Never spawn a child WebView or open anything. window.open / target=_blank
  // are already suppressed by the props below; this is defense in depth.
  const handleOpenWindow = useCallback(() => {
    /* no-op: never open a second browsing context */
  }, []);

  // ── WebView: message trust gate + dispatch ─────────────────────────────────
  const handleMessage = useCallback(
    (event: WebViewMessageEvent) => {
      // Trust gate (two independent checks, mirroring the iOS native SDK):
      //   1. The per-message sender URL must be the pinned origin over https.
      //      react-native-webview reports this differently per platform — a FULL
      //      frame URL on iOS, but the sender ORIGIN ONLY (no path) on Android —
      //      so we check ORIGIN here, never a path (a /p/ requirement would drop
      //      every legitimate Android message and hang the checkout).
      //   2. The committed top-frame URL (always full, from onNavigationStateChange)
      //      must be the pinned origin on a /p/ path.
      // Both must hold. If the platform provides no sender URL, fall back to the
      // committed /p/ gate alone. Fail closed on any mismatch.
      const senderUrl = event?.nativeEvent?.url;
      const committedOnCheckout = isTrustedMessageSource(checkoutOrigin, committedUrlRef.current || session.url);
      if (typeof senderUrl === 'string' && senderUrl !== '') {
        if (!isTrustedMessageOrigin(checkoutOrigin, senderUrl) || !committedOnCheckout) return;
      } else if (!committedOnCheckout) {
        return;
      }

      const parsed = parseBridgeMessage(event?.nativeEvent?.data);
      if (!parsed) return;

      // Bind to THIS payment: a message whose payload is for a different payment
      // id is dropped (the origin gate + single active session already scope us,
      // this closes id-confusion for good).
      if (parsed.payment && parsed.payment.id !== session.paymentId) return;

      session.onEvent?.({ type: parsed.type, payment: parsed.payment ?? undefined });

      if (parsed.type === 'loaded') {
        setPageReady(true);
        if (!loadedFiredRef.current) {
          loadedFiredRef.current = true;
          session.onLoaded?.();
        }
        return; // non-terminal
      }

      const result = terminalResult(parsed.type, parsed.payment);
      if (result) settle(result);
    },
    [checkoutOrigin, session, settle],
  );

  // ── WebView: load/crash error handling (main-frame only) ───────────────────
  const isMainFrameUrl = useCallback(
    (url: string | undefined): boolean => {
      if (!url) return true; // top-level failure with no url
      try {
        const u = new URL(url);
        return u.origin === checkoutOrigin && u.pathname.startsWith('/p/');
      } catch {
        return false;
      }
    },
    [checkoutOrigin],
  );

  const handleLoadError = useCallback(
    (e: { nativeEvent?: { url?: string } }) => {
      if (isMainFrameUrl(e?.nativeEvent?.url)) setLoadError(true);
    },
    [isMainFrameUrl],
  );

  const handleCrash = useCallback((): void => {
    // Renderer died. Do NOT blind-reload into an unknown state — surface an
    // error the user can retry. A success can only come from a trusted message.
    setLoadError(true);
  }, []);

  const retry = useCallback(() => {
    setLoadError(false);
    setPageReady(false);
    webViewRef.current?.reload();
  }, []);

  // ── Android hardware back + fixed backstop + unmount cleanup ────────────────
  useEffect(() => {
    // Absolute session backstop (fixed duration — see SESSION_MAX_MS).
    backstopRef.current = setTimeout(() => settle({ status: 'expired', reason: 'client_backstop' }), SESSION_MAX_MS);

    const onBack = (): boolean => {
      settle({ status: 'cancelled', reason: 'back_button' });
      return true; // we own the back gesture while checkout is open
    };
    const sub = BackHandler.addEventListener('hardwareBackPress', onBack);

    return () => {
      sub.remove();
      if (backstopRef.current) {
        clearTimeout(backstopRef.current);
        backstopRef.current = null;
      }
      webViewRef.current?.stopLoading?.();
      // If we unmount without a terminal event, settle once so the merchant's
      // promise never hangs and no orphaned WebView keeps polling.
      if (!settledRef.current) {
        settledRef.current = true;
        session.settle({ status: 'cancelled', reason: 'dismissed' });
      }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // One redacted breadcrumb (origin + path only — never the #t= token).
  useEffect(() => {
    debugLog('present', redactUrl(session.url));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const topInset = Platform.OS === 'android' ? StatusBar.currentHeight ?? 0 : 0;

  return (
    <Modal
      visible
      animationType="slide"
      presentationStyle="pageSheet"
      statusBarTranslucent
      onRequestClose={() => settle({ status: 'cancelled', reason: 'back_button' })}
      onDismiss={() => {
        if (!settledRef.current) settle({ status: 'cancelled', reason: 'dismissed' });
      }}
    >
      <View style={[styles.container, { backgroundColor: theme.bg, paddingTop: topInset }]}>
        <View style={[styles.header, { borderBottomColor: theme.border }]}>
          <Text style={[styles.title, { color: theme.text }]} numberOfLines={1}>
            {session.config.merchant.name}
          </Text>
          <TouchableOpacity
            onPress={() => settle({ status: 'cancelled', reason: 'user_closed' })}
            accessibilityRole="button"
            accessibilityLabel="Close checkout"
            hitSlop={{ top: 12, bottom: 12, left: 12, right: 12 }}
            style={styles.closeBtn}
          >
            <Text style={[styles.closeIcon, { color: theme.text }]}>✕</Text>
          </TouchableOpacity>
        </View>

        <View style={styles.body}>
          {loadError ? (
            <View style={styles.center} accessibilityLabel="Checkout failed to load">
              <Text style={[styles.errorTitle, { color: theme.text }]}>Could not load checkout</Text>
              <Text style={[styles.errorSub, { color: theme.sub }]}>Check your connection and try again.</Text>
              <TouchableOpacity onPress={retry} accessibilityRole="button" style={[styles.retryBtn, { borderColor: theme.border }]}>
                <Text style={[styles.retryText, { color: theme.text }]}>Retry</Text>
              </TouchableOpacity>
              <TouchableOpacity
                onPress={() => settle({ status: 'cancelled', reason: 'load_failed' })}
                accessibilityRole="button"
                style={styles.closeLink}
              >
                <Text style={[styles.closeLinkText, { color: theme.sub }]}>Close</Text>
              </TouchableOpacity>
            </View>
          ) : (
            <>
              <WebView
                ref={webViewRef}
                source={{ uri: session.url }}
                // ── origin + navigation lock (this handler is the sole gate) ──
                originWhitelist={['*']}
                onShouldStartLoadWithRequest={handleShouldStart}
                onNavigationStateChange={(s: WebViewNavigation) => {
                  committedUrlRef.current = s.url;
                  // Defense in depth: originWhitelist is ['*'] so handleShouldStart
                  // is the sole nav gate. If the committed top frame ever lands on
                  // an http(s) URL that is NOT the pinned origin (a library
                  // regression bypassing the gate), stop trusting the session.
                  if (typeof s.url === 'string' && /^https?:/i.test(s.url) && !mayLoadInWebView(checkoutOrigin, s.url)) {
                    if (!settledRef.current) {
                      webViewRef.current?.stopLoading?.();
                      setLoadError(true);
                    }
                  }
                }}
                onMessage={handleMessage}
                onOpenWindow={handleOpenWindow}
                // ── window / file / storage lockdown ──
                setSupportMultipleWindows={false}
                javaScriptCanOpenWindowsAutomatically={false}
                allowFileAccess={false}
                allowFileAccessFromFileURLs={false}
                allowUniversalAccessFromFileURLs={false}
                thirdPartyCookiesEnabled={false}
                sharedCookiesEnabled={false}
                incognito={false}
                mixedContentMode="never"
                // ── media (no autoplay, no camera/mic grants) ──
                allowsInlineMediaPlayback
                mediaPlaybackRequiresUserAction
                // ── load + crash handling ──
                onError={handleLoadError}
                onHttpError={handleLoadError}
                onContentProcessDidTerminate={handleCrash}
                onRenderProcessGone={handleCrash}
                onLoadEnd={() => setPageReady(true)}
                style={{ flex: 1, backgroundColor: theme.bg }}
              />
              {!pageReady ? (
                <View style={[styles.loadingOverlay, { backgroundColor: theme.bg }]} accessibilityLabel="Loading checkout">
                  <ActivityIndicator size="large" color={theme.spinner} />
                </View>
              ) : null}
            </>
          )}
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    height: 52,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  title: { fontSize: 15, fontWeight: '500', flex: 1, marginRight: 12 },
  closeBtn: { width: 32, height: 32, alignItems: 'center', justifyContent: 'center' },
  closeIcon: { fontSize: 18, fontWeight: '400' },
  body: { flex: 1 },
  loadingOverlay: { ...StyleSheet.absoluteFillObject, alignItems: 'center', justifyContent: 'center' },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 32 },
  errorTitle: { fontSize: 16, fontWeight: '500', marginBottom: 8 },
  errorSub: { fontSize: 13, textAlign: 'center', marginBottom: 20 },
  retryBtn: { paddingHorizontal: 24, paddingVertical: 10, borderRadius: 10, borderWidth: 1 },
  retryText: { fontSize: 14, fontWeight: '500' },
  closeLink: { marginTop: 14, padding: 8 },
  closeLinkText: { fontSize: 13 },
});
