import Link from "next/link";
import { StatRow, type StatRowItem } from "@/components/ui/stat-row";
import { planLabel } from "@/lib/billing/plans";
import type { SeatAnalytics, SeatSubscriberRow } from "@/lib/billing/seat-analytics";

const tl = (n: number) => `${Math.round(n).toLocaleString("tr-TR")} ₺`;
const pct = (r: number | null) => (r === null ? "-" : `%${Math.round(r * 100)}`);

const BASE = "/admin/billing/planlar?sekme=analitik";

export type SeatListKey = "uyari" | "dolu" | "genisleme";

const LIST_TITLES: Record<SeatListKey, string> = {
  uyari: "Doluluk uyarı eşiğini aşan ofisler",
  dolu: "Koltuğu dolu ofisler (yükseltme/ek kullanıcı adayı)",
  genisleme: "Ek kullanıcı satın almış ofisler",
};

/** Gelir büyüme analitiği: kartların hepsi tıklanabilir (filtrelenmiş ofis listesi ya da ofis filtresi). */
export function SeatAnalyticsPanel({
  data,
  warnPercent,
  list,
  expansionRows,
}: {
  data: SeatAnalytics;
  warnPercent: number;
  list: SeatListKey | null;
  expansionRows: SeatSubscriberRow[];
}) {
  const items: StatRowItem[] = [
    { label: "Aktif abone", value: data.activeSubscribers, href: "/admin/tenants?durum=active" },
    { label: "MRR", value: tl(data.mrrTry), href: `${BASE}#plan-dagilimi`, hint: "aylık eşdeğer" },
    { label: "ARPA", value: tl(data.arpaTry), href: `${BASE}#plan-dagilimi`, hint: "abone başı" },
    data.extraSeatsEnabled
      ? { label: "Genişleme MRR", value: tl(data.expansionMrrTry), href: `${BASE}&liste=genisleme#liste`, hint: `${data.extraSeatsTotal} ek kullanıcı` }
      : { label: "Genişleme MRR", value: "etkin değil", href: `${BASE}#sema-durumu` },
    { label: `Doluluk %${warnPercent}+`, value: data.utilization.warn, href: `${BASE}&liste=uyari#liste`, attention: true },
    { label: "Koltuğu dolu", value: data.utilization.full, href: `${BASE}&liste=dolu#liste`, attention: true },
  ];
  const rows: SeatSubscriberRow[] = list === "uyari" ? data.warnTenants : list === "dolu" ? data.fullTenants : list === "genisleme" ? expansionRows : [];

  return (
    <div className="space-y-5">
      <StatRow items={items} label="Gelir büyüme göstergeleri" />

      {!data.extraSeatsEnabled ? (
        <p id="sema-durumu" role="note" className="rounded-[var(--radius-card)] border border-line bg-surface p-3 text-sm text-text-muted">
          Ek kullanıcı ölçümü etkin değil: <code className="font-mono">subscriptions.extra_seats</code> sütunu henüz yok (taslak migration uygulanmadı). Genişleme MRR ve ek koltuk doluluğu bu yüzden ölçülmüyor; doluluk yalnız pakete dahil kullanıcıya göre hesaplanır.
        </p>
      ) : null}

      {list ? (
        <section id="liste" aria-label={LIST_TITLES[list]} className="rounded-[var(--radius-panel)] border border-line bg-surface">
          <header className="flex items-center justify-between gap-3 border-b border-line px-4 py-3">
            <h2 className="font-display text-sm font-bold text-ink-950">
              {LIST_TITLES[list]} <span className="text-text-muted">({rows.length})</span>
            </h2>
            <Link href={BASE} className="focus-ring text-xs font-semibold text-text-muted hover:text-ink-950">Listeyi kapat</Link>
          </header>
          {rows.length === 0 ? (
            <p className="px-4 py-6 text-sm text-text-muted">Bu ölçüte uyan ofis yok.</p>
          ) : (
            <ul className="divide-y divide-line">
              {rows.map((r) => (
                <li key={r.tenantId}>
                  <Link href={`/admin/tenants/${r.tenantId}`} className="focus-ring flex flex-wrap items-center justify-between gap-2 px-4 py-2.5 text-sm hover:bg-canvas">
                    <span className="font-semibold text-ink-950">{r.tenantName}</span>
                    <span className="text-xs text-text-muted">
                      {planLabel(r.plan)} · {r.usedSeats ?? "?"} aktif kullanıcı{r.extraSeats ? ` · +${r.extraSeats} ek` : ""}
                    </span>
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </section>
      ) : null}

      <section id="plan-dagilimi" aria-label="Plan bazında ofis dağılımı" className="rounded-[var(--radius-panel)] border border-line bg-surface">
        <h2 className="border-b border-line px-4 py-3 font-display text-sm font-bold text-ink-950">Plan bazında dağılım</h2>
        {data.planDistribution.length === 0 ? (
          <p className="px-4 py-6 text-sm text-text-muted">Henüz aktif abonelik yok.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-sm">
              <thead className="text-xs text-text-faint">
                <tr>
                  <th className="px-4 py-2 font-semibold">Plan</th>
                  <th className="px-4 py-2 font-semibold">Ofis</th>
                  <th className="px-4 py-2 font-semibold">MRR</th>
                  <th className="px-4 py-2 font-semibold">Ek kullanıcı</th>
                  <th className="px-4 py-2 font-semibold">Ort. doluluk</th>
                </tr>
              </thead>
              <tbody>
                {data.planDistribution.map((p) => (
                  <tr key={p.plan} className="border-t border-line text-ink-950">
                    <td className="px-4 py-2 font-semibold">{planLabel(p.plan)}</td>
                    <td className="px-4 py-2 tabular-nums">
                      <Link href={`/admin/tenants?plan=${p.plan}`} className="focus-ring underline decoration-line underline-offset-2 hover:text-brand-600">
                        {p.offices}
                      </Link>
                    </td>
                    <td className="px-4 py-2 tabular-nums">{tl(p.mrrTry)}</td>
                    <td className="px-4 py-2 tabular-nums">{data.extraSeatsEnabled ? p.extraSeats : "-"}</td>
                    <td className="px-4 py-2 tabular-nums">{pct(p.avgUtilization)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
      <p className="text-xs text-text-muted">
        MRR kayıtlı abonelik tutarlarından (yıllık/12) hesaplanır. Genişleme MRR, kayıtlı ek kullanıcı sayısının güncel liste kademeleriyle değeridir; tahmin içermez.
        Doluluk = aktif kullanıcı / (dahil + ek).
      </p>
    </div>
  );
}
