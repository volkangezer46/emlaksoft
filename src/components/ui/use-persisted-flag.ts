"use client";

import { useCallback, useSyncExternalStore } from "react";
import { parseStoredFlag, serializeFlag } from "@/lib/morph-tabs";

/**
 * Kullanıcı tercihi (ör. rayı daralt) — localStorage, her okuma/yazma try/catch.
 * Depolama kapalı/boşsa varsayılan döner; sunucuda her zaman varsayılan (hidratasyon güvenli:
 * useSyncExternalStore ilk istemci çiziminden sonra gerçek değere geçer).
 */
const listeners = new Set<() => void>();

/** Depolama kapalıyken tercih en azından sayfa ömrünce çalışsın. */
const memory = new Map<string, string>();

function read(key: string): string | null {
  const mem = memory.get(key);
  if (mem != null) return mem;
  try {
    return window.localStorage.getItem(key);
  } catch {
    return null;
  }
}

function subscribe(cb: () => void) {
  listeners.add(cb);
  window.addEventListener("storage", cb);
  return () => {
    listeners.delete(cb);
    window.removeEventListener("storage", cb);
  };
}

export function usePersistedFlag(key: string, fallback: boolean): [boolean, (next: boolean) => void] {
  const value = useSyncExternalStore(
    subscribe,
    () => parseStoredFlag(read(key), fallback),
    () => fallback,
  );
  const set = useCallback(
    (next: boolean) => {
      memory.set(key, serializeFlag(next));
      try {
        window.localStorage.setItem(key, serializeFlag(next));
      } catch {
        /* depolama kapalı — bellek kopyası yeter */
      }
      listeners.forEach((l) => l());
    },
    [key],
  );
  return [value, set];
}
