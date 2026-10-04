"use client";

import { useSyncExternalStore, type ReactNode } from "react";

const subscribe = () => () => {};

function isApplePlatform(): boolean {
  const nav = navigator as Navigator & { userAgentData?: { platform?: string } };
  const platform = nav.userAgentData?.platform ?? navigator.platform ?? "";
  return /mac|iphone|ipad|ipod/i.test(platform);
}

/** Platform farkı: Mac'te ⌘, diğerlerinde Ctrl. Sunucu ve ilk hidrasyon "Ctrl" (sonra istemci düzeltir). */
export function useModKey(): string {
  return useSyncExternalStore(subscribe, () => (isApplePlatform() ? "⌘" : "Ctrl"), () => "Ctrl");
}

const BASE =
  "inline-flex items-center justify-center rounded-[var(--radius-control)] border border-hairline bg-canvas px-1.5 py-0.5 font-sans text-xs font-semibold leading-none text-text-muted";

/**
 * Klavye tuşu etiketi. `mod` verilirse tuş platforma göre Ctrl/⌘ olur ("Ctrl" ya da "⌘" yazmayın,
 * `mod` kullanın). Metin içinde: <Kbd mod /> + <Kbd>K</Kbd>. Hidrasyon güvenli.
 */
export function Kbd({
  children,
  mod = false,
  className = "",
}: {
  children?: ReactNode;
  mod?: boolean;
  className?: string;
}) {
  const modKey = useModKey();
  return (
    <kbd className={`${BASE} ${className}`.trim()} suppressHydrationWarning>
      {mod ? modKey : children}
    </kbd>
  );
}

/** Kısayol grubu (["mod", "K"] ya da ["G", "M"]). "mod" ve "Ctrl" öğeleri platform tuşuna (Ctrl/⌘) çevrilir. */
export function KbdCombo({ keys, className = "" }: { keys: readonly string[]; className?: string }) {
  return (
    <span className="inline-flex items-center gap-1">
      {keys.map((k, i) => (
        <Kbd key={`${k}-${i}`} mod={k === "mod" || k === "Ctrl"} className={className}>
          {k}
        </Kbd>
      ))}
    </span>
  );
}
