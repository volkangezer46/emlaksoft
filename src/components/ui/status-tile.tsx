import Link from "@/components/ui/smart-link";
import { cn } from "@/lib/utils";

/**
 * StatusTile — durum mini kartı (tasarım sistemi v4): durum noktası + etiket, değer, alt metin
 * ve isteğe bağlı ilerleme çubuğu (ör. "35 / 36 başarılı"). Tamamı `href` hedefine gider
 * (sıfır çıkmaz metrik). İlerleme yalnız GERÇEK pay (value/max, max > 0) ile çizilir; dolum
 * motion.css `.motion-progress-fill` ile bir kez (reduce'ta durağan). Renk tek başına anlam
 * taşımaz: etiket + değer metni her zaman var.
 */
export type StatusTone = "success" | "warn" | "danger" | "neutral" | "brand";

export function StatusTile({
  label,
  value,
  hint,
  href,
  tone = "neutral",
  progress,
  className,
}: {
  label: string;
  value: string;
  hint?: string;
  href: string;
  tone?: StatusTone;
  progress?: { value: number; max: number; label: string };
  className?: string;
}) {
  const ratio = progress && progress.max > 0 ? Math.min(1, Math.max(0, progress.value / progress.max)) : null;
  return (
    <Link href={href} className={cn(`ds-tile pm-t-${tone} focus-ring`, className)}>
      <span className="flex items-center gap-1.5 text-xs font-medium text-text-muted">
        <span className="pm-dot" aria-hidden="true" />
        {label}
      </span>
      <span className="text-sm font-bold tabular-nums text-text">{value}</span>
      {hint ? <span className="truncate text-xs text-text-muted" title={hint}>{hint}</span> : null}
      {ratio !== null && progress ? (
        <span
          className="ds-bar mt-0.5"
          role="meter"
          aria-label={progress.label}
          aria-valuemin={0}
          aria-valuemax={progress.max}
          aria-valuenow={Math.min(progress.value, progress.max)}
        >
          <span className="motion-progress-fill" style={{ width: `${Math.max(ratio * 100, progress.value > 0 ? 3 : 0)}%` }} />
        </span>
      ) : null}
    </Link>
  );
}
