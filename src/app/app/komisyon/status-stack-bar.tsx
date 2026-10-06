import Link from "next/link";
import { statusShares, visibleWidths } from "./commission-math";

const fmt = new Intl.NumberFormat("tr-TR", { maximumFractionDigits: 0 });
const money = (n: number) => `${fmt.format(n)} ₺`;

/**
 * StatusStackBar — tahsil / bekleyen durum yığılmış çubuğu. Para = altın (toplam tutar vurgusu),
 * durum tonları: tahsil = başarı, bekleyen = uyarı. Renk tek başına anlam taşımaz: legend'da
 * etiket + tutar + yüzde yazar; çubuk `role=img` + özet metin. Her dilim ve legend satırı
 * filtrelenmiş deftere gider (sıfır çıkmaz metrik). Hareket yok (durağan CSS).
 */
export function StatusStackBar({
  paid,
  pending,
  paidHref,
  pendingHref,
  title,
  className,
}: {
  paid: number;
  pending: number;
  paidHref: string;
  pendingHref: string;
  title: string;
  className?: string;
}) {
  const s = statusShares(paid, pending);
  if (s.total === 0) return null;
  const [wPaid, wPending] = visibleWidths([s.paid, s.pending]);
  const summary = `${title}: tahsil ${money(s.paid)} (%${s.paidPct}), bekleyen ${money(s.pending)} (%${s.pendingPct})`;
  const items = [
    { key: "tahsil", label: "Tahsil edilen", amount: s.paid, pct: s.paidPct, href: paidHref, color: "var(--viz-pos)", w: wPaid },
    { key: "bekleyen", label: "Bekleyen", amount: s.pending, pct: s.pendingPct, href: pendingHref, color: "var(--viz-5)", w: wPending },
  ];
  return (
    <div className={className}>
      <div className="flex items-baseline justify-between gap-3">
        <h3 className="text-xs font-semibold text-text-muted">{title}</h3>
        <p className="font-display text-lg font-extrabold tabular-nums" style={{ color: "var(--pm-gold-text)" }}>
          {money(s.total)}
        </p>
      </div>
      <div role="img" aria-label={summary} className="mt-2 flex h-3 w-full overflow-hidden rounded-full bg-line">
        {items.map((it) =>
          it.w > 0 ? (
            <Link
              key={it.key}
              href={it.href}
              title={`${it.label}: ${money(it.amount)}`}
              tabIndex={-1}
              aria-hidden="true"
              className="h-full transition-[filter] hover:brightness-110"
              style={{ width: `${it.w}%`, background: it.color }}
            />
          ) : null,
        )}
      </div>
      <ul className="mt-2 grid gap-x-6 sm:grid-cols-2">
        {items.map((it) => (
          <li key={it.key}>
            <Link
              href={it.href}
              className="focus-ring flex min-h-9 items-center gap-2 rounded-[var(--radius-control)] px-1 text-sm transition hover:bg-surface-hover"
            >
              <span aria-hidden="true" className="h-2.5 w-2.5 shrink-0 rounded-[3px]" style={{ background: it.color }} />
              <span className="text-text-muted">{it.label}</span>
              <span className="ml-auto font-semibold tabular-nums text-text">{money(it.amount)}</span>
              <span className="w-12 text-right text-xs tabular-nums text-text-faint">%{it.pct}</span>
            </Link>
          </li>
        ))}
      </ul>
      <p className="mt-1 px-1 text-xs text-text-faint">
        Geciken ayrımı yok: komisyon kaydında vade tarihi tutulmuyor.
      </p>
    </div>
  );
}
