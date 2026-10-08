import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import Link from "@/components/ui/smart-link";
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
          <Input
            type="date"
            name="from"
            defaultValue={period.preset === "ozel" ? (period.fromDay ?? "") : ""}
            className="mt-1 block text-xs"
          />
        </label>
        <label className="text-xs font-semibold text-text-muted">
          Bitiş
          <Input
            type="date"
            name="to"
            defaultValue={period.preset === "ozel" ? (period.toDay ?? "") : ""}
            className="mt-1 block text-xs"
          />
        </label>
        <Button variant="navy" size="sm" type="submit">
          Aralığı uygula
        </Button>
      </form>
      <p className="ml-auto text-xs font-semibold text-ink-950" aria-live="polite">
        Dönem: {period.label}
      </p>
    </div>
  );
}
