import { cn } from "@/lib/utils";
import { formatTrTime, msSince, now } from "@/lib/clock";
import { ageText, FRESHNESS_LABEL, freshnessLevel, type FreshnessLevel } from "@/lib/ui/freshness";

const TONE: Record<FreshnessLevel, string> = {
  taze: "pm-t-success",
  guncel: "pm-t-brand",
  bayat: "pm-t-warn",
};

/**
 * DataFreshness — "Son güncelleme 14:32 · Taze" damgası (sunucu bileşeni, istemci JS yok).
 * `asOf` verilmezse verinin bu istekte okunduğu an kullanılır; verinin kendi zaman damgası
 * (ör. cron kalp atışı) biliniyorsa onu geçin. Renk tek başına anlam taşımaz: metin her zaman var.
 */
export function DataFreshness({ asOf, label = "Son güncelleme", className }: { asOf?: string | number | Date | null; label?: string; className?: string }) {
  const at = asOf ?? now();
  const age = msSince(at);
  const level = freshnessLevel(age);
  return (
    <span
      className={cn("inline-flex items-center gap-1.5 text-xs text-text-muted tabular-nums", TONE[level], className)}
      title={`${label} ${formatTrTime(at)} · ${ageText(age)}`}
    >
      <span className="pm-dot" aria-hidden="true" />
      <span>
        {label} {formatTrTime(at)}
      </span>
      <span className="font-semibold" style={{ color: "var(--t-text, currentColor)" }}>
        · {FRESHNESS_LABEL[level]}
      </span>
    </span>
  );
}
