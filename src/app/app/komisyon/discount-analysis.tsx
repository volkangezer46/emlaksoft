import Link from "@/components/ui/smart-link";
import { BadgePercent } from "lucide-react";
import { createClient } from "@/lib/supabase/server";
import { fetchAllRows } from "@/lib/supabase/fetch-all";
import { getSettings } from "@/lib/settings/read";
import { DEFAULT_COMMISSION_RATE } from "@/lib/commission";
import { loadApprovalRules } from "@/lib/oversight/store";
import { defaultApprovalRules } from "@/lib/oversight/settings";
import { lastMonthKeys } from "@/lib/reporting/profit-loss";
import { computeCommissionLeakage, type WonSaleFact } from "@/lib/finance/commission-leakage";
import { now, trMonthKey } from "@/lib/clock";
import { formatTry } from "@/lib/format";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableFrame, TBody, TD, TH, THead, TR } from "@/components/ui/table";

const MONTHS = ["Oca", "Şub", "Mar", "Nis", "May", "Haz", "Tem", "Ağu", "Eyl", "Eki", "Kas", "Ara"];
const monthLabel = (key: string) => `${MONTHS[Number(key.slice(5, 7)) - 1]} ${key.slice(2, 4)}`;
const rateText = (n: number) => `%${new Intl.NumberFormat("tr-TR", { maximumFractionDigits: 2 }).format(n)}`;

type Rel<T> = T | T[] | null;
const one = <T,>(v: Rel<T>): T | null => (Array.isArray(v) ? (v[0] ?? null) : v);

/**
 * Komisyon merkezi: indirim analizi (komisyon sızıntısı). Son 6 ayda kazanılan SATIŞ anlaşmalarında portföyün komisyon oranı
 * ofis standart oranının altındaysa fark "indirimle kaçan gelir"dir. Danışman kırılımı yalnız ofis sahibi/genel müdüre görünür.
 * Yalnız tüm kazancı görenlere render edilir (çağıran sayfa kapıyı uygular). Yöntem: `src/lib/finance/commission-leakage.ts`.
 */
export async function DiscountAnalysisCard({ tenantId, showAdvisors }: { tenantId: string; showAdvisors: boolean }) {
  const supabase = await createClient();
  const nowMs = now();
  const months = lastMonthKeys(trMonthKey(nowMs), 6);
  const startIso = `${months[0]}-01T00:00:00+03:00`;

  const [dealsRes, settings, rules] = await Promise.all([
    fetchAllRows<{
      id: string;
      deal_value: number | string | null;
      assigned_to: string | null;
      updated_at: string;
      property: Rel<{ id: string; property_code: string | null; title: string | null; commission_rate: number | string | null }>;
    }>((from, to) =>
      supabase
        .from("deals")
        .select("id, deal_value, assigned_to, updated_at, property:properties!deals_property_id_fkey(id, property_code, title, commission_rate)")
        .eq("tenant_id", tenantId)
        .eq("stage", "won")
        .eq("deal_type", "sale")
        .eq("is_sample", false)
        .gte("updated_at", startIso)
        .order("id", { ascending: true })
        .range(from, to),
    ),
    getSettings(["office.commission.default_rate"], { tenantId }),
    loadApprovalRules(supabase, tenantId).catch(() => defaultApprovalRules()),
  ]);
  if (dealsRes.error) return null;

  const advisorIds = [...new Set(dealsRes.data.map((d) => d.assigned_to).filter((x): x is string => Boolean(x)))];
  const names = new Map<string, string>();
  if (showAdvisors && advisorIds.length > 0) {
    const { data } = await supabase.from("profiles").select("id, full_name").eq("tenant_id", tenantId).in("id", advisorIds.slice(0, 200));
    for (const p of (data ?? []) as { id: string; full_name: string | null }[]) names.set(p.id, p.full_name ?? "Danışman");
  }

  const standardRate = Number(settings["office.commission.default_rate"] ?? DEFAULT_COMMISSION_RATE) || DEFAULT_COMMISSION_RATE;
  const sales: WonSaleFact[] = dealsRes.data.map((d) => {
    const p = one(d.property);
    const rate = p?.commission_rate != null && Number.isFinite(Number(p.commission_rate)) ? Number(p.commission_rate) : null;
    return {
      dealId: d.id,
      propertyId: p?.id ?? null,
      propertyLabel: p ? (p.property_code ?? p.title) : null,
      advisorId: d.assigned_to,
      advisorName: d.assigned_to ? (names.get(d.assigned_to) ?? null) : null,
      dealValue: Number(d.deal_value) || 0,
      appliedRate: rate,
      closedAt: d.updated_at,
    };
  });

  const rule = rules.commission_discount;
  const result = computeCommissionLeakage(sales, standardRate, months, { enabled: rule.enabled, threshold: rule.threshold });
  // Veri yoksa kart yok.
  if (result.salesAnalyzed === 0) return null;

  const maxLeak = Math.max(1, ...result.months.map((m) => m.leak));
  const topDeals = result.deals.slice(0, 8);

  return (
    <Card id="indirim-analizi" className="scroll-mt-24">
      <CardHeader>
        <div>
          <CardTitle className="flex items-center gap-2"><BadgePercent className="h-4 w-4 text-brand-600" aria-hidden /> İndirim analizi (komisyon sızıntısı)</CardTitle>
          <CardDescription>
            Son 6 ay · kazanılan satışlarda portföy komisyon oranı ofis standardının ({rateText(standardRate)}) altındaysa fark &quot;indirimle kaçan gelir&quot; sayılır.
          </CardDescription>
        </div>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
          <Link href="/app/anlasmalar?gorunum=liste&asama=won" className="focus-ring rounded-[var(--radius-card)] border border-line p-3">
            <p className="text-xs text-text-muted">Analiz edilen satış</p>
            <p className="numeric font-display text-xl font-extrabold text-text">{result.salesAnalyzed}</p>
          </Link>
          <div className="rounded-[var(--radius-card)] border border-line p-3">
            <p className="text-xs text-text-muted">İndirimli satış</p>
            <p className="numeric font-display text-xl font-extrabold text-text">{result.discountedCount}</p>
          </div>
          <div className="rounded-[var(--radius-card)] border border-line p-3">
            <p className="text-xs text-text-muted">İndirimle kaçan gelir</p>
            <p className={`numeric font-display text-xl font-extrabold ${result.totalLeak > 0 ? "text-danger-600" : "text-text"}`}>{formatTry(result.totalLeak)}</p>
          </div>
          <Link
            href={rule.enabled ? "/app/onaylar?tur=komisyon_indirimi" : "/app/ofis-kontrol/kurallar"}
            className="focus-ring rounded-[var(--radius-card)] border border-line p-3"
          >
            <p className="text-xs text-text-muted">Onay kuralı</p>
            <p className="font-display text-xl font-extrabold text-text">{rule.enabled ? `Açık · ${rateText(rule.threshold).replace("%", "")} puan` : "Kapalı"}</p>
            <p className="text-xs text-text-faint">
              {rule.enabled ? `${result.overThresholdCount} indirim eşiği aştı` : "İndirim onaysız yapılabiliyor; kuralı açın"}
            </p>
          </Link>
        </div>

        {result.discountedCount === 0 ? (
          <p className="text-sm text-text-muted">Son 6 ayda standart oranın altında kapanan satış yok: indirimle kaçan gelir görünmüyor.</p>
        ) : (
          <>
            <div>
              <h3 className="mb-2 text-xs font-semibold uppercase tracking-[0.06em] text-text-faint">Aylık kaçan gelir</h3>
              <ul className="grid gap-1.5">
                {result.months.map((m) => (
                  <li key={m.key} className="grid grid-cols-[3.5rem_minmax(0,1fr)_auto] items-center gap-3 text-sm">
                    <span className="text-text-muted">{monthLabel(m.key)}</span>
                    <span className="h-2 overflow-hidden rounded-full bg-line" aria-hidden>
                      <span className="block h-full rounded-full bg-danger-500" style={{ width: `${Math.round((m.leak / maxLeak) * 100)}%` }} />
                    </span>
                    <Link href={`/app/komisyon?from=${m.key}-01`} className="focus-ring numeric rounded hover:underline">
                      {m.leak > 0 ? formatTry(m.leak) : "—"}
                    </Link>
                  </li>
                ))}
              </ul>
            </div>

            <div>
              <h3 className="mb-2 text-xs font-semibold uppercase tracking-[0.06em] text-text-faint">En büyük indirimler</h3>
              <TableFrame minWidth={560} stack>
                <Table>
                  <THead>
                    <TR>
                      <TH>Portföy</TH>
                      <TH align="right">Oran</TH>
                      <TH align="right">Kaçan</TH>
                      <TH className="hidden sm:table-cell">Onay</TH>
                    </TR>
                  </THead>
                  <TBody>
                    {topDeals.map((d) => (
                      <TR key={d.dealId}>
                        <TD primary className="font-semibold text-text">
                          <Link href={`/app/anlasmalar/${d.dealId}`} className="focus-ring rounded hover:underline">{d.label}</Link>
                          <span className="mt-0.5 block text-xs font-normal text-text-faint">
                            {formatTry(d.dealValue)}
                            {showAdvisors && d.advisorName ? ` · ${d.advisorName}` : ""}
                          </span>
                        </TD>
                        <TD label="Oran" align="right" className="numeric">
                          {rateText(d.appliedRate)} <span className="text-xs text-text-faint">/ {rateText(d.standardRate)} (−{new Intl.NumberFormat("tr-TR", { maximumFractionDigits: 2 }).format(d.cutPoints)} puan)</span>
                        </TD>
                        <TD label="Kaçan" align="right" className="numeric font-semibold text-danger-600">{formatTry(d.leak)}</TD>
                        <TD label="Onay" className="hidden sm:table-cell">
                          {d.overApprovalThreshold ? (
                            <Link href="/app/onaylar?tur=komisyon_indirimi" className="focus-ring rounded">
                              <Badge variant="warning" size="sm">eşik üstü</Badge>
                            </Link>
                          ) : (
                            <span className="text-xs text-text-faint">{rule.enabled ? "eşik altı" : "kural kapalı"}</span>
                          )}
                        </TD>
                      </TR>
                    ))}
                  </TBody>
                </Table>
              </TableFrame>
            </div>

            {showAdvisors && result.advisors.length > 0 ? (
              <div>
                <h3 className="mb-2 text-xs font-semibold uppercase tracking-[0.06em] text-text-faint">Danışman bazında (yalnız yönetici)</h3>
                <TableFrame minWidth={480} stack>
                  <Table>
                    <THead>
                      <TR>
                        <TH>Danışman</TH>
                        <TH align="right">İndirimli satış</TH>
                        <TH align="right">Ort. indirim</TH>
                        <TH align="right">Kaçan</TH>
                      </TR>
                    </THead>
                    <TBody>
                      {result.advisors.slice(0, 10).map((a) => (
                        <TR key={a.advisorId}>
                          <TD primary className="font-semibold text-text">
                            <Link href={`/app/anlasmalar?gorunum=liste&asama=won&danisman=${a.advisorId}`} className="focus-ring rounded hover:underline">{a.name}</Link>
                          </TD>
                          <TD label="İndirimli satış" align="right" className="numeric">{a.deals}</TD>
                          <TD label="Ort. indirim" align="right" className="numeric">{new Intl.NumberFormat("tr-TR", { maximumFractionDigits: 2 }).format(a.avgCutPoints)} puan</TD>
                          <TD label="Kaçan" align="right" className="numeric font-semibold text-danger-600">{formatTry(a.leak)}</TD>
                        </TR>
                      ))}
                    </TBody>
                  </Table>
                </TableFrame>
              </div>
            ) : null}
          </>
        )}
        <p className="text-xs leading-relaxed text-text-faint">
          Uygulanan oran portföy kaydındaki GÜNCEL komisyon oranıdır; kiralama anlaşmaları ve örnek veri hariçtir. Standart oran, Ayarlar &gt; Ofis tanımları&apos;ndaki varsayılan
          komisyon oranıdır (sözleşme bazlı liste oranı değildir). Onay kuralı{" "}
          <Link href="/app/ofis-kontrol/kurallar" className="font-semibold underline">Ofis kontrol &gt; Kurallar</Link>&apos;dan yönetilir.
        </p>
      </CardContent>
    </Card>
  );
}
