"use client";

import { Check, Scale } from "lucide-react";
import { toggleCompare, useCompareSelection } from "@/components/public/compare-select";
import type { CompareItem } from "@/components/public/compare-table";

/**
 * Tablo satırı karşılaştırma anahtarı — public compare-select store'unu kullanır
 * (oturumluk seçim, en çok 3). Görünüm token'lıdır (açık/koyu tema); alt çubuk
 * ve tam ekran tabloyu sayfadaki tek `CompareBar` yönetir.
 */
export function PropertyRowCompare({ item }: { item: CompareItem }) {
  const items = useCompareSelection();
  const active = items.some((x) => x.id === item.id);
  const full = !active && items.length >= 3;
  const label = active ? "Karşılaştırmadan çıkar" : full ? "En fazla 3 ilan karşılaştırılır" : "Karşılaştırmaya ekle";
  return (
    <button
      type="button"
      aria-pressed={active}
      aria-label={label}
      title={label}
      disabled={full}
      onClick={() => toggleCompare(item)}
      className={`focus-ring press relative z-10 grid h-8 w-8 place-items-center rounded-[var(--radius-control)] border transition disabled:cursor-not-allowed disabled:opacity-40 ${
        active
          ? "border-transparent bg-[var(--success-soft)] text-[var(--success-strong)]"
          : "border-transparent text-text-muted hover:border-line hover:bg-canvas hover:text-brand-700"
      }`}
    >
      {active ? <Check aria-hidden="true" className="h-4 w-4" /> : <Scale aria-hidden="true" className="h-4 w-4" />}
    </button>
  );
}
