"use client";

import { useSyncExternalStore } from "react";

/* ------------------------------------------------------------------
   Vitrin favorileri — hesapsız ziyaretçi için localStorage destekli
   dış store (dashboard-widgets.tsx'teki useSyncExternalStore deseni).
   Anahtar tenant bazlıdır: `emlaksoft:fav:{slug}` — aynı tarayıcıda
   farklı ofis vitrinlerinin favorileri karışmaz. SSR/ilk hydrate'te
   boş liste döner, hemen ardından gerçek liste gelir (hydration-güvenli).
   ------------------------------------------------------------------ */

const EMPTY: string[] = [];
const PREFIX = "emlaksoft:fav:";

const cache = new Map<string, { raw: string | null; list: string[] }>();
const listeners = new Set<() => void>();

function keyOf(slug: string) {
  return `${PREFIX}${slug}`;
}

function readFavorites(slug: string): string[] {
  const key = keyOf(slug);
  let raw: string | null = null;
  try {
    raw = window.localStorage.getItem(key);
  } catch {
    return EMPTY;
  }
  const cached = cache.get(key);
  if (cached && cached.raw === raw) return cached.list;
  let list = EMPTY;
  try {
    const parsed: unknown = raw ? JSON.parse(raw) : [];
    list = Array.isArray(parsed) ? parsed.filter((x): x is string => typeof x === "string") : EMPTY;
  } catch {
    list = EMPTY;
  }
  cache.set(key, { raw, list });
  return list;
}

function emit() {
  listeners.forEach((l) => l());
}

function subscribe(cb: () => void) {
  listeners.add(cb);
  // Başka sekmede yapılan favori değişikliği de yansısın
  const onStorage = (e: StorageEvent) => {
    if (!e.key || e.key.startsWith(PREFIX)) cb();
  };
  window.addEventListener("storage", onStorage);
  return () => {
    listeners.delete(cb);
    window.removeEventListener("storage", onStorage);
  };
}

/** İlanı favoriye ekler / favoriden çıkarır. */
export function toggleFavorite(slug: string, propertyId: string) {
  const cur = readFavorites(slug);
  const next = cur.includes(propertyId) ? cur.filter((x) => x !== propertyId) : [...cur, propertyId];
  try {
    window.localStorage.setItem(keyOf(slug), JSON.stringify(next));
  } catch {
    /* private mode / kota — favori bu oturumda tutulamaz, sessiz geç */
  }
  emit();
}

/** Tenant'ın favori ilan id listesi (SSR'da boş, hydrate sonrası gerçek). */
export function useFavorites(slug: string): string[] {
  return useSyncExternalStore(subscribe, () => readFavorites(slug), () => EMPTY);
}

/* ------------------------------------------------------------------
   "Favorilerim" görünümü — SSR listesi aynen gelir (SEO etkilenmez),
   client yalnız favori kartları gösterir. Durum modül seviyesinde
   tutulur; URL'e ?fav=1 yazılır/okunur ki görünüm paylaşılabilsin.
   ------------------------------------------------------------------ */

let favMode = false;
let favModeReady = false;

function readFavMode(): boolean {
  if (!favModeReady) {
    favModeReady = true;
    try {
      favMode = new URLSearchParams(window.location.search).get("fav") === "1";
    } catch {
      favMode = false;
    }
  }
  return favMode;
}

export function setFavMode(v: boolean) {
  favMode = v;
  favModeReady = true;
  try {
    const url = new URL(window.location.href);
    if (v) url.searchParams.set("fav", "1");
    else url.searchParams.delete("fav");
    window.history.replaceState(null, "", url.toString());
  } catch {
    /* URL güncellenemezse görünüm yine de değişir */
  }
  emit();
}

/** "Yalnız favoriler" görünümü açık mı? (SSR'da false) */
export function useFavMode(): boolean {
  return useSyncExternalStore(subscribe, readFavMode, () => false);
}
