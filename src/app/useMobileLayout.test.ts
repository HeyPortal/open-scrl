import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, renderHook } from '@testing-library/react';
import { MOBILE_QUERY, isMobileLayout, useMobileLayout } from './useMobileLayout';

type ChangeListener = (event: MediaQueryListEvent) => void;

/** Stand-in for a live MediaQueryList: tests flip `matches` and fire `change` like a browser would. */
class FakeMediaQueryList {
  readonly media: string;
  matches: boolean;
  readonly listeners = new Set<ChangeListener>();

  constructor(media: string, matches: boolean) {
    this.media = media;
    this.matches = matches;
  }

  addEventListener(type: string, listener: ChangeListener) {
    if (type === 'change') this.listeners.add(listener);
  }

  removeEventListener(type: string, listener: ChangeListener) {
    if (type === 'change') this.listeners.delete(listener);
  }

  setMatches(matches: boolean) {
    this.matches = matches;
    for (const listener of [...this.listeners]) {
      listener({ matches, media: this.media } as MediaQueryListEvent);
    }
  }
}

const originalMatchMedia = window.matchMedia;

/**
 * Installs a fake `window.matchMedia`. Like a browser, every call for the same
 * query string shares one live list, so listeners added by one call see changes
 * fired through another.
 */
function stubMatchMedia(matches: boolean) {
  const lists = new Map<string, FakeMediaQueryList>();
  const matchMedia = vi.fn((query: string) => {
    let list = lists.get(query);
    if (!list) {
      list = new FakeMediaQueryList(query, matches);
      lists.set(query, list);
    }
    return list as unknown as MediaQueryList;
  });
  window.matchMedia = matchMedia;

  const mobileQuery = () => {
    const list = lists.get(MOBILE_QUERY);
    if (!list) throw new Error('MOBILE_QUERY was never queried');
    return list;
  };
  return { matchMedia, mobileQuery };
}

afterEach(() => {
  cleanup();
  window.matchMedia = originalMatchMedia;
});

describe('isMobileLayout', () => {
  it('returns true when the mobile query matches', () => {
    stubMatchMedia(true);
    expect(isMobileLayout()).toBe(true);
  });

  it('returns false when the mobile query does not match', () => {
    stubMatchMedia(false);
    expect(isMobileLayout()).toBe(false);
  });

  it('queries exactly MOBILE_QUERY', () => {
    const { matchMedia } = stubMatchMedia(false);
    isMobileLayout();
    expect(matchMedia.mock.calls).toEqual([[MOBILE_QUERY]]);
  });

  it('returns false when window.matchMedia is unavailable', () => {
    window.matchMedia = undefined as unknown as typeof window.matchMedia;
    expect(isMobileLayout()).toBe(false);
  });
});

describe('useMobileLayout', () => {
  it('returns the initial match state', () => {
    stubMatchMedia(true);
    const { result } = renderHook(() => useMobileLayout());
    expect(result.current).toBe(true);
  });

  it('re-renders with the new value when the media query fires change', () => {
    const { mobileQuery } = stubMatchMedia(false);
    const { result } = renderHook(() => useMobileLayout());
    expect(result.current).toBe(false);

    act(() => mobileQuery().setMatches(true));
    expect(result.current).toBe(true);

    act(() => mobileQuery().setMatches(false));
    expect(result.current).toBe(false);
  });

  it('removes its change listener on unmount', () => {
    const { mobileQuery } = stubMatchMedia(false);
    const { unmount } = renderHook(() => useMobileLayout());
    const list = mobileQuery();
    expect(list.listeners.size).toBe(1);

    unmount();
    expect(list.listeners.size).toBe(0);
  });
});
