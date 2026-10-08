"use client";

import { useEffect, useMemo, useSyncExternalStore, type ReactNode } from "react";
import { RotateCcw, Search } from "lucide-react";
import type { LucideIcon } from "lucide-react";
import { OPEN_PALETTE_EVENT } from "@/lib/palette-core";
import { bumpUsage, getHrefStore, getUsageStore, MAX_RECENT_SHOWN, pushRecent, togglePin, topUsed } from "@/lib/nav-memory";
import { ShortcutHint } from "@/components/app/shortcut-hint";

/**
 * Yan menü "Hızlı erişim" (/app ve /admin AYNI davranış): sabitlenenler + otomatik "en çok kullandıkların".
 * Yalnız sayfa yolları yerel depoda (localStorage, try/catch) tutulur; kişisel veri yoktur, sunucuya hiçbir şey gitmez.
 * Okunurken menüdeki (yetkili) öğelerle süzülür: yetkisi alınan sayfa belleğte kalsa da görünmez.
 */

export type QuickItem = { href: string; label: string; icon: LucideIcon; description?: string };

/** Ana ekran her zaman menünün ilk satırıdır; "çok kullanılan" listesini boşuna doldurmasın. */
const HOME_HREFS = new Set(["/app", "/admin"]);

export function useQuickAccess({
  scope,
  kind,
  items,
  activeHref,
}: {
  scope: string | undefined;
  kind: "app" | "admin";
  /** Menüde görünen (yetkili) tüm öğeler; süzgeç ve sıralama kaynağı. */
  items: readonly QuickItem[];
  activeHref: string | null;
}) {
  const pinStore = getHrefStore("pins", scope, kind);
  const recentStore = getHrefStore("recent", scope, kind);
  const usageStore = getUsageStore(scope, kind);
  const pins = useSyncExternalStore(pinStore.subscribe, pinStore.read, pinStore.getServerSnapshot);
  const recents = useSyncExternalStore(recentStore.subscribe, recentStore.read, recentStore.getServerSnapshot);
  const usage = useSyncExternalStore(usageStore.subscribe, usageStore.read, usageStore.getServerSnapshot);

  // Ziyaret kaydı: yalnız sayfa yolu. Son açılanlar (soğuk başlangıç dolgusu) + kullanım sayacı.
  useEffect(() => {
    if (!activeHref) return;
    const cur = recentStore.read();
    if (cur[0] !== activeHref) recentStore.write(pushRecent(cur, activeHref));
    if (!HOME_HREFS.has(activeHref)) usageStore.write(bumpUsage(usageStore.read(), activeHref));
  }, [activeHref, recentStore, usageStore]);

  const byHref = useMemo(() => new Map(items.map((i) => [i.href, i])), [items]);
  const pinned = pins.flatMap((h) => byHref.get(h) ?? []);
  const allowed = useMemo(() => new Set(items.map((i) => i.href)), [items]);
  const top = topUsed(usage, { exclude: [...pins, ...HOME_HREFS], allowed }).flatMap((h) => byHref.get(h) ?? []);
  // Soğuk başlangıç: henüz yeterli kullanım yoksa son açılan 2 sayfa dolgu olur (sabitlenen/aktif/ana ekran hariç).
  const fill =
    pinned.length + top.length >= 3
      ? []
      : recents
          .filter((h) => !pins.includes(h) && !HOME_HREFS.has(h) && h !== activeHref && !top.some((t) => t.href === h))
          .flatMap((h) => byHref.get(h) ?? [])
          .slice(0, MAX_RECENT_SHOWN);

  return {
    pins,
    pinned,
    auto: [...top, ...fill],
    hasUsage: Object.keys(usage).length > 0,
    togglePin: (href: string) => pinStore.write(togglePin(pinStore.read(), href)),
    resetUsage: () => {
      usageStore.reset();
      recentStore.write([]);
    },
  };
}

export function QuickAccessSection({
  pinned,
  auto,
  hasUsage,
  onReset,
  renderRow,
}: {
  pinned: readonly QuickItem[];
  auto: readonly QuickItem[];
  hasUsage: boolean;
  onReset: () => void;
  renderRow: (item: QuickItem, kind: "pin" | "auto") => ReactNode;
}) {
  const empty = pinned.length === 0 && auto.length === 0;
  return (
    <section aria-label="Hızlı erişim" className="pb-1">
      <div className="sb-eyebrow flex items-center gap-2 px-3 pb-0.5 pt-1.5 text-white/70">
        <span className="min-w-0 truncate uppercase" title="Hızlı erişim">Hızlı erişim</span>
        <span className="h-px min-w-2 flex-1 bg-white/10" aria-hidden />
        {hasUsage || auto.length > 0 ? (
          <button
            type="button"
            onClick={onReset}
            title="Otomatik listeyi sıfırla (sabitlenenler kalır)"
            aria-label="Otomatik hızlı erişim listesini sıfırla"
            className="focus-ring grid h-7 w-7 shrink-0 place-items-center rounded-[var(--radius-control)] text-white/60 transition-colors hover:bg-white/10 hover:text-white touch:h-11 touch:w-11"
          >
            <RotateCcw className="h-3.5 w-3.5" aria-hidden />
          </button>
        ) : null}
      </div>
      {empty ? (
        <p className="px-3 py-1 text-xs leading-5 text-white/60">Sık açtığın sayfalar burada görünür. İğneyle sabitleyebilirsin.</p>
      ) : (
        <div className="space-y-0.5">
          {pinned.map((i) => renderRow(i, "pin"))}
          {auto.length > 0 ? (
            <>
              {pinned.length > 0 ? <p className="px-3 pb-0.5 pt-1.5 text-xs text-white/55">Sık kullandıkların</p> : null}
              {auto.map((i) => renderRow(i, "auto"))}
            </>
          ) : null}
        </div>
      )}
    </section>
  );
}

/** "Menüde ara": komut paletini (Ctrl K) açar; palet menü sayfalarını açıklama ve eş anlamlılarıyla süzer. */
export function MenuSearchButton({ onActivate }: { onActivate?: () => void }) {
  return (
    <button
      type="button"
      onClick={() => {
        onActivate?.();
        window.dispatchEvent(new Event(OPEN_PALETTE_EVENT));
      }}
      aria-label="Menüde ara (komut paletini aç)"
      title="Menüde ara, sayfaya git"
      className="sb-expanded focus-ring mx-3 mt-2 flex min-h-9 touch:min-h-11 w-[calc(100%-1.5rem)] items-center gap-2 rounded-[var(--radius-control)] bg-white/6 px-3 text-left text-sm text-white/70 transition-colors hover:bg-white/10 hover:text-white"
    >
      <Search className="h-4 w-4 shrink-0" aria-hidden />
      <span className="min-w-0 flex-1 truncate">Menüde ara</span>
      <ShortcutHint className="rounded border border-white/15 px-1.5 text-[0.6875rem] leading-5 text-white/65" />
    </button>
  );
}
