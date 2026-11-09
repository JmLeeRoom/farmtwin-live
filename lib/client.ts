"use client";

import { useSyncExternalStore } from "react";

const subscribeStorage = (cb: () => void) => {
  window.addEventListener("storage", cb);
  return () => window.removeEventListener("storage", cb);
};

export const participantKey = (sessionId: string) => `participantId:${sessionId}`;

export function readLocal(key: string): string | null {
  try {
    return window.localStorage.getItem(key);
  } catch {
    return null;
  }
}

export function writeLocal(key: string, value: string | null) {
  try {
    if (value === null) window.localStorage.removeItem(key);
    else window.localStorage.setItem(key, value);
  } catch {
    /* 사생활 보호 모드 등 — 참가 정보는 이 탭에서만 유지 */
  }
}

/** 서버 렌더에서는 undefined(아직 모름), 브라우저에서는 저장값 또는 null. */
export function useLocalValue(key: string): string | null | undefined {
  return useSyncExternalStore(
    subscribeStorage,
    () => readLocal(key),
    () => undefined,
  );
}

const DESKTOP_QUERY = "(min-width: 768px)";

export function useIsDesktop(): boolean {
  return useSyncExternalStore(
    (cb) => {
      const m = window.matchMedia(DESKTOP_QUERY);
      m.addEventListener("change", cb);
      return () => m.removeEventListener("change", cb);
    },
    () => window.matchMedia(DESKTOP_QUERY).matches,
    () => true,
  );
}
