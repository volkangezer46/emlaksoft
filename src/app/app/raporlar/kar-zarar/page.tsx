import Link from "@/components/ui/smart-link";
import { PageHeader } from "@/components/ui/page-header";
import { Alert } from "@/components/ui/alert";
import { EmptyState } from "@/components/ui/empty-state";
import { Table, TableFrame, TBody, TD, TH, THead, TR } from "@/components/ui/table";
import { requireModulePage } from "@/lib/require-module-page";
import { canSeeAllEarnings } from "@/lib/team/earnings-scope";
import { formatTry } from "@/lib/format";
import { now, trMonthKey } from "@/lib/clock";
import { loadOfficeProfitData } from "@/lib/finance/office-profit-data";
import { assertQueryBatchSucceeded } from "@/lib/supabase/query-batch";
import { Suspense } from "react";
import { SkeletonCard } from "@/components/ui/viz";
import { AdvisorProfitCard } from "./advisor-profit";
import { buildProfitLoss, lastMonthKeys, type PlCommission, type PlExpense, type PlSplit } from "@/lib/reporting/profit-loss";

export const metadata = { title: "Kâr / zarar" };

const MONTHS = ["Oca", "Şub", "Mar", "Nis", "May", "Haz", "Tem", "Ağu", "Eyl", "Eki", "Kas", "Ara"];
const label = (key: string) => `${MONTHS[Number(key.slice(5, 7)) - 1]} ${key.slice(0, 4)}`;

function monthRange(key: string): { from: string; to: string } {
  const [y, m] = key.split("-").map(Number);
  const last = new Date(Date.UTC(y, m, 0)).getUTCDate();
  return { from: `${key}-01`, to: `${key}-${String(last).padStart(2, "0")}` };
}

/**
 * Ofis kâr/zarar: son 12 ay komisyon (tahakkuk) − KDV − ofis dışına dağıtılan paylar − gider = net. Yalnız tüm kazancı
 * görebilenler (earnings_all). Her tutar ilgili filtreli listeye gider. Örnek veri hariç. Yöntem `src/lib/reporting/profit-loss.ts`.
 */
export default async function ProfitLossPage() {
  const { perms, tenantId, role, userId } = await requireModulePage("reports", "/app/raporlar");
  const crumbs = [{ label: "Raporlar", href: "/app/raporlar" }, { label: "Kâr / zarar" }];
  if (!tenantId || !canSeeAllEarnings(perms)) {
    return (
      <div className="space-y-4">
        <PageHeader title="Kâr / zarar" breadcrumbs={crumbs} />
        <Alert tone="info">Bu rapor ofisin toplam kazancını gösterdiği için yalnız tüm kazancı görme yetkisi olan yöneticilere açıktır.</Alert>
      </div>
    );
  }

  const keys = lastMonthKeys(trMonthKey(now()), 12);
  // Komisyon + paylar + giderler TEK ortak okuma (kısa TTL'li ofis önbelleği; "Danışman kârlılığı" kartıyla paylaşılır).
  let data;
  try {
    data = await loadOfficeProfitData(tenantId, userId, keys[0]!);
  } catch {
    assertQueryBatchSucceeded([{ error: new Error("okuma") }], ["kar-zarar"], "Kâr / zarar");
    throw new Error("Kâr / zarar verisi okunamadı");
  }
  const commissions: PlCommission[] = data.commissions.map((c) => ({ id: c.id, createdAt: c.createdAt, gross: c.gross, vat: c.vat, status: c.status }));
  const splits: PlSplit[] = data.splits.map((s) => ({ commissionId: s.commissionId, kind: s.kind, amount: s.amount }));
  const expenses: PlExpense[] = data.expenses.map((e) => ({ date: e.date, amount: e.amount }));
  const pl = buildProfitLoss(keys, commissions, splits, expenses);

  return (
    <div className="space-y-5">
      <PageHeader
        eyebrow="Raporlar"
        title="Kâr / zarar"
        description="Son 12 ay: komisyon gelirinden KDV, danışman ve diğer dış paylar ile ofis giderleri düşülünce kalan net."
        breadcrumbs={crumbs}
      />
      {!pl.hasData ? (
        <EmptyState
          variant="panel"
          title="Son 12 ayda komisyon veya gider kaydı yok."
          description="Komisyon kayıtları anlaşma kapanışında, giderler Giderler ekranından girilir."
          action={{ label: "Gider ekle", href: "/app/giderler" }}
        />
      ) : (
        <>
          <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
            <Link href={`/app/komisyon?from=${keys[0]}-01`} className="focus-ring rounded-[var(--radius-card)] border border-line bg-surface p-4 shadow-[var(--shadow-xs)]">
              <p className="text-xs text-text-muted">Komisyon (brüt)</p>
              <p className="font-display text-xl font-extrabold text-ink-950">{formatTry(pl.totals.revenue)}</p>
              <p className="text-xs text-text-faint">{pl.totals.commissions} kayıt</p>
            </Link>
            <Link href={`/app/komisyon?from=${keys[0]}-01`} className="focus-ring rounded-[var(--radius-card)] border border-line bg-surface p-4 shadow-[var(--shadow-xs)]">
              <p className="text-xs text-text-muted">Dağıtılan paylar</p>
              <p className="font-display text-xl font-extrabold text-ink-950">{formatTry(pl.totals.shares)}</p>
              <p className="text-xs text-text-faint">KDV {formatTry(pl.totals.vat)}</p>
            </Link>
            <Link href={`/app/giderler?from=${keys[0]}-01`} className="focus-ring rounded-[var(--radius-card)] border border-line bg-surface p-4 shadow-[var(--shadow-xs)]">
              <p className="text-xs text-text-muted">Gider</p>
              <p className="font-display text-xl font-extrabold text-ink-950">{formatTry(pl.totals.expenses)}</p>
            </Link>
            <div className="rounded-[var(--radius-card)] border border-line bg-surface p-4 shadow-[var(--shadow-xs)]">
              <p className="text-xs text-text-muted">Net</p>
              <p className={`font-display text-xl font-extrabold ${pl.totals.net < 0 ? "text-danger-600" : "text-ink-950"}`}>{formatTry(pl.totals.net)}</p>
              <p className="text-xs text-text-faint">12 ay toplamı</p>
            </div>
          </div>
          {pl.unsplitCount > 0 ? (
            <Alert tone="warning">
              {pl.unsplitCount} komisyon kaydında paylaşım tanımlanmamış: bu kayıtların danışman payı düşülmedi, net olduğundan yüksek görünebilir.{" "}
              <Link href="/app/komisyon" className="font-semibold underline">Komisyon merkezi</Link>
            </Alert>
          ) : null}
          <TableFrame>
            <Table>
              <THead>
                <TR>
                  <TH>Ay</TH>
                  <TH className="text-right">Komisyon</TH>
                  <TH className="text-right">KDV</TH>
                  <TH className="text-right">Paylar</TH>
                  <TH className="text-right">Gider</TH>
                  <TH className="text-right">Net</TH>
                </TR>
              </THead>
              <TBody>
                {[...pl.months].reverse().map((m) => {
                  const r = monthRange(m.key);
                  return (
                    <TR key={m.key}>
                      <TD className="font-medium">{label(m.key)}</TD>
                      <TD className="text-right tabular-nums">
                        <Link href={`/app/komisyon?from=${r.from}&to=${r.to}`} className="hover:underline">{formatTry(m.revenue)}</Link>
                      </TD>
                      <TD className="text-right tabular-nums">{formatTry(m.vat)}</TD>
                      <TD className="text-right tabular-nums">{formatTry(m.shares)}</TD>
                      <TD className="text-right tabular-nums">
                        <Link href={`/app/giderler?from=${r.from}&to=${r.to}`} className="hover:underline">{formatTry(m.expenses)}</Link>
                      </TD>
                      <TD className={`text-right font-semibold tabular-nums ${m.net < 0 ? "text-danger-600" : ""}`}>{formatTry(m.net)}</TD>
                    </TR>
                  );
                })}
              </TBody>
            </Table>
          </TableFrame>
          <p className="text-xs leading-relaxed text-text-faint">
            Komisyon tahakkuk esasına göre (kayıt ayı) sayılır; tahsilat değildir. İptal edilen komisyon ve örnek veri hariç. &quot;Paylar&quot; ofis dışına giden
            danışman/referans/franchise paylarıdır (ofis payı düşülmez). Gelir/kurumlar vergisi hesaplanmaz; mali müşavirinizle doğrulayın.
          </p>
          {/* Danışman bazlı kırılım yalnız ofis sahibi / genel müdür (kazanç gizliliği P12). */}
          {role === "owner" || role === "gm" ? (
            <Suspense fallback={<SkeletonCard height={320} label="Danışman kârlılığı yükleniyor" />}>
              <AdvisorProfitCard tenantId={tenantId} userId={userId} firstMonthKey={keys[0]!} />
            </Suspense>
          ) : null}
        </>
      )}
    </div>
  );
}
