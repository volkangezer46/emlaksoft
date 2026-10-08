import Link from "@/components/ui/smart-link";
import { Users } from "lucide-react";
import { createClient } from "@/lib/supabase/server";
import { fetchAllRows } from "@/lib/supabase/fetch-all";
import { formatTry } from "@/lib/format";
import { computeAdvisorProfitability, type AdvisorCommission, type AdvisorExpense, type AdvisorSplit } from "@/lib/finance/advisor-profitability";
import { Alert } from "@/components/ui/alert";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableFrame, TBody, TD, TH, THead, TR } from "@/components/ui/table";

type Rel<T> = T | T[] | null;
const one = <T,>(v: Rel<T>): T | null => (Array.isArray(v) ? (v[0] ?? null) : v);

/**
 * Danışman kârlılığı: danışman başına ofiste kalan komisyon (brüt − KDV − dış paylar) ↔ doğrudan maliyet (danışmanın
 * portföylerine bağlı giderler). YALNIZ ofis sahibi / genel müdür (kazanç gizliliği P12); çağıran sayfa rol kapısını uygular.
 * Veri yoksa kart yok. Yöntem: `src/lib/finance/advisor-profitability.ts`.
 */
export async function AdvisorProfitCard({ tenantId, firstMonthKey }: { tenantId: string; firstMonthKey: string }) {
  const supabase = await createClient();
  const startIso = `${firstMonthKey}-01T00:00:00+03:00`;

  const [commRes, expRes] = await Promise.all([
    fetchAllRows<{ id: string; gross_amount: number | string; vat_amount: number | string | null; status: string; deal: Rel<{ assigned_to: string | null }> }>((from, to) =>
      supabase
        .from("commissions")
        .select("id, gross_amount, vat_amount, status, deal:deals!commissions_deal_id_fkey(assigned_to)")
        .eq("tenant_id", tenantId)
        .eq("is_sample", false)
        .gte("created_at", startIso)
        .order("id", { ascending: true })
        .range(from, to),
    ),
    fetchAllRows<{ amount: number | string; property: Rel<{ assigned_to: string | null }> }>((from, to) =>
      supabase
        .from("expenses")
        .select("id, amount, property:properties!expenses_property_id_fkey(assigned_to)")
        .eq("tenant_id", tenantId)
        .eq("is_sample", false)
        .gte("expense_date", `${firstMonthKey}-01`)
        .order("id", { ascending: true })
        .range(from, to),
    ),
  ]);
  // Eksik veriyle net hesaplanmaz: okuma hatasında kart gizlenir.
  if (commRes.error || expRes.error) return null;

  const commissions: AdvisorCommission[] = [];
  for (const c of commRes.data) {
    const advisorId = one(c.deal)?.assigned_to;
    if (!advisorId) continue;
    commissions.push({ commissionId: c.id, advisorId, gross: Number(c.gross_amount) || 0, vat: Number(c.vat_amount) || 0, status: c.status });
  }

  const splits: AdvisorSplit[] = [];
  const ids = commissions.map((c) => c.commissionId);
  for (let i = 0; i < ids.length; i += 200) {
    const part = ids.slice(i, i + 200);
    const res = await fetchAllRows<{ commission_id: string; kind: string; amount: number | string }>((from, to) =>
      supabase
        .from("commission_splits")
        .select("id, commission_id, kind, amount")
        .eq("tenant_id", tenantId)
        .in("commission_id", part)
        .order("id", { ascending: true })
        .range(from, to),
    );
    if (res.error) return null;
    for (const s of res.data) splits.push({ commissionId: s.commission_id, kind: s.kind, amount: Number(s.amount) || 0 });
  }

  const expenses: AdvisorExpense[] = expRes.data.map((e) => ({ advisorId: one(e.property)?.assigned_to ?? null, amount: Number(e.amount) || 0 }));

  const advisorIds = [...new Set([...commissions.map((c) => c.advisorId), ...expenses.map((e) => e.advisorId).filter((x): x is string => Boolean(x))])];
  if (advisorIds.length === 0) return null;
  const { data: profiles } = await supabase.from("profiles").select("id, full_name").eq("tenant_id", tenantId).in("id", advisorIds.slice(0, 200));
  const names = new Map(((profiles ?? []) as { id: string; full_name: string | null }[]).map((p) => [p.id, p.full_name ?? "Danışman"]));

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
