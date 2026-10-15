"use client";

import { createContext, useContext, useState, type ReactNode } from "react";
import { Presentation } from "lucide-react";
import Link from "@/components/ui/smart-link";
import { PRESENTATION_MAX_PROPERTIES, presentationHref } from "@/lib/presentation-prefill";

/**
 * Eşleşme listesinden çoklu sunum seçimi: tek müşteriye süzülmüş listede satır başına "Sunuma ekle" kutusu; seçilen
 * portföylerle `/app/portfoyler/sunumlar/yeni?portfoy=a,b,c&musteri=x` açılır (sunum en fazla PRESENTATION_MAX_PROPERTIES portföy).
 */
type Ctx = { selected: string[]; toggle: (id: string) => void };
const SelectionCtx = createContext<Ctx | null>(null);

export function MatchSelectionProvider({ children }: { children: ReactNode }) {
  const [selected, setSelected] = useState<string[]>([]);
  const toggle = (id: string) =>
    setSelected((prev) =>
      prev.includes(id) ? prev.filter((x) => x !== id) : prev.length >= PRESENTATION_MAX_PROPERTIES ? prev : [...prev, id],
    );
  return <SelectionCtx.Provider value={{ selected, toggle }}>{children}</SelectionCtx.Provider>;
}

export function MatchSelectCheckbox({ propertyId, label }: { propertyId: string; label: string }) {
  const ctx = useContext(SelectionCtx);
  if (!ctx) return null;
  const checked = ctx.selected.includes(propertyId);
  const full = !checked && ctx.selected.length >= PRESENTATION_MAX_PROPERTIES;
  return (
    <label
      className={`inline-flex min-h-9 touch:min-h-11 items-center gap-1.5 text-xs font-semibold ${full ? "text-text-faint" : "text-ink-950"}`}
      title={full ? `Sunum en fazla ${PRESENTATION_MAX_PROPERTIES} portföy içerebilir` : "Bu portföyü çoklu sunuma ekle"}
    >
      <input
        type="checkbox"
        className="h-4 w-4 accent-brand-600"
        checked={checked}
        disabled={full}
        onChange={() => ctx.toggle(propertyId)}
        aria-label={`${label} sunuma ekle`}
      />
      Sunuma ekle
    </label>
  );
}

export function MatchSelectionBar({ customerId }: { customerId: string | null }) {
  const ctx = useContext(SelectionCtx);
  if (!ctx) return null;
  const n = ctx.selected.length;
  const cls =
    "focus-ring press inline-flex min-h-9 touch:min-h-11 items-center gap-1.5 rounded-[var(--radius-control)] border px-3 text-xs font-semibold transition";
  if (n === 0) {
    return (
      <span className={`${cls} border-line text-text-faint`} title="Listeden portföy seçin">
        <Presentation className="h-3.5 w-3.5" aria-hidden="true" /> Seçilenlerle sunum (0/{PRESENTATION_MAX_PROPERTIES})
      </span>
    );
  }
  return (
    <Link
      href={presentationHref(ctx.selected, customerId)}
      className={`${cls} border-brand-300 bg-brand-600/[0.06] text-brand-600 hover:border-brand-600`}
      title="Seçilen portföylerle müşteriye özel sunum hazırla"
    >
      <Presentation className="h-3.5 w-3.5" aria-hidden="true" /> Seçilenlerle sunum ({n}/{PRESENTATION_MAX_PROPERTIES})
    </Link>
  );
}
