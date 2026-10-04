"use client";

import { useModKey } from "@/components/ui/kbd";

/**
 * Arama kısayolu ipucu: Mac'te "⌘ K", diğerlerinde "Ctrl K". Platform algısı ortak Kbd bileşenindedir
 * (sunucu ve ilk hidrasyon "Ctrl K", istemci sonra platforma düzelir).
 */
export function useSearchShortcut(): string {
  return `${useModKey()} K`;
}

export function ShortcutHint({ className }: { className?: string }) {
  const label = useSearchShortcut();
  return (
    <kbd className={className} suppressHydrationWarning>
      {label}
    </kbd>
  );
}
