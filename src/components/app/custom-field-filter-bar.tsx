import Link from "next/link";
import { SlidersHorizontal, X } from "lucide-react";
import { CUSTOM_FIELD_TYPE_LABELS } from "@/lib/custom-fields/core";
import type { CustomFieldFilterState } from "@/lib/custom-fields/filter";

/**
 * Özel alan filtresi (sunucu bileşeni; GET formu, JS gerekmez). URL kontratı `?ozel=<anahtar>:<değer>`; form
 * `ozel_alan` + `ozel_deger` gönderir, sunucu aynı kontrata indirger. Diğer filtreler gizli alanlarla korunur,
 * sayfa numarası sıfırlanır. Tanım yoksa hiçbir şey çizmez.
 */
export function CustomFieldFilterBar({
  path,
  params,
  state,
}: {
  path: string;
  params: Record<string, string | string[] | undefined>;
  state: CustomFieldFilterState;
}) {
  if (state.defs.length === 0) return null;
  const keep = Object.entries(params).filter(
    ([k, v]) => !["ozel", "ozel_alan", "ozel_deger", "sayfa", "page", "adet"].includes(k) && typeof v === "string" && v !== "",
  ) as [string, string][];
  const clearHref = `${path}${keep.length ? `?${new URLSearchParams(keep).toString()}` : ""}`;
  const field = "rounded-[var(--radius-control)] border border-line bg-canvas px-2.5 py-1.5 text-xs outline-none focus:border-brand-300";
  return (
    <form method="get" action={path} className="flex flex-wrap items-center gap-2" aria-label="Özel alan filtresi">
      {keep.map(([k, v]) => (
        <input key={k} type="hidden" name={k} value={v} />
      ))}
      <SlidersHorizontal className="h-3.5 w-3.5 text-text-faint" aria-hidden="true" />
      <label className="sr-only" htmlFor={`ozel-alan-${path}`}>Özel alan</label>
      <select id={`ozel-alan-${path}`} name="ozel_alan" defaultValue={state.active?.def.key ?? ""} className={field}>
        <option value="">Özel alan seçin</option>
        {state.defs.map((d) => (
          <option key={d.id} value={d.key}>
            {d.label} ({CUSTOM_FIELD_TYPE_LABELS[d.fieldType]})
          </option>
        ))}
      </select>
      <label className="sr-only" htmlFor={`ozel-deger-${path}`}>Değer</label>
      <input
        id={`ozel-deger-${path}`}
        name="ozel_deger"
        defaultValue={state.active?.value ?? ""}
        maxLength={200}
        placeholder="Değer (evet/hayir, YYYY-AA-GG…)"
        className={`${field} w-48`}
      />
      <button type="submit" className="focus-ring press rounded-[var(--radius-control)] border border-line px-2.5 py-1.5 text-xs font-semibold text-text-muted hover:border-brand-300 hover:text-accent-text">
        Süz
      </button>
      {state.active ? (
        <span className="inline-flex items-center gap-1.5 rounded-full bg-surface-accent-soft px-3 py-1 text-xs font-semibold text-accent-text">
          {state.active.def.label}: {state.active.value}
          {state.ids ? ` · ${state.ids.length}${state.capped ? "+" : ""} kayıt` : ""}
          <Link href={clearHref} aria-label="Özel alan filtresini temizle" className="focus-ring rounded-full hover:text-brand-900">
            <X className="h-3.5 w-3.5" />
          </Link>
        </span>
      ) : null}
      {state.capped ? <span className="text-xs text-amber-700">İlk 1000 eşleşme gösteriliyor; değeri daraltın.</span> : null}
    </form>
  );
}
