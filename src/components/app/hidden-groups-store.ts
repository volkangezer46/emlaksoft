"use client";

import { useCallback, useSyncExternalStore } from "react";

/**
 * "Bu grup mükerrer değil" — DB'siz hafif gizleme (çift kayıt sayfaları): grup imzaları cihazda (localStorage) tutulur.
 * Hydration-güvenli: sunucu anlık görüntüsü boş liste, istemci localStorage (effect içinde setState yok).
 * localStorage kapalıysa (gizli pencere vb.) sessizce boş liste: gizleme yalnız kolaylıktır.
 */
const EVENT = "emlaksoft:hidden-groups-changed";
const EMPTY: string[] = [];
const cache = new Map<string, { raw: string | null; list: string[] }>();

function readRaw(key: string): string | null {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}

function parse(raw: string | null): string[] {
  if (!raw) return EMPTY;
  try {
    const arr: unknown = JSON.parse(raw);
    return Array.isArray(arr) ? arr.filter((s): s is string => typeof s === "string") : EMPTY;
  } catch {
    return EMPTY;
  }
}

function snapshot(key: string): string[] {
  const raw = readRaw(key);
  const hit = cache.get(key);
  if (hit && hit.raw === raw) return hit.list;
  const list = parse(raw);
  cache.set(key, { raw, list });
  return list;
}

function write(key: string, list: string[]) {
  try {
    localStorage.setItem(key, JSON.stringify(list));
  } catch {
    // localStorage kapalı: gizleme yalnız kolaylık, sessizce geç
  }
  window.dispatchEvent(new Event(EVENT));
}

function subscribe(cb: () => void) {
  window.addEventListener(EVENT, cb);
  window.addEventListener("storage", cb);
  return () => {
    window.removeEventListener(EVENT, cb);
    window.removeEventListener("storage", cb);
  };
}

export function useHiddenGroups(storageKey: string) {
  const hidden = useSyncExternalStore(
    subscribe,
    () => snapshot(storageKey),
    () => EMPTY,
  );
  const hide = useCallback((sig: string) => write(storageKey, [...new Set([...parse(readRaw(storageKey)), sig])]), [storageKey]);
  const unhide = useCallback((sig: string) => write(storageKey, parse(readRaw(storageKey)).filter((s) => s !== sig)), [storageKey]);
  return { hidden, hide, unhide };
}
