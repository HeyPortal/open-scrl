import { useSyncExternalStore } from 'react';

/** Phones in portrait, and short touch screens (phones in landscape). */
export const MOBILE_QUERY = '(max-width: 767px), (pointer: coarse) and (max-height: 500px)';

function subscribe(onChange: () => void) {
  if (typeof window === 'undefined' || !window.matchMedia) return () => undefined;
  const query = window.matchMedia(MOBILE_QUERY);
  query.addEventListener('change', onChange);
  return () => query.removeEventListener('change', onChange);
}

export function isMobileLayout() {
  return typeof window !== 'undefined' && !!window.matchMedia && window.matchMedia(MOBILE_QUERY).matches;
}

/** True when the app should use the mobile home screen and editor. */
export function useMobileLayout() {
  return useSyncExternalStore(subscribe, isMobileLayout, () => false);
}
