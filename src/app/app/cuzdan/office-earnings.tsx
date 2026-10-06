import Link from "next/link";
import { HandCoins, Info } from "lucide-react";
import { createClient } from "@/lib/supabase/server";
import { now, trParts } from "@/lib/clock";
import { PageHeader } from "@/components/ui/page-header";
import { StatRow } from "@/components/ui/stat-row";
import { Table, TableFrame, TBody, TD, TH, THead, TR } from "@/components/ui/table";
import { EmptyState } from "@/components/app/empty-state";
import { ListLimitNotice } from "@/components/app/list-limit-notice";
import { loadAdvisorMetrics, trYearPeriod, type MetricsViewer } from "@/lib/team/advisor-metrics";

function money(n: number) {
  return new Intl.NumberFormat("tr-TR", { style: "currency", currency: "TRY", maximumFractionDigits: 0 }).format(n);
}

const LINK = "focus-ring rounded-[var(--radius-control)] hover:text-accent-text hover:underline";

/**
 * Kazanç / "Ofis geneli" sekmesi (eski Ekip Merkezi / Kazanç sayfası). Yalnız `earnings_all` izni olan ve Ofis paketi
 * bulunan hesapta çağrılır (kapı `cuzdan/page.tsx`'te). Sayılar `loadAdvisorMetrics`'ten: danışman geliri = komisyon
 * payı (tahsil edilen), ofis geneli toplam ayrıca "Ofis komisyonu (brüt)".
 */
export async function OfficeEarnings({ viewer, tenantId }: { viewer: MetricsViewer; tenantId: string | null }) {
  const supabase = await createClient();
  const nowMs = now();
  const year = trParts(nowMs).year;
  const metrics = await loadAdvisorMetrics(supabase, {
    viewer,
    tenantId,
    period: trYearPeriod(year),
    nowMs,
  });

  const table = metrics.rows
    .map((m) => ({ m, pending: m.pendingRevenue ?? 0, collected: m.revenue ?? 0, count: m.commissionCount ?? 0 }))
    .sort((a, b) => b.collected + b.pending - (a.collected + a.pending) || a.m.fullName.localeCompare(b.m.fullName, "tr"));
  const anyEarning = table.some((r) => r.count > 0);
  const gross = metrics.office.commissionGrossCollected ?? 0;
  const grossPending = metrics.office.commissionGrossPending ?? 0;

  return (
    <div className="space-y-5">
      <PageHeader
        eyebrow="Kazanç · Ofis geneli"
        title="Ofis kazancı"
        description={`${year} yılı danışman kazançları: tahsil edilmiş ve bekleyen komisyon payları.`}
      />

      {metrics.failed ? (
        <EmptyState
          icon={Info}
          tone="danger"
          illustration="error"
          title="Kazanç verisi yüklenemedi"
          description="Komisyon kayıtları şu an okunamadı. Sayfayı yenileyin."
        />
      ) : (
        <>
          <StatRow
            label="Ofis özeti"
            items={[
              { label: "Ofis komisyonu (brüt)", value: money(gross), href: "/app/komisyon?durum=tahsil", hint: `${year} yılı · tahsil edilen` },
              { label: "Bekleyen komisyon (brüt)", value: money(grossPending), href: "/app/komisyon?durum=bekleyen", hint: "tahsil edilmemiş" },
              {
                label: "Danışman gelirleri (pay)",
                value: money(metrics.totals.revenue ?? 0),
                href: "/app/danisman-kpi",
                hint: "danışmanlara düşen tahsil edilmiş paylar",
              },
            ]}
          />

          <ListLimitNotice shown={metrics.rows.length} total={metrics.profileTotal} hint="Şubeye göre daraltmak için Ekip sayfasını kullanın." />
          {metrics.partial ? (
            <p className="rounded-[var(--radius-card)] border border-line bg-canvas px-4 py-3 text-xs text-text-muted">
              Kayıt hacmi okuma sınırına dayandı; toplamlar eksik olabilir. Tarih aralığını Komisyon sayfasında daraltın.
            </p>
          ) : null}

          {table.length === 0 || !anyEarning ? (
            <EmptyState
              icon={HandCoins}
              illustration="list"
              title={`${year} yılında paylaşılmış komisyon yok`}
              description="Anlaşmalar komisyona dönüşüp paylaşım tanımlandığında danışman payları burada toplanır."
              action={{ href: "/app/komisyon", label: "Komisyon defteri" }}
            />
          ) : (
            <TableFrame minWidth={640}>
              <Table>
                <THead>
                  <TR>
                    <TH>Danışman</TH>
                    <TH align="right">Paylı kayıt</TH>
                    <TH align="right">Bekleyen pay</TH>
                    <TH align="right">Tahsil edilen pay</TH>
                    <TH align="right">Toplam</TH>
                  </TR>
                </THead>
                <TBody>
                  {table.map(({ m, pending, collected, count }) => (
                    <TR key={m.id}>
                      <TD>
                        <Link href={`/app/ekip/${m.id}?sekme=kazanc`} className={`${LINK} font-semibold text-text`}>
                          {m.fullName}
                        </Link>
                      </TD>
                      <TD align="right">
                        <Link href="/app/komisyon" className={LINK}>{count}</Link>
                      </TD>
                      <TD align="right">
                        <Link href="/app/komisyon?durum=bekleyen" className={LINK}>{pending > 0 ? money(pending) : "—"}</Link>
                      </TD>
                      <TD align="right">
                        <Link href="/app/komisyon?durum=tahsil" className={LINK}>{collected > 0 ? money(collected) : "—"}</Link>
                      </TD>
                      <TD align="right" className="font-bold text-success-strong">
                        {pending + collected > 0 ? money(pending + collected) : "—"}
                      </TD>
                    </TR>
                  ))}
                </TBody>
              </Table>
            </TableFrame>
          )}
          <p className="text-xs text-text-faint">
            Pay, komisyon paylaşım satırındaki ad etiketine (ya da anlaşmaya atanmış danışmanın &quot;Danışman&quot; payına) göre
            hesaplanır. &quot;Tahsil edilen&quot; müşteriden tahsilattır; danışmana ödeme (hakediş) durumu henüz ayrı tutulmuyor.
            Danışman payları toplamı Ofis komisyonundan (brüt) küçüktür: ofis payı ve dış paylar dahil değildir.
          </p>
        </>
      )}
    </div>
  );
}
