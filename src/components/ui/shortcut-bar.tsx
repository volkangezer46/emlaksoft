"use client";

import { KbdCombo } from "@/components/ui/kbd";

export type ShortcutBarItem = { keys: readonly string[]; label: string };

/**
 * ShortcutBar — sayfa altında sakin kısayol ipucu çubuğu (yalnız klavyeli cihazlarda; dokunmatik/dar
 * ekranda gizli). Yeni kısayol icat etmez: komut paleti (mod+K), `g` gezinme zinciri ve `?` listesi
 * `components/app/keyboard-shortcuts.tsx` ile birebir aynıdır; burada yalnız görünür kılınır.
 */
export function ShortcutBar({ items, className = "" }: { items: readonly ShortcutBarItem[]; className?: string }) {
  return (
    <nav aria-label="Klavye kısayolları" className={`hidden items-center gap-x-5 gap-y-2 text-xs text-text-muted md:flex md:flex-wrap ${className}`.trim()}>
      {items.map((it) => (
        <span key={it.label} className="inline-flex items-center gap-1.5">
          <KbdCombo keys={it.keys} />
          {it.label}
        </span>
      ))}
    </nav>
  );
}
