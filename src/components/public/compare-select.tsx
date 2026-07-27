"use client";

import { useState, useSyncExternalStore } from "react";
import { Check, Scale, X } from "lucide-react";
import { CompareTable, type CompareItem } from "./compare-table";

/* ------------------------------------------------------------------
   Karşılaştırma seçimi — modül seviyesinde küçük dış store (oturumluk,
   sayfa yenilenince sıfırlanır; kalıcılık favoride, seçim geçici).
   Vitrin kartları ve müşteri portalı kartları aynı store'u kullanır;
   CompareBar tek kopya alt çubuk + tam ekran tabloyu yönetir.
   ------------------------------------------------------------------ */

const MAX = 3;
const EMPTY: CompareItem[] = [];

let selected: CompareItem[] = EMPTY;
const listeners = new Set<() => void>();

function emit() {
  listeners.forEach((l) => l());
}

function subscribe(cb: () => void) {
  listeners.add(cb);
  return () => {
    listeners.delete(cb);
  };
}

export function toggleCompare(item: CompareItem) {
  if (selected.some((x) => x.id === item.id)) {
    selected = selected.filter((x) => x.id !== item.id);
  } else if (selected.length < MAX) {
    selected = [...selected, item];
  } else {
    return; // 3 sınırı — önce birini çıkarmak gerekir
  }
  emit();
}

export function removeCompare(id: string) {
  if (!selected.some((x) => x.id === id)) return;
  selected = selected.filter((x) => x.id !== id);
  emit();
}

export function clearCompare() {
  if (selected === EMPTY || selected.length === 0) return;
  selected = EMPTY;
  emit();
}

export function useCompareSelection(): CompareItem[] {
  return useSyncExternalStore(subscribe, () => selected, () => EMPTY);
}

/**
 * Kart üstü "karşılaştırmaya ekle" anahtarı.
 * - `overlay`: vitrin kartı görseli üstünde yuvarlak ikon (kalbin altı);
 *   kart Link'inin üstünde kalması için relative z-10, tık gezinmez.
 * - `row`: müşteri portalı kartında tam genişlik satır (✓ Karşılaştır).
 */
export function CompareToggle({
  item,
  variant = "overlay",
}: {
  item: CompareItem;
  variant?: "overlay" | "row";
}) {
  const items = useCompareSelection();
  const active = items.some((x) => x.id === item.id);
  const full = !active && items.length >= MAX;
  const label = active
    ? "Karşılaştırmadan çıkar"
    : full
      ? `En fazla ${MAX} ilan karşılaştırılır`
      : "Karşılaştırmaya ekle";

  if (variant === "row") {
    return (
      <div className="border-t border-zinc-100 px-4 pb-3 pt-2.5">
        <button
          type="button"
          aria-pressed={active}
          disabled={full}
          title={label}
          onClick={() => toggleCompare(item)}
          className={`inline-flex w-full items-center justify-center gap-1.5 rounded-lg border px-3 py-2 text-xs font-bold transition disabled:cursor-not-allowed disabled:opacity-50 ${
            active
              ? "border-mint-500/40 bg-mint-500/10 text-mint-600"
              : "border-zinc-200 bg-white text-zinc-500 hover:border-mint-500/40 hover:text-mint-600"
          }`}
        >
          {active ? <Check className="h-3.5 w-3.5" /> : <Scale className="h-3.5 w-3.5" />}
          {active ? "Karşılaştırmada" : "Karşılaştır"}
        </button>
      </div>
    );
  }

  return (
    <button
      type="button"
      aria-pressed={active}
      aria-label={label}
      title={label}
      disabled={full}
      onClick={(e) => {
        e.preventDefault();
        e.stopPropagation();
        toggleCompare(item);
      }}
      className={`focus-ring press relative z-10 grid h-9 w-9 place-items-center rounded-full border shadow-sm backdrop-blur transition disabled:cursor-not-allowed disabled:opacity-50 ${
        active
          ? "border-mint-500/50 bg-mint-500 text-white"
          : "border-white/40 bg-white/85 text-ink-950/60 hover:text-mint-600"
      }`}
    >
      {active ? <Check className="h-4 w-4" /> : <Scale className="h-4 w-4" />}
    </button>
  );
}

/**
 * Alt çubuk — seçim varken görünür: "Karşılaştır (N)" (2+ seçimde aktif)
 * + temizle. Tıklanınca aynı sayfada tam ekran CompareTable overlay açılır
 * (yeni route yok). Sayfaya bir kez konur.
 */
export function CompareBar() {
  const items = useCompareSelection();
  const [open, setOpen] = useState(false);

  if (items.length === 0) return null;
  const ready = items.length >= 2;

  return (
    <>
      {/* Mobilde panel alt gezinme çubuğunun (h~64px) üstünde durur */}
      <div className="fixed inset-x-0 bottom-20 z-[70] flex justify-center px-4 pb-[env(safe-area-inset-bottom)] md:bottom-4 md:pb-0">
        <div className="flex items-center gap-2 rounded-full border border-white/10 bg-ink-950/95 py-2 pl-4 pr-2 text-white shadow-xl backdrop-blur">
          <span className="text-xs font-semibold text-white/70">
            {ready ? `${items.length} ilan seçili` : "Karşılaştırmak için en az 2 ilan seçin"}
          </span>
          <button
            type="button"
            disabled={!ready}
            onClick={() => setOpen(true)}
            className="focus-ring press inline-flex items-center gap-1.5 rounded-full bg-mint-500 px-4 py-2 text-xs font-bold text-ink-950 transition hover:bg-mint-400 disabled:cursor-not-allowed disabled:opacity-40"
          >
            <Scale className="h-3.5 w-3.5" /> Karşılaştır ({items.length})
          </button>
          <button
            type="button"
            onClick={() => {
              setOpen(false);
              clearCompare();
            }}
            aria-label="Seçimi temizle"
            title="Seçimi temizle"
            className="focus-ring press grid h-8 w-8 place-items-center rounded-full text-white/50 transition hover:bg-white/10 hover:text-white"
          >
            <X className="h-4 w-4" />
          </button>
        </div>
      </div>

      {open && ready ? (
        <CompareTable items={items} onClose={() => setOpen(false)} onRemove={removeCompare} />
      ) : null}
    </>
  );
}
