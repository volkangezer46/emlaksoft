"use client";

import { useRouter, useSearchParams } from "next/navigation";
import { SlidersHorizontal } from "lucide-react";
import { Combobox } from "@/components/ui/combobox";

/**
 * Ağ havuzu filtreleri — filtre kontratı: URL'deki değerler sunucu sorgusuna
 * yansır (page.tsx searchParams okur), buradaki kontroller URL'i günceller.
 *
 * Aynı sayfada iki bölüm bu bileşeni kullanır: portföy havuzu (öneksiz
 * il/tip/min/max) ve talep havuzu (`prefix="talep_"` → talep_il/talep_tip/
 * talep_min/talep_max) — paramlar bölüm bazlı öneklerle çakışmaz.
 */
export function PoolFilters({
  provinces,
  propertyTypes,
  current,
  prefix = "",
  anchor = "#havuz",
  typeLabel = "Portföy tipi",
  minLabel = "Min. fiyat (₺)",
  maxLabel = "Maks. fiyat (₺)",
}: {
  provinces: { id: string; name: string }[];
  propertyTypes: string[];
  current: { il: string; tip: string; min: string; max: string };
  /** URL param öneki — talep havuzu "talep_" kullanır (portföyle çakışmasın). */
  prefix?: string;
  /** Filtre değişiminde kaydırılacak bölüm çapası. */
  anchor?: string;
  typeLabel?: string;
  minLabel?: string;
  maxLabel?: string;
}) {
  const router = useRouter();
  const searchParams = useSearchParams();

  const setParam = (key: string, value: string) => {
    const params = new URLSearchParams(searchParams.toString());
    if (value) params.set(`${prefix}${key}`, value);
    else params.delete(`${prefix}${key}`);
    router.replace(`/app/ag?${params.toString()}${anchor}`, { scroll: false });
  };

  const inputClass =
    "focus-ring h-10 w-full rounded-[10px] border border-hairline-strong bg-surface px-3 text-sm text-ink-950 placeholder:text-text-faint";

  return (
    <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
      <div>
        <label className="mb-1 flex items-center gap-1.5 text-xs font-semibold text-text-muted" htmlFor={`nw-filter-${prefix}il`}>
          <SlidersHorizontal className="h-3.5 w-3.5" /> İl
        </label>
        <Combobox
          id={`nw-filter-${prefix}il`}
          options={provinces.map((p) => ({ value: p.id, label: p.name }))}
          value={current.il}
          onValueChange={(v) => setParam("il", v)}
          placeholder="Tüm iller"
          searchPlaceholder="İl ara…"
          emptyText="İl bulunamadı."
        />
      </div>

      <div>
        <label className="mb-1 block text-xs font-semibold text-text-muted" htmlFor={`nw-filter-${prefix}tip`}>
          {typeLabel}
        </label>
        <Combobox
          id={`nw-filter-${prefix}tip`}
          options={propertyTypes.map((t) => ({ value: t, label: t }))}
          value={current.tip}
          onValueChange={(v) => setParam("tip", v)}
          placeholder="Tüm tipler"
          searchPlaceholder="Tip ara…"
          emptyText="Tip bulunamadı."
        />
      </div>

      <div>
        <label className="mb-1 block text-xs font-semibold text-text-muted" htmlFor={`nw-filter-${prefix}min`}>
          {minLabel}
        </label>
        <input
          id={`nw-filter-${prefix}min`}
          type="number"
          min={0}
          className={inputClass}
          placeholder="Örn. 1.000.000"
          defaultValue={current.min}
          onBlur={(e) => setParam("min", e.target.value.trim())}
          onKeyDown={(e) => {
            if (e.key === "Enter") setParam("min", e.currentTarget.value.trim());
          }}
        />
      </div>

      <div>
        <label className="mb-1 block text-xs font-semibold text-text-muted" htmlFor={`nw-filter-${prefix}max`}>
          {maxLabel}
        </label>
        <input
          id={`nw-filter-${prefix}max`}
          type="number"
          min={0}
          className={inputClass}
          placeholder="Örn. 10.000.000"
          defaultValue={current.max}
          onBlur={(e) => setParam("max", e.target.value.trim())}
          onKeyDown={(e) => {
            if (e.key === "Enter") setParam("max", e.currentTarget.value.trim());
          }}
        />
      </div>
    </div>
  );
}
