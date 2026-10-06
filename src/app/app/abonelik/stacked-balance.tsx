import Link from "next/link";
import type { CSSProperties } from "react";

export type StackedBalanceItem = {
  key: string;
  label: string;
  /** Biçimlenmiş değer metni (ör. "1.250" ya da "₺420"). */
  valueText: string;
  pct: number;
  href: string;
  color: string;
};

/**
 * Tek yığılmış bakiye göstergesi: oranlar `stackedBalance` (saf hesap) çıktısıdır. Çubuk dekoratiftir
 * (aria-hidden); bilgi ve bağlantı alttaki açıklama listesindedir (renge bağımlı değil).
 * Sabit yükseklik: yerleşim kayması yok. Kapsayıcı sorgusu: dar kartta açıklama alt alta dizilir.
 */
export function StackedBalance({ items, ariaLabel, note }: { items: StackedBalanceItem[]; ariaLabel: string; note?: string }) {
  const visible = items.filter((i) => i.pct > 0);
  return (
    <div className="@container" role="group" aria-label={ariaLabel}>
      <div className="viz-grow-x flex h-3 w-full overflow-hidden rounded-full bg-[var(--surface-sunken)]" aria-hidden="true" style={{ "--viz-delay": "0ms" } as CSSProperties}>
        {visible.map((i) => (
          <span key={i.key} className="block h-full" style={{ width: `${i.pct}%`, background: i.color }} />
        ))}
      </div>
      <ul className="mt-3 grid list-none gap-1 p-0 @md:grid-cols-3">
        {items.map((i) => (
          <li key={i.key}>
            <Link href={i.href} className="focus-ring flex min-h-9 items-center gap-2 rounded-[var(--radius-control)] px-2 text-sm hover:bg-surface-hover">
              <span className="h-2.5 w-2.5 shrink-0 rounded-full" style={{ background: i.color }} aria-hidden="true" />
              <span className="text-text-muted">{i.label}</span>
              <span className="ml-auto font-semibold tabular-nums text-text">{i.valueText}</span>
            </Link>
          </li>
        ))}
      </ul>
      {note ? <p className="mt-2 text-xs text-text-muted">{note}</p> : null}
    </div>
  );
}
