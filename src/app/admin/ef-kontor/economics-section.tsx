import Link from "next/link";
import { AlertTriangle } from "lucide-react";
import type { createAdminClient } from "@/lib/supabase/admin";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { StatRow } from "@/components/ui/stat-row";
import { Table, TableFrame, TBody, TD, TH, THead, TR } from "@/components/ui/table";
import { InlineOp, opFieldClass } from "@/app/admin/billing/inline-op";
import { saveEfWholesale } from "@/app/actions/accounting";
import { VIZ_SERIES } from "@/components/ui/viz";
import { grantSegments, marginFlow, officeUsageBars } from "./viz-model";
import { formatKurus, formatKurusShort } from "@/lib/accounting/format";
import { periodSearchParams, type Period } from "@/lib/accounting/period";
import {
  EF_ITEM_LABELS,
  buildEfEconomicsView,
  isWholesaleUnknown,
  type EfEconomicsView,
  type EfWholesale,
} from "@/lib/accounting/ef-economics";
import { loadEfLedgerEntries, loadEfPackSales, loadEfUsage } from "@/lib/accounting/loaders";

const fmt = new Intl.NumberFormat("tr-TR", { maximumFractionDigits: 0 });
const BASE = "/admin/ef-kontor";
export const OFFICE_ROWS_SHOWN = 15;

export type EfEconomicsData = {
  view: EfEconomicsView;
  names: Record<string, string>;
  usageTruncated: boolean;
  ledgerTruncated: boolean;
  salesTruncated: boolean;
  usageEnabled: boolean;
};

/** Salt okunur veri toplama; `admin` ödünç alınan (allowlist'li) istemcidir, burada yeni service_role üretilmez. */
export async function loadEfEconomicsData(
  admin: ReturnType<typeof createAdminClient>,
  period: Period,
  wholesale: EfWholesale,
): Promise<EfEconomicsData> {
  const [usage, ledger, sales] = await Promise.all([loadEfUsage(admin, period), loadEfLedgerEntries(admin), loadEfPackSales(admin)]);
  const view = buildEfEconomicsView({ usage: usage.rows, ledger: ledger.entries, sales: sales.sales, wholesale, period });
  const ids = view.offices.slice(0, OFFICE_ROWS_SHOWN).map((o) => o.tenantId);
  const names: Record<string, string> = {};
  if (ids.length > 0) {
    const { data } = await admin.from("tenants").select("id, name").in("id", ids);
    for (const t of (data ?? []) as { id: string; name: string | null }[]) names[t.id] = t.name ?? "";
  }
  return {
    view,
    names,
    usageEnabled: usage.enabled,
    usageTruncated: usage.truncated,
    ledgerTruncated: ledger.truncated,
    salesTruncated: sales.truncated,
  };
}

const PERIODS: { id: string; label: string }[] = [
  { id: "bu-ay", label: "Bu ay" },
  { id: "gecen-ay", label: "Geçen ay" },
  { id: "tumu", label: "Tüm zamanlar" },
];

export function EconomicsSection({
  data,
  period,
  wholesale,
  canWrite,
}: {
  data: EfEconomicsData | null;
  period: Period;
  wholesale: EfWholesale;
  canWrite: boolean;
}) {
  const donem = period.preset === "ozel" ? "bu-ay" : period.preset;
  const ledgerHref = `/admin/muhasebe/defter?${new URLSearchParams({ ...periodSearchParams(period), durum: "paid", tur: "credit_pack" }).toString()}`;
  const muhasebeHref = `/admin/muhasebe?${new URLSearchParams(periodSearchParams(period)).toString()}`;

  return (
    <Card id="ekonomi">
      <CardHeader>
        <CardTitle>Kontör ekonomisi</CardTitle>
        <CardDescription>
          Kullanım, gelir, toptan maliyet ve marj; ofis bazlı bakiye ve kullanılmamış kontör yükümlülüğü. Dönem: <strong>{period.label}</strong>.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-5">
        <nav aria-label="Dönem" className="flex flex-wrap gap-1">
          {PERIODS.map((p) => (
            <Link
              key={p.id}
              href={`${BASE}?donem=${p.id}#ekonomi`}
              aria-current={donem === p.id ? "page" : undefined}
              className={`focus-ring min-h-9 rounded-[var(--radius-control)] px-3 py-1.5 text-sm font-semibold ${
                donem === p.id ? "bg-ink-950 text-white" : "border border-line text-text-muted hover:text-ink-950"
              }`}
            >
              {p.label}
            </Link>
          ))}
        </nav>

        {!data ? (
          <p className="rounded-[var(--radius-card)] border border-dashed border-line-strong px-4 py-6 text-center text-sm text-text-muted">
            Ekonomi verisi okunamadı ya da cüzdan etkin değil.
          </p>
        ) : (
          <Body data={data} ledgerHref={ledgerHref} muhasebeHref={muhasebeHref} />
        )}

        <div className="border-t border-line pt-3">
          <p className="text-xs font-semibold text-ink-950">EmlakFiyatı toptan maliyet (işlem başı, KDV hariç)</p>
          {isWholesaleUnknown(wholesale) ? (
            <p role="alert" className="mt-1 flex items-start gap-1.5 text-xs font-semibold text-warn-600">
              <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden />
              EF toptan maliyeti bilinmiyor, varsayılan 0 kullanılıyor: maliyet 0 ve marj gelire eşit görünür; gerçek bir marj değildir.
            </p>
          ) : null}
          <p className="mt-0.5 text-xs text-text-muted">
            Geçerli: değerleme {formatKurus(Math.round(wholesale.valuationTl * 100))} · ilk PDF {formatKurus(Math.round(wholesale.pdfTl * 100))}.
            Kayıt ayarı: <code>ef.wholesale</code>. Rapor detayının toptan maliyeti yoktur.
          </p>
          {canWrite ? (
            <div className="mt-2">
              <InlineOp
                label="Maliyeti düzenle"
                confirmLabel="Kaydet"
                hidden={{}}
                action={saveEfWholesale}
                hint="Denetim kaydına yazılır; geçmiş dönemler de bu tarifeyle yeniden hesaplanır."
              >
                <label className="text-xs font-semibold text-text-muted">
                  Değerleme (TL)
                  <input name="valuation_tl" defaultValue={String(wholesale.valuationTl).replace(".", ",")} inputMode="decimal" className={`mt-1 block w-28 ${opFieldClass}`} />
                </label>
                <label className="text-xs font-semibold text-text-muted">
                  İlk PDF (TL)
                  <input name="pdf_tl" defaultValue={String(wholesale.pdfTl).replace(".", ",")} inputMode="decimal" className={`mt-1 block w-28 ${opFieldClass}`} />
                </label>
              </InlineOp>
            </div>
          ) : (
            <p className="mt-2 text-xs text-text-faint">Düzenleme yalnız süper admin içindir.</p>
          )}
        </div>
      </CardContent>
    </Card>
  );
}

function Body({ data, ledgerHref, muhasebeHref }: { data: EfEconomicsData; ledgerHref: string; muhasebeHref: string }) {
  const { view } = data;
  const { econ, liability } = view;
  const shown = view.offices.slice(0, OFFICE_ROWS_SHOWN);
  const bars = officeUsageBars(view.offices, data.names, OFFICE_ROWS_SHOWN);
  const flow = marginFlow(econ, view.wholesaleUnknown);
  const segments = grantSegments(view.grants);
  const grantCounts = Object.fromEntries(view.grants.map((g) => [g.kind, g.count]));
  return (
    <>
      {data.usageTruncated || data.ledgerTruncated || data.salesTruncated ? (
        <p role="alert" className="text-xs font-semibold text-warn-600">Kayıt sınırı aşıldı; bazı sayılar eksik olabilir. Dönemi daraltın.</p>
      ) : null}
      {!data.usageEnabled ? (
        <p className="text-xs text-text-muted">Kullanım kayıtları (ef_credit_reservations) okunamadı; kullanım sıfır görünür.</p>
      ) : null}

      <StatRow
        label="Kontör ekonomisi özeti"
        items={[
          { label: "Harcanan kontör", value: fmt.format(econ.units), href: "#ekonomi-kalem", hint: `${fmt.format(econ.transactions)} işlem` },
          { label: "Net gelir (paket)", value: formatKurusShort(econ.revenueNetKurus), href: ledgerHref, hint: `${view.packCount} paket faturası` },
          { label: "Toptan maliyet", value: formatKurusShort(econ.costKurus), href: "#ekonomi-maliyet", hint: view.wholesaleUnknown ? "bilinmiyor (0)" : undefined },
          { label: "Brüt marj", value: formatKurusShort(econ.marginKurus), href: muhasebeHref, hint: view.wholesaleUnknown ? "maliyet bilinmeden gerçek değil" : undefined },
        ]}
      />

      {flow ? (
        <div id="ekonomi-marj" className="@container">
          <h3 className="mb-2 text-sm font-bold text-ink-950">Gelir, maliyet ve marj</h3>
          <div className="grid h-40 grid-cols-3 items-end gap-6" role="img" aria-label="Net gelir, toptan maliyet ve brüt marj çubukları">
            {flow.map((b) => (
              <Link key={b.key} href={b.key === "revenue" ? ledgerHref : muhasebeHref} className="flex h-full flex-col justify-end gap-1 text-center hover:opacity-90">
                <span className="text-sm font-bold tabular-nums text-[color:var(--viz-gold)]">{formatKurusShort(b.kurus)}</span>
                <span
                  className="block w-full rounded-t-[var(--radius-control)]"
                  style={{
                    height: `${Math.max(2, b.pct) * 0.8}%`,
                    background: b.key === "cost" ? "var(--viz-neg)" : b.key === "margin" ? (b.kurus < 0 ? "var(--viz-neg)" : "var(--viz-pos)") : "var(--viz-gold)",
                  }}
                />
              </Link>
            ))}
          </div>
          <div className="mt-1 grid grid-cols-3 gap-6 text-center text-xs text-text-muted">
            {flow.map((b) => (
              <span key={b.key}>{b.label}</span>
            ))}
          </div>
        </div>
      ) : view.wholesaleUnknown ? (
        <p className="text-xs text-text-muted">Marj grafiği çizilmedi: toptan maliyet bilinmiyor (aşağıdaki uyarıya bakın).</p>
      ) : null}

      <div id="ekonomi-kalem">
        <TableFrame minWidth={520}>
          <Table>
            <THead>
              <TR>
                <TH>Kalem</TH>
                <TH align="right">İşlem</TH>
                <TH align="right">Kontör</TH>
                <TH align="right">Maliyet</TH>
              </TR>
            </THead>
            <TBody>
              {econ.byItem.map((r) => (
                <TR key={r.item}>
                  <TD className="font-semibold text-ink-950">
                    <Link href={muhasebeHref} className="hover:text-brand-600 hover:underline">{EF_ITEM_LABELS[r.item]}</Link>
                  </TD>
                  <TD align="right" className="numeric">{fmt.format(r.transactions)}</TD>
                  <TD align="right" className="numeric">{fmt.format(r.units)}</TD>
                  <TD align="right" className="numeric text-text-muted">{formatKurus(r.costKurus)}</TD>
                </TR>
              ))}
            </TBody>
          </Table>
        </TableFrame>
        {econ.unknownItems > 0 ? <p className="mt-1 text-xs text-warn-600">{econ.unknownItems} kayıt bilinmeyen kalemde olduğu için sayılmadı.</p> : null}
      </div>
      <p id="ekonomi-maliyet" className="text-xs text-text-muted">
        Maliyet = işlem sayısı × toptan tarife (kontör sayısı değil). Harcanan kontör başına ortalama net gelir:{" "}
        <strong>{econ.revenuePerSpentUnitKurus === null ? "—" : formatKurus(econ.revenuePerSpentUnitKurus)}</strong>.
      </p>

      <div id="ekonomi-yukumluluk" className="@container py-1">
        <p className="text-xs font-semibold uppercase tracking-[0.04em] text-text-faint">Kullanılmamış kontör yükümlülüğü (üst sınır)</p>
        <p className="mt-1 text-3xl font-bold tabular-nums text-[color:var(--viz-gold)]">
          {liability.liabilityKurus === null ? "—" : formatKurus(liability.liabilityKurus)}
        </p>
        <p className="mt-1 text-xs text-text-muted">
          <Link href="#bakiyeler" className="font-semibold text-brand-600 hover:underline">{fmt.format(liability.unusedUnits)} kullanılmamış kontör</Link>
          {" × "}
          {liability.avgUnitPriceKurus === null ? "ortalama net fiyat yok (henüz paket satışı yok)" : `${formatKurus(liability.avgUnitPriceKurus)} ağırlıklı ortalama net kontör fiyatı`}.
          Üst sınırdır: ücretsiz verilen (hoş geldin, plan hakkı) kontör de bu fiyatla çarpılır; güncel durumdur, dönemden bağımsızdır.
        </p>
      </div>

      <div>
        <h3 className="mb-2 text-sm font-bold text-ink-950">Plan hakkı ve yükleme dağılımı (dönemdeki yüklemeler)</h3>
        {segments.length === 0 ? (
          <p className="text-sm text-text-muted">Bu dönemde kontör yüklemesi yok.</p>
        ) : (
          <>
            <div role="img" aria-label="Yükleme dağılımı (kontör payı)" className="flex h-3 w-full overflow-hidden rounded-full bg-[var(--surface-sunken)]">
              {segments.map((g, i) => (
                <Link
                  key={g.kind}
                  href="#bakiyeler"
                  title={`${g.label}: ${fmt.format(g.units)} kontör (%${g.pct})`}
                  className="block h-full"
                  style={{ width: `${g.pct}%`, background: VIZ_SERIES[i % VIZ_SERIES.length] }}
                />
              ))}
            </div>
            <ul className="mt-2 divide-y divide-line text-sm">
              {segments.map((g, i) => (
                <li key={g.kind}>
                  <Link href="#bakiyeler" className="flex h-10 items-center gap-3 hover:bg-surface-hover">
                    <span aria-hidden="true" className="h-2.5 w-2.5 shrink-0 rounded-full" style={{ background: VIZ_SERIES[i % VIZ_SERIES.length] }} />
                    <span className="min-w-0 flex-1 truncate font-semibold text-ink-950">{g.label}</span>
                    <span className="tabular-nums text-text-muted">{fmt.format(grantCounts[g.kind] ?? 0)} yükleme</span>
                    <span className="w-24 text-right font-bold tabular-nums text-ink-950">{fmt.format(g.units)} kontör</span>
                  </Link>
                </li>
              ))}
            </ul>
          </>
        )}
      </div>

      <div>
        <h3 className="mb-2 text-sm font-bold text-ink-950">Ofis bazlı kullanım (en çok harcayan {OFFICE_ROWS_SHOWN})</h3>
        {bars.length === 0 ? (
          <p className="text-sm text-text-muted">Kontör hareketi olan ofis yok.</p>
        ) : (
          <ol className="m-0 list-none divide-y divide-line p-0">
            {bars.map((o) => {
              const row = shown.find((x) => x.tenantId === o.tenantId);
              return (
                <li key={o.tenantId}>
                  <Link href={`${BASE}?ofis=${o.tenantId}#ofis`} className="grid h-10 grid-cols-[minmax(6rem,12rem)_1fr_auto] items-center gap-3 hover:bg-surface-hover">
                    <span className="truncate text-sm font-semibold text-ink-950" title={o.label}>{o.label}</span>
                    <span aria-hidden="true" className="relative block h-2.5 overflow-hidden rounded-full bg-[var(--surface-sunken)]">
                      <span className="viz-grow-x absolute inset-y-0 left-0 block rounded-full" style={{ width: `${o.pct}%`, background: "var(--viz-1)" }} />
                    </span>
                    <span className="text-right text-sm tabular-nums">
                      <strong className="text-ink-950">{fmt.format(o.value)}</strong>
                      <span className="text-text-faint"> kontör{row ? ` · bakiye ${fmt.format(row.balance)}` : ""}</span>
                    </span>
                  </Link>
                </li>
              );
            })}
          </ol>
        )}
        <p className="mt-1 text-xs text-text-faint">
          {view.offices.length} ofiste hareket var; tamamı için aşağıdaki Ofis bakiyeleri listesi. Defter bakiyesi açık rezervleri düşmez.
          {view.untaggedUsage > 0 ? ` ${view.untaggedUsage} kullanım kaydında ofis bilgisi yok.` : ""}
        </p>
      </div>
    </>
  );
}
