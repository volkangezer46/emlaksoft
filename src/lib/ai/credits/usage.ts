import "server-only";
import { createAdminClient } from "@/lib/supabase/admin";
import { now, trMonthKey, trMonthStartIso, trNextMonthStartIso } from "@/lib/clock";
import { AI_LEDGER_UNIT, VALUATION_LEDGER_UNIT } from "@/lib/ai/credits/cost";
import { quotaView, summarizeUsage, type QuotaView, type UsageRow, type UsageSummary } from "@/lib/ai/credits/aggregate";
import { getTenantQuotas } from "@/lib/ai/credits/meter";
import { getPlanDefinitions } from "@/lib/billing/plan-definitions";

/**
 * Kullanım OKUYUCULARI (ofis ekranı + admin). Defter yoksa `enabled:false` döner, fırlatmaz.
 * Okuma service_role ile yapılır; çağıran sayfa kendi yetki kapısını (requireModulePage / platform) geçmiştir
 * ve tenant kimliği oturumdan gelir (istemciden alınmaz).
 */

const ROW_LIMIT = 20_000;

type LedgerRow = {
  tenant_id: string;
  unit: string;
  amount: number | string;
  created_by: string | null;
  feature: string | null;
  tokens_in: number | null;
  tokens_out: number | null;
};

const toUsageRow = (r: LedgerRow): UsageRow => ({
  tenantId: r.tenant_id,
  userId: r.created_by,
  feature: r.feature,
  credits: Math.abs(Number(r.amount)),
  tokensIn: Number(r.tokens_in ?? 0),
  tokensOut: Number(r.tokens_out ?? 0),
});

export type TenantUsage = {
  enabled: boolean;
  monthKey: string;
  ai: QuotaView & UsageSummary;
  valuation: QuotaView & { reports: number };
  userNames: Record<string, string>;
  truncated: boolean;
};

const EMPTY_SUMMARY: UsageSummary = { used: 0, calls: 0, tokens: 0, byFeature: [], byUser: [] };

export async function getTenantUsage(tenantId: string): Promise<TenantUsage> {
  const monthKey = trMonthKey(now());
  const quotas = await getTenantQuotas(tenantId);
  const empty: TenantUsage = {
    enabled: false,
    monthKey,
    ai: { ...quotaView(0, quotas.ai), ...EMPTY_SUMMARY },
    valuation: { ...quotaView(0, quotas.valuation), reports: 0 },
    userNames: {},
    truncated: false,
  };
  try {
    const admin = createAdminClient();
    const { data, error } = await admin
      .from("account_credit_ledger")
      .select("tenant_id, unit, amount, created_by, feature, tokens_in, tokens_out")
      .eq("tenant_id", tenantId)
      .eq("entry_type", "spend")
      .in("unit", [AI_LEDGER_UNIT, VALUATION_LEDGER_UNIT])
      .gte("available_at", trMonthStartIso())
      .lt("available_at", trNextMonthStartIso())
      .limit(ROW_LIMIT);
    if (error) return empty;
    const rows = (data ?? []) as LedgerRow[];
    const ai = summarizeUsage(rows.filter((r) => r.unit === AI_LEDGER_UNIT).map(toUsageRow));
    const reports = rows.filter((r) => r.unit === VALUATION_LEDGER_UNIT).length;

    const ids = ai.byUser.map((b) => b.key).filter((k) => k !== "sistem");
    const userNames: Record<string, string> = {};
    if (ids.length > 0) {
      const { data: profs } = await admin.from("profiles").select("id, full_name").eq("tenant_id", tenantId).in("id", ids);
      for (const p of profs ?? []) userNames[p.id as string] = (p.full_name as string | null) || "Kullanıcı";
    }
    return {
      enabled: true,
      monthKey,
      ai: { ...quotaView(ai.used, quotas.ai), ...ai },
      valuation: { ...quotaView(reports, quotas.valuation), reports },
      userNames,
      truncated: rows.length >= ROW_LIMIT,
    };
  } catch (e) {
    console.error("ai-credits getTenantUsage", e);
    return empty;
  }
}

export type TenantUsageRow = {
  tenantId: string;
  name: string;
  plan: string | null;
  aiUsed: number;
  aiCalls: number;
  aiQuota: number | null;
  aiPercent: number | null;
  aiState: QuotaView["state"];
  valuationReports: number;
  valuationQuota: number | null;
  valuationState: QuotaView["state"];
};

export type PlatformUsage = { enabled: boolean; monthKey: string; rows: TenantUsageRow[]; truncated: boolean };

/** Admin: ofis bazlı bu ayın kullanımı (kullanım sırasına göre). */
export async function getPlatformUsage(): Promise<PlatformUsage> {
  const monthKey = trMonthKey(now());
  try {
    const admin = createAdminClient();
    const { data, error } = await admin
      .from("account_credit_ledger")
      .select("tenant_id, unit, amount, created_by, feature, tokens_in, tokens_out")
      .eq("entry_type", "spend")
      .in("unit", [AI_LEDGER_UNIT, VALUATION_LEDGER_UNIT])
      .gte("available_at", trMonthStartIso())
      .lt("available_at", trNextMonthStartIso())
      .limit(ROW_LIMIT);
    if (error) return { enabled: false, monthKey, rows: [], truncated: false };
    const ledger = (data ?? []) as LedgerRow[];
    const byTenant = new Map<string, LedgerRow[]>();
    for (const r of ledger) byTenant.set(r.tenant_id, [...(byTenant.get(r.tenant_id) ?? []), r]);

    const ids = [...byTenant.keys()];
    const [{ data: tenants }, defs] = await Promise.all([
      ids.length ? admin.from("tenants").select("id, name, plan").in("id", ids) : Promise.resolve({ data: [] }),
      getPlanDefinitions(),
    ]);
    const tmap = new Map((tenants ?? []).map((t) => [t.id as string, t as { id: string; name: string | null; plan: string | null }]));

    const rows: TenantUsageRow[] = ids.map((id) => {
      const list = byTenant.get(id)!;
      const ai = summarizeUsage(list.filter((r) => r.unit === AI_LEDGER_UNIT).map(toUsageRow));
      const reports = list.filter((r) => r.unit === VALUATION_LEDGER_UNIT).length;
      const t = tmap.get(id);
      const def = defs.find((d) => d.id === t?.plan);
      const aq = quotaView(ai.used, def?.aiCreditsMonthly ?? null);
      const vq = quotaView(reports, def?.valuationReportsMonthly ?? null);
      return {
        tenantId: id,
        name: t?.name ?? "Ofis",
        plan: t?.plan ?? null,
        aiUsed: ai.used,
        aiCalls: ai.calls,
        aiQuota: aq.quota,
        aiPercent: aq.percent,
        aiState: aq.state,
        valuationReports: reports,
        valuationQuota: vq.quota,
        valuationState: vq.state,
      };
    });
    rows.sort((a, b) => b.aiUsed - a.aiUsed);
    return { enabled: true, monthKey, rows, truncated: ledger.length >= ROW_LIMIT };
  } catch (e) {
    console.error("ai-credits getPlatformUsage", e);
    return { enabled: false, monthKey, rows: [], truncated: false };
  }
}
