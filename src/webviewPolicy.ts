// Pure, unit-testable WebView security policy — the exact origin decisions the
// SDK's trust rests on. Kept free of any react-native import so it can be
// tested in Node and so the decisions are auditable in isolation.
//
// EXACT origin equality everywhere (never startsWith / includes). The library's
// own `originWhitelist` prop is a *prefix* match (unanchored regex), so
// `https://www.gbitxpay.com` there would also match `https://www.gbitxpay.com.evil.com`
// and `https://www.gbitxpay.company`. We therefore set originWhitelist to ['*'] in
// the component and make THIS module the single authoritative gate.

function parse(url: unknown): URL | null {
  if (typeof url !== 'string' || url === '') return null;
  try {
    return new URL(url);
  } catch {
    return null;
  }
}

// May a navigation load inside the WebView? In native embed mode the checkout
// is fully self-contained — it performs NO off-origin navigation and uses NO
// wallet deep-links (verified against PaymentPage.jsx: redirects are suppressed
// and "return to merchant" links are swapped for close buttons). So the only
// thing allowed to load is the pinned checkout origin over https; everything
// else is blocked and opened nowhere (no Linking), removing the "a compromised
// page force-opens an external URL / deep-link" vector entirely.
export function mayLoadInWebView(checkoutOrigin: string, url: unknown): boolean {
  const u = parse(url);
  return !!u && u.protocol === 'https:' && u.origin === checkoutOrigin;
}

// Is a URL the pinned checkout origin over https? EXACT origin, NO path clause.
// Used to validate the per-message authenticated sender URL, whose shape differs
// by platform: on iOS react-native-webview reports the full frame URL, but on
// Android it reports the sender ORIGIN only (no path). Requiring a /p/ path here
// would reject every legitimate Android message. The /p/ path is instead asserted
// on the committed top-frame URL (isTrustedMessageSource) — exactly how the iOS
// native SDK splits frameInfo.securityOrigin (origin) from the committed URL (path).
//
// Caveat vs the native SDKs: on react-native-webview's Android path this URL is the
// TOP-frame value, not a per-frame authenticated sender origin, so it cannot by
// itself isolate a sub-frame. That residual is covered by the hosted page's CSP
// (frame-src 'none' blocks injected iframes) plus the page shipping no iframes.
export function isTrustedMessageOrigin(checkoutOrigin: string, url: unknown): boolean {
  const u = parse(url);
  return !!u && u.protocol === 'https:' && u.origin === checkoutOrigin;
}

// Is a URL the pinned origin over https AND on a payment path (/p/...)? Applied to
// the committed top-frame URL (from onNavigationStateChange), which always carries
// the full path. This is the native mirror of the page's own embed-origin boundary.
export function isTrustedMessageSource(checkoutOrigin: string, url: unknown): boolean {
  const u = parse(url);
  return !!u && u.protocol === 'https:' && u.origin === checkoutOrigin && u.pathname.startsWith('/p/');
}
