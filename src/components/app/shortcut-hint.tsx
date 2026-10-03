"use client";

import { useSyncExternalStore } from "react";

const subscribe = () => () => {};

function isApplePlatform(): boolean {
  const nav = navigator as Navigator & { userAgentData?: { platform?: string } };
  const platform = nav.userAgentData?.platform ?? navigator.platform ?? "";
  return /mac|iphone|ipad|ipod/i.test(platform);
}

/**
 * Arama kısayolu ipucu: Mac'te "⌘ K", diğerlerinde "Ctrl K". Sunucu ve ilk hidrasyon "Ctrl K"
 * ile aynıdır (useSyncExternalStore sunucu anlık görüntüsü), istemci sonra platforma düzelir.
 */
export function useSearchShortcut(): string {
  return useSyncExternalStore(subscribe, () => (isApplePlatform() ? "⌘ K" : "Ctrl K"), () => "Ctrl K");
}

export function ShortcutHint({ className }: { className?: string }) {
  const label = useSearchShortcut();
  return (
    <kbd className={className} suppressHydrationWarning>
      {label}
    </kbd>
  );
}
