import Link from "next/link";
import type { Period } from "@/lib/accounting/period";

/** Dönem seçici (sunucu bileşeni, GET formu + bağlantılar): bu ay / geçen ay / tüm zamanlar / özel aralık. */
export function PeriodBar({
  basePath,
  period,
  keep,
}: {
  basePath: string;
  period: Period;
  /** Dönem dışındaki korunacak sorgu parametreleri (defter süzgeçleri vb.). */
  keep?: Record<string, string>;
}) {
  const hrefFor = (donem: "bu-ay" | "gecen-ay" | "tumu") => {
    const sp = new URLSearchParams({ ...(keep ?? {}), donem });
    return `${basePath}?${sp.toString()}`;
  };
  const presets = [
    { id: "bu-ay", label: "Bu ay" },
    { id: "gecen-ay", label: "Geçen ay" },
    { id: "tumu", label: "Tüm zamanlar" },
  ] as const;

  return (
    <div className="flex flex-wrap items-end gap-3 rounded-[var(--radius-card)] border border-line bg-surface p-3">
      <div className="flex flex-wrap gap-1" role="group" aria-label="Dönem">
        {presets.map((p) => {
          const active = period.preset === p.id;
          return (
            <Link
              key={p.id}
              href={hrefFor(p.id)}
              aria-current={active ? "page" : undefined}
              className={`focus-ring min-h-9 rounded-[var(--radius-control)] px-3 py-1.5 text-sm font-semibold transition ${
                active ? "bg-ink-950 text-white" : "text-text-muted hover:bg-canvas hover:text-ink-950"
              }`}
            >
              {p.label}
            </Link>
          );
        })}
      </div>
      <form action={basePath} className="flex flex-wrap items-end gap-2">
        {Object.entries(keep ?? {}).map(([k, v]) => (
          <input key={k} type="hidden" name={k} value={v} />
        ))}
        <input type="hidden" name="donem" value="ozel" />
        <label className="text-xs font-semibold text-text-muted">
          Başlangıç
          <input
            type="date"
            name="from"
            defaultValue={period.preset === "ozel" ? (period.fromDay ?? "") : ""}
            className="mt-1 block rounded-[var(--radius-control)] border border-line bg-canvas px-2.5 py-1.5 text-xs text-ink-950 outline-none focus:border-brand-400"
          />
        </label>
        <label className="text-xs font-semibold text-text-muted">
          Bitiş
          <input
            type="date"
            name="to"
            defaultValue={period.preset === "ozel" ? (period.toDay ?? "") : ""}
            className="mt-1 block rounded-[var(--radius-control)] border border-line bg-canvas px-2.5 py-1.5 text-xs text-ink-950 outline-none focus:border-brand-400"
          />
        </label>
        <button type="submit" className="focus-ring press rounded-[var(--radius-control)] bg-ink-950 px-3 py-2 text-xs font-semibold text-white">
          Aralığı uygula
        </button>
      </form>
      <p className="ml-auto text-xs font-semibold text-ink-950" aria-live="polite">
        Dönem: {period.label}
      </p>
    </div>
  );
}
