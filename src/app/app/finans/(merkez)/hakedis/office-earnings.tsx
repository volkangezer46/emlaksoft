import Link from "@/components/ui/smart-link";
import { financeHref, financePath } from "@/lib/finance/routes";
import { HandCoins, Info } from "lucide-react";
import { createClient } from "@/lib/supabase/server";
import { now, trParts } from "@/lib/clock";
import { PageHeader } from "@/components/ui/page-header";
import { StatRow } from "@/components/ui/stat-row";
import { Table, TableFrame, TBody, TD, TH, THead, TR } from "@/components/ui/table";
import { EmptyState } from "@/components/ui/empty-state";
import { ListLimitNotice } from "@/components/app/list-limit-notice";
import { readAllPaged } from "@/lib/supabase/read-all-paged";
import { loadAdvisorMetrics, trYearPeriod, type MetricsViewer } from "@/lib/team/advisor-metrics";

function money(n: number) {
  return new Intl.NumberFormat("tr-TR", { style: "currency", currency: "TRY", maximumFractionDigits: 0 }).format(n);
}

const LINK = "focus-ring rounded-[var(--radius-control)] hover:text-accent-text hover:underline";

/**
 * Finans > Hakediş: danışman bazlı ofis geneli hakediş. Yalnız `earnings_all` izni olan ve Ofis paketi bulunan hesapta
 * çağrılır (kapı `hakedis/page.tsx`'te). Sayılar `loadAdvisorMetrics`'ten: danışman geliri = komisyon
 * payı (tahsil edilen), ofis geneli toplam ayrıca "Ofis komisyonu (brüt)".
 */
export async function OfficeEarnings({ viewer, tenantId }: { viewer: MetricsViewer; tenantId: string | null }) {
  const supabase = await createClient();
  const nowMs = now();
  const year = trParts(nowMs).year;
  const period = trYearPeriod(year);
  const [metrics, payoutRes] = await Promise.all([
    loadAdvisorMetrics(supabase, {
      viewer,
      tenantId,
      period,
      nowMs,
      // B106: kapsam izinden (earnings_all) gelir; muhasebe rolünde de tüm danışman payları görünür. Etkinlik sayımları atlanır.
      earningsScope: "office",
    }),
    // Ödenen hakediş (commission_payouts.status = paid, bu yıl): danışmana gerçekten ödenen brüt pay (stopaj dahil).
    readAllPaged<{ profile_id: string; amount: number | string }>(
      (from, to) =>
        supabase
          .from("commission_payouts")
          .select("profile_id, amount")
          .eq("status", "paid")
          .gte("paid_at", period.startIso)
          .lt("paid_at", period.endIso)
          .order("id")
          .range(from, to),
      { maxRows: 10_000 },
    ),
  ]);
  const paidOut = new Map<string, number>();
  for (const p of payoutRes.rows) {
    paidOut.set(p.profile_id, (paidOut.get(p.profile_id) ?? 0) + (Number(p.amount) || 0));
  }
  // Okunamaz ya da kısmi ise sütun gösterilmez (sahte/eksik toplam yok).
  const payoutsReadable = !payoutRes.error && !payoutRes.truncated;

  const table = metrics.rows
    .map((m) => ({ m, pending: m.pendingRevenue ?? 0, collected: m.revenue ?? 0, count: m.commissionCount ?? 0, paid: paidOut.get(m.id) ?? 0 }))
    .sort((a, b) => b.collected + b.pending - (a.collected + a.pending) || a.m.fullName.localeCompare(b.m.fullName, "tr"));
  const anyEarning = table.some((r) => r.count > 0);
  const gross = metrics.office.commissionGrossCollected ?? 0;
  const grossPending = metrics.office.commissionGrossPending ?? 0;

  return (
    <div className="space-y-5">
      <PageHeader
        as="h2"
        eyebrow="Hakediş · Ofis geneli"
        title="Danışman hakedişleri"
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
              { label: "Ofis komisyonu (brüt)", value: money(gross), href: financeHref("komisyon", { durum: "tahsil" }), hint: `${year} yılı · tahsil edilen` },
              { label: "Bekleyen komisyon (brüt)", value: money(grossPending), href: financeHref("komisyon", { durum: "bekleyen" }), hint: "tahsil edilmemiş" },
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
              action={{ href: financePath("komisyon"), label: "Komisyon defteri" }}
            />
          ) : (
            <TableFrame stack minWidth={640}>
              <Table>
                <THead>
                  <TR>
                    <TH>Danışman</TH>
                    <TH align="right">Paylı kayıt</TH>
                    <TH align="right">Bekleyen pay</TH>
                    <TH align="right">Tahsil edilen pay</TH>
                    {payoutsReadable ? <TH align="right">Ödenen hakediş</TH> : null}
                    <TH align="right">Toplam</TH>
                  </TR>
                </THead>
                <TBody>
                  {table.map(({ m, pending, collected, count, paid }) => (
                    <TR key={m.id}>
                      <TD primary>
                        <Link href={`/app/ekip/${m.id}?sekme=kazanc`} className={`${LINK} font-semibold text-text`}>
                          {m.fullName}
                        </Link>
                      </TD>
                      <TD label="Paylı kayıt" align="right">
                        <Link href={financePath("komisyon")} className={LINK}>{count}</Link>
                      </TD>
                      <TD label="Bekleyen pay" align="right">
                        <Link href={financeHref("komisyon", { durum: "bekleyen" })} className={LINK}>{pending > 0 ? money(pending) : "—"}</Link>
                      </TD>
                      <TD label="Tahsil edilen pay" align="right">
                        <Link href={financeHref("komisyon", { durum: "tahsil" })} className={LINK}>{collected > 0 ? money(collected) : "—"}</Link>
                      </TD>
                      {payoutsReadable ? (
                        <TD label="Ödenen hakediş" align="right">
                          <Link href={`/app/ekip/${m.id}?sekme=kazanc`} className={LINK}>{paid > 0 ? money(paid) : "—"}</Link>
                        </TD>
                      ) : null}
                      <TD label="Toplam" align="right" className="font-bold text-success-strong">
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
            hesaplanır. &quot;Tahsil edilen&quot; müşteriden tahsilattır; &quot;Ödenen hakediş&quot; bu yıl danışmana ödenen brüt paydır
            (stopaj dahil; ödeme ofis hesabından çıkış olarak deftere yazılır, Komisyon sayfasında &quot;Hakediş öde&quot;).
            Danışman payları toplamı Ofis komisyonundan (brüt) küçüktür: ofis payı ve dış paylar dahil değildir.
          </p>
        </>
      )}
    </div>
  );
}
