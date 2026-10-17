import type { ReactNode } from "react";
import type { LucideIcon } from "lucide-react";
import Link from "@/components/ui/smart-link";
import { KpiCard, Spark, type Tone } from "@/app/app/_home/kurumsal/views";

/**
 * /admin operasyon ekranlarının ortak v4 parçaları (Kontrol paneliyle AYNI dil: `_home/kurumsal` KpiCard + `kh-card`;
 * sayfa `home.css`'i içe aktarır). Yalnız sunucu bileşenleri; istemci kodu eklemez.
 *  - `OpsKpis`: 2-5 KPI kartı (mobilde yatay kaydırma, masaüstünde eşit sütun; kartlar eşit yükseklikte).
 *  - `OpsCard`: başlık şeritli kart (ikon + başlık + alt satır + sağ eylem). Başlık tek satır, sığmazsa "…" + title.
 *  - `OpsList` / `OpsRow`: tek sol kenarlı satır listesi; birincil metin tek satır kesilir, ikincil 2 satır sıkıştırılır.
 */

export type OpsKpi = {
  key: string;
  title: string;
  value: string;
  href: string;
  icon: LucideIcon;
  tone: Tone;
  caption?: string;
  series?: readonly number[];
  seriesLabel?: string;
};

export function OpsKpis({ items, label }: { items: readonly OpsKpi[]; label: string }) {
  if (items.length === 0) return null;
  return (
    <div className="kh-kpis" data-count={items.length} role="list" aria-label={label}>
      {items.map((k) => (
        <div key={k.key} className="kh-kpi-cell" role="listitem">
          <KpiCard
            title={k.title}
            value={k.value}
            href={k.href}
            icon={k.icon}
            tone={k.tone}
            caption={k.caption}
            spark={k.series && k.series.length > 1 ? <Spark values={k.series} tone={k.tone} kind="bars" label={k.seriesLabel ?? k.title} /> : undefined}
          />
        </div>
      ))}
    </div>
  );
}

export function OpsCard({
  id,
  icon: Icon,
  tone = "brand",
  title,
  sub,
  right,
  children,
  className = "",
}: {
  id?: string;
  icon: LucideIcon;
  tone?: Tone;
  title: string;
  sub?: string;
  right?: ReactNode;
  children: ReactNode;
  className?: string;
}) {
  const headId = id ? `${id}-baslik` : undefined;
  return (
    <section id={id} className={`kh-card scroll-mt-24 ${className}`} aria-labelledby={headId} aria-label={headId ? undefined : title}>
      <div className="kh-card-head">
        <span className={`kh-ico t-${tone}`} aria-hidden="true">
          <Icon className="h-[18px] w-[18px]" />
        </span>
        <div className="min-w-0 flex-1">
          <h2 id={headId} className="kh-card-title truncate" title={title}>
            {title}
          </h2>
          {sub ? (
            <p className="kh-card-sub kh-clamp2" title={sub}>
              {sub}
            </p>
          ) : null}
        </div>
        {right ? <div className="flex shrink-0 flex-wrap items-center gap-2">{right}</div> : null}
      </div>
      {children}
    </section>
  );
}

export function OpsList({ children, label }: { children: ReactNode; label: string }) {
  return (
    <ul className="divide-y divide-line" aria-label={label}>
      {children}
    </ul>
  );
}

/**
 * Satır: solda (isteğe bağlı) ikon, ortada birincil + ikincil metin, sağda değer/eylem. Birincil metin bağlantıysa
 * `href` verilir. Dar ekranda sağ bölüm alta iner (tek sol kenar korunur).
 */
export function OpsRow({
  primary,
  secondary,
  href,
  right,
  lead,
}: {
  primary: string;
  secondary?: ReactNode;
  href?: string;
  right?: ReactNode;
  lead?: ReactNode;
}) {
  const main = (
    <>
      <span className="block truncate text-sm font-semibold text-[var(--heading)]" title={primary}>
        {primary}
      </span>
      {secondary ? <span className="kh-clamp2 block text-xs text-text-muted">{secondary}</span> : null}
    </>
  );
  return (
    <li className="grid grid-cols-[minmax(0,1fr)] items-center gap-x-3 gap-y-2 py-3 sm:grid-cols-[minmax(0,1fr)_auto]">
      <div className="flex min-w-0 items-center gap-3">
        {lead ? <span className="shrink-0">{lead}</span> : null}
        {href ? (
          <Link href={href} className="focus-ring min-w-0 flex-1 rounded-[var(--radius-control)] hover:underline">
            {main}
          </Link>
        ) : (
          <div className="min-w-0 flex-1">{main}</div>
        )}
      </div>
      {right ? <div className="flex min-w-0 flex-wrap items-center gap-2 sm:justify-end">{right}</div> : null}
    </li>
  );
}

/** İki sütunlu kart ızgarası (lg+): kartlar eşit yükseklikte biter; dar ekranda tek sütun. */
export function OpsGrid({ children }: { children: ReactNode }) {
  return <div className="grid grid-cols-1 items-stretch gap-4 lg:grid-cols-2">{children}</div>;
}

/** "%12,5" (TR ondalık) ya da "—". */
export function pct(n: number | null | undefined): string {
  return n === null || n === undefined ? "—" : `%${n.toLocaleString("tr-TR", { maximumFractionDigits: 1 })}`;
}

/** Tam sayı TR binlik ("12.480") ya da "—". */
export function num(n: number | null | undefined): string {
  return n === null || n === undefined ? "—" : n.toLocaleString("tr-TR");
}
