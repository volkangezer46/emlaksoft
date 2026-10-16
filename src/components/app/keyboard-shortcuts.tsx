"use client";

import dynamic from "next/dynamic";

/**
 * Klavye kısayolları — tembel sarmalayıcı. Dinleyici görünmezdir (ilk çizimde hiçbir şey basmaz); kodu
 * (`keyboard-shortcuts-live.tsx`) her /app rotasının ilk yük JS'inden çıkar ve hidrasyondan hemen sonra iner.
 */
export const KeyboardShortcuts = dynamic(() => import("./keyboard-shortcuts-live").then((m) => m.KeyboardShortcuts), {
  ssr: false,
  loading: () => null,
});
