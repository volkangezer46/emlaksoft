import Link from "@/components/ui/smart-link";
import { formatAccountMoney } from "@/lib/finance/cash/money";
import { AGING_LABEL, bucketShare, type AgingBucketKey, type AgingSummary } from "@/lib/finance/party/aging";
import { cn } from "@/lib/utils";

/**
 * Yaşlandırma çubukları (0–30 / 31–60 / 61–90 / 90+, vadesi gelmemiş ve — kalem varsa — vadesiz). Her kova tıklanınca açık kalemler o kovaya
 * süzülür (sıfır çıkmaz metrik). Üstteki yığılmış şerit tutar payını, altındaki satırlar adet ve tutarı gösterir.
 * Kovaların toplamı başlıktaki toplamla aynıdır (kuruş hesabı, `normalizeAging`).
 */

const BUCKET_TONE: Record<AgingBucketKey, { bar: string; dot: string }> = {
  vadesi_gelmedi: { bar: "bg-brand-400", dot: "bg-brand-400" },
  "0-30": { bar: "bg-warning-400", dot: "bg-warning-400" },
  "31-60": { bar: "bg-warning-600", dot: "bg-warning-600" },
  "61-90": { bar: "bg-danger-400", dot: "bg-danger-400" },
  "90+": { bar: "bg-danger-600", dot: "bg-danger-600" },
  vadesiz: { bar: "bg-text-muted", dot: "bg-text-muted" },
};

export function AgingBars({
  title,
  summary,
  hrefFor,
  activeBucket,
  totalHref,
}: {
  title: string;
  summary: AgingSummary;
  hrefFor: (bucket: AgingBucketKey) => string;
  activeBucket?: string | null;
  totalHref: string;
}) {
  const filled = summary.rows.filter((r) => r.amount > 0);
  return (
    <section aria-label={title} className="surface-card rounded-[var(--radius-panel)] p-4">
      <header className="flex flex-wrap items-baseline justify-between gap-2">
        <h3 className="font-display text-sm font-bold text-text">{title}</h3>
        <Link href={totalHref} className="numeric text-sm font-bold text-text hover:underline">
          {formatAccountMoney(summary.total, "TRY")}
          <span className="ml-1 text-xs font-normal text-text-muted">· {summary.count} kalem</span>
        </Link>
      </header>

      <div className="mt-3 flex h-3 w-full overflow-hidden rounded-full bg-surface-sunken" aria-hidden="true">
        {filled.map((r) => (
          <span key={r.bucket} className={cn("h-full transition-[width] duration-500", BUCKET_TONE[r.bucket].bar)} style={{ width: `${bucketShare(r.amount, summary.total)}%` }} />
        ))}
      </div>

      <ul className="mt-3 grid gap-1">
        {summary.rows.filter((r) => r.bucket !== "vadesiz" || r.cnt > 0).map((r) => {
          const active = activeBucket === r.bucket;
          return (
            <li key={r.bucket}>
              <Link
                href={hrefFor(r.bucket)}
                aria-current={active ? "true" : undefined}
                className={cn(
                  "focus-ring press flex min-h-9 touch:min-h-11 items-center gap-2 rounded-[var(--radius-control)] px-2 text-xs transition hover:bg-surface-hover",
                  active && "bg-surface-hover ring-1 ring-line-strong",
                )}
              >
                <span className={cn("h-2.5 w-2.5 shrink-0 rounded-full", BUCKET_TONE[r.bucket].dot)} aria-hidden="true" />
                <span className="min-w-0 flex-1 font-medium text-text">{AGING_LABEL[r.bucket]}</span>
                <span className="numeric text-text-muted">{r.cnt} kalem</span>
                <span className="numeric w-28 text-right font-semibold text-text">{formatAccountMoney(r.amount, "TRY")}</span>
              </Link>
            </li>
          );
        })}
      </ul>
    </section>
  );
}
