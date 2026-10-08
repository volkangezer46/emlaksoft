import Link from "@/components/ui/smart-link";
import { Users } from "lucide-react";
import { loadOfficeProfitData } from "@/lib/finance/office-profit-data";
import { formatTry } from "@/lib/format";
import { computeAdvisorProfitability, type AdvisorCommission, type AdvisorExpense, type AdvisorSplit } from "@/lib/finance/advisor-profitability";
import { Alert } from "@/components/ui/alert";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableFrame, TBody, TD, TH, THead, TR } from "@/components/ui/table";

/**
 * Danışman kârlılığı: danışman başına ofiste kalan komisyon (brüt − KDV − dış paylar) ↔ doğrudan maliyet (danışmanın
 * portföylerine bağlı giderler). YALNIZ ofis sahibi / genel müdür (kazanç gizliliği P12); çağıran sayfa rol kapısını uygular.
 * Veri yoksa kart yok. Yöntem: `src/lib/finance/advisor-profitability.ts`.
 */
export async function AdvisorProfitCard({ tenantId, userId, firstMonthKey }: { tenantId: string; userId: string; firstMonthKey: string }) {
  // Sayfayla AYNI okuma (istek içi cache + kısa TTL ofis önbelleği): tablolar ikinci kez sorgulanmaz.
  // Eksik veriyle net hesaplanmaz: okuma hatasında kart gizlenir.
  const data = await loadOfficeProfitData(tenantId, userId, firstMonthKey).catch(() => null);
  if (!data) return null;

  const commissions: AdvisorCommission[] = [];
  for (const c of data.commissions) {
    if (!c.advisorId) continue;
    commissions.push({ commissionId: c.id, advisorId: c.advisorId, gross: c.gross, vat: c.vat, status: c.status });
  }
  const advised = new Set(commissions.map((c) => c.commissionId));
  const splits: AdvisorSplit[] = data.splits.filter((s) => advised.has(s.commissionId));
  const expenses: AdvisorExpense[] = data.expenses.map((e) => ({ advisorId: e.advisorId, amount: e.amount }));

  const advisorIds = [...new Set([...commissions.map((c) => c.advisorId), ...expenses.map((e) => e.advisorId).filter((x): x is string => Boolean(x))])];
  if (advisorIds.length === 0) return null;
  const names = new Map(Object.entries(data.advisorNames));

  const result = computeAdvisorProfitability(commissions, splits, expenses, names);
  if (result.rows.length === 0) return null;
  const unsplit = result.rows.reduce((s, r) => s + r.unsplit, 0);

  return (
    <Card id="danisman-karliligi" className="scroll-mt-24">
      <CardHeader>
        <div>
          <CardTitle className="flex items-center gap-2"><Users className="h-4 w-4 text-brand-600" aria-hidden /> Danışman kârlılığı</CardTitle>
          <CardDescription>
            Son 12 ay · ofiste kalan komisyon (brüt − KDV − dış paylar) ↔ danışmanın portföylerine bağlı doğrudan giderler. Yalnız ofis sahibi ve genel müdür görür.
          </CardDescription>
        </div>
      </CardHeader>
      <CardContent className="space-y-3">
        {unsplit > 0 ? (
          <Alert tone="warning">{unsplit} komisyon kaydında paylaşım tanımlanmamış: bu kayıtlarda danışman payı düşülmedi, ofiste kalan olduğundan yüksek görünebilir.</Alert>
        ) : null}
        <TableFrame minWidth={640} stack>
          <Table>
            <THead>
              <TR>
                <TH>Danışman</TH>
                <TH align="right">Komisyon (brüt)</TH>
                <TH align="right">Ofiste kalan</TH>
                <TH align="right">Doğrudan maliyet</TH>
                <TH align="right">Net katkı</TH>
              </TR>
            </THead>
            <TBody>
              {result.rows.map((r) => (
                <TR key={r.advisorId}>
                  <TD primary className="font-semibold text-text">
                    <Link href={`/app/anlasmalar?gorunum=liste&asama=won&danisman=${r.advisorId}`} className="focus-ring rounded hover:underline">{r.name}</Link>
                    <span className="mt-0.5 block text-xs font-normal text-text-faint">{r.commissions} komisyon</span>
                  </TD>
                  <TD label="Komisyon (brüt)" align="right" className="numeric">
                    <Link href={`/app/komisyon?from=${firstMonthKey}-01`} className="focus-ring rounded hover:underline">{formatTry(r.gross)}</Link>
                  </TD>
                  <TD label="Ofiste kalan" align="right" className="numeric">{formatTry(r.retained)}</TD>
                  <TD label="Doğrudan maliyet" align="right" className="numeric">
                    {r.directCosts > 0 ? (
                      <Link href={`/app/giderler?from=${firstMonthKey}-01`} className="focus-ring rounded hover:underline">{formatTry(r.directCosts)}</Link>
                    ) : (
                      "—"
                    )}
                  </TD>
                  <TD label="Net katkı" align="right" className={`numeric font-semibold ${r.net < 0 ? "text-danger-600" : ""}`}>{formatTry(r.net)}</TD>
                </TR>
              ))}
            </TBody>
          </Table>
        </TableFrame>
        <p className="text-xs leading-relaxed text-text-faint">
          Doğrudan maliyet yalnız bir portföye bağlanmış giderlerdir ve o portföyün güncel danışmanına yazılır. Portföye bağlanmamış ortak giderler
          ({formatTry(result.unattributedExpenses)}) danışmanlara PAYLAŞTIRILMAZ. Komisyon tahakkuk esasına göre, iptaller ve örnek veri hariç sayılır; bu tablo
          performans değerlendirmesi değil, maliyet görünürlüğüdür.
        </p>
      </CardContent>
    </Card>
  );
}
