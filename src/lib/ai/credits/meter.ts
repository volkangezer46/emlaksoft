import "server-only";
import { randomUUID } from "node:crypto";
import { createAdminClient } from "@/lib/supabase/admin";
import { getPlatformSetting } from "@/lib/platform-settings";
import { getPlanDefinition } from "@/lib/billing/plan-definitions";
import { now, trMonthStartIso, trNextMonthStartIso } from "@/lib/clock";
import {
  AI_COST_TABLE_SETTING_KEY,
  AI_LEDGER_UNIT,
  VALUATION_LEDGER_UNIT,
  computeCredits,
  parseCostTable,
  type CostTable,
} from "@/lib/ai/credits/cost";

/**
 * AI kredi + değerleme raporu ÖLÇÜMÜ (TEK defter: account_credit_ledger, RPC `ai_credit_charge`).
 *
 * Kurallar:
 *  - FAIL-OPEN: hiçbir fonksiyon fırlatmaz; hata/eksik tablo/eksik RPC durumunda sessizce
 *    `{ metered: false }` döner ve loglar. Ölçüm asla özelliği kırmaz.
 *  - NAZİK: aşım çağrıyı ENGELLEMEZ; kullanım yazılır, ekranlarda uyarı/yönlendirme gösterilir.
 *  - Kota (plan alanı) boşsa SINIRSIZ: yalnız kullanım yazılır, hak verilmez.
 *  - Deftere ham istem/kişisel veri YAZILMAZ: özellik adı, model, jeton sayıları, kredi.
 */

const COST_TTL_MS = 5 * 60_000;
const QUOTA_TTL_MS = 60_000;
const DISABLED_RETRY_MS = 60_000;

let costCache: { table: CostTable; at: number } | null = null;
const quotaCache = new Map<string, { ai: number | null; valuation: number | null; at: number }>();
let disabledUntil = 0;

/** Test yardımcısı: bellek önbelleklerini sıfırlar. */
export function resetMeterCaches(): void {
  costCache = null;
  quotaCache.clear();
  disabledUntil = 0;
}

export type MeterResult = {
  metered: boolean;
  /** Dönem bakiyesi (kota varsa); sınırsız/ölçülmediyse null. */
  balance: number | null;
  credits: number;
};

const NOT_METERED = (credits = 0): MeterResult => ({ metered: false, balance: null, credits });

export async function getCostTable(): Promise<CostTable> {
  const t = now();
  if (costCache && t - costCache.at < COST_TTL_MS) return costCache.table;
  let table: CostTable;
  try {
    table = parseCostTable(await getPlatformSetting(AI_COST_TABLE_SETTING_KEY));
  } catch {
    table = parseCostTable(null);
  }
  costCache = { table, at: t };
  return table;
}

/** Tenant planının aylık kotaları; alan boşsa null (= sınırsız). Hata olursa null (fail-open). */
export async function getTenantQuotas(tenantId: string): Promise<{ ai: number | null; valuation: number | null }> {
  const t = now();
  const hit = quotaCache.get(tenantId);
  if (hit && t - hit.at < QUOTA_TTL_MS) return { ai: hit.ai, valuation: hit.valuation };
  let out: { ai: number | null; valuation: number | null } = { ai: null, valuation: null };
  try {
    const admin = createAdminClient();
    const { data } = await admin.from("tenants").select("plan").eq("id", tenantId).maybeSingle();
    if (data?.plan) {
      const def = await getPlanDefinition(String(data.plan));
      out = { ai: def.aiCreditsMonthly ?? null, valuation: def.valuationReportsMonthly ?? null };
    }
  } catch (e) {
    console.error("ai-credits getTenantQuotas", e);
  }
  quotaCache.set(tenantId, { ...out, at: t });
  return out;
}

function isMissingSchema(error: { code?: string; message?: string } | null): boolean {
  if (!error) return false;
  const msg = (error.message ?? "").toLowerCase();
  return (
    error.code === "PGRST202" ||
    error.code === "42883" ||
    error.code === "42P01" ||
    error.code === "PGRST205" ||
    msg.includes("could not find the function") ||
    msg.includes("does not exist")
  );
}

type ChargeInput = {
  tenantId: string;
  actorId?: string | null;
  unit: typeof AI_LEDGER_UNIT | typeof VALUATION_LEDGER_UNIT;
  amount: number;
  feature: string;
  model?: string | null;
  tokensIn?: number;
  tokensOut?: number;
  quota: number | null;
  idempotencyKey: string;
};

async function charge(input: ChargeInput): Promise<MeterResult> {
  if (now() < disabledUntil) return NOT_METERED(input.amount);
  try {
    const admin = createAdminClient();
    const { data, error } = await admin.rpc("ai_credit_charge", {
      p_tenant_id: input.tenantId,
      p_unit: input.unit,
      p_amount: input.amount,
      p_feature: input.feature,
      p_model: input.model ?? "",
      p_tokens_in: Math.round(input.tokensIn ?? 0),
      p_tokens_out: Math.round(input.tokensOut ?? 0),
      p_actor_id: input.actorId ?? null,
      p_idempotency_key: input.idempotencyKey,
      p_period_start: trMonthStartIso(),
      p_period_end: trNextMonthStartIso(),
      p_quota: input.quota,
    });
    if (error) {
      if (isMissingSchema(error)) {
        // Migration henüz uygulanmadı: ölçüm "etkin değil", AI aynen çalışır.
        disabledUntil = now() + DISABLED_RETRY_MS;
        return NOT_METERED(input.amount);
      }
      console.error("ai-credits charge", error.message);
      return NOT_METERED(input.amount);
    }
    const r = (data ?? {}) as { balance?: number | string | null };
    const balance = r.balance === null || r.balance === undefined ? null : Number(r.balance);
    return { metered: true, balance: Number.isFinite(balance as number) ? balance : null, credits: input.amount };
  } catch (e) {
    console.error("ai-credits charge", e);
    return NOT_METERED(input.amount);
  }
}

export type AiUsageInput = {
  tenantId: string;
  actorId?: string | null;
  /** Çağrının amacı (özellik adı): "tenant_chat", "property_content"... Kişisel veri içermez. */
  feature: string;
  model?: string | null;
  tokensIn: number;
  tokensOut: number;
};

/** Bir AI çağrısının kredisini harcar. Asla fırlatmaz; ölçülemezse `metered:false`. */
export async function chargeAiUsage(input: AiUsageInput): Promise<MeterResult> {
  try {
    if (!input.tenantId) return NOT_METERED();
    const [table, quotas] = await Promise.all([getCostTable(), getTenantQuotas(input.tenantId)]);
    const credits = computeCredits(input.model, input.tokensIn, input.tokensOut, table);
    return await charge({
      tenantId: input.tenantId,
      actorId: input.actorId,
      unit: AI_LEDGER_UNIT,
      amount: credits,
      feature: input.feature,
      model: input.model,
      tokensIn: input.tokensIn,
      tokensOut: input.tokensOut,
      quota: quotas.ai,
      idempotencyKey: `ai:${randomUUID()}`,
    });
  } catch (e) {
    console.error("ai-credits chargeAiUsage", e);
    return NOT_METERED();
  }
}

/** Değerleme raporu oluşturulunca 1 sayar (rapor kimliği ile idempotent). Asla fırlatmaz. */
export async function countValuationReport(input: {
  tenantId: string;
  actorId?: string | null;
  valuationId: string;
}): Promise<MeterResult> {
  try {
    if (!input.tenantId) return NOT_METERED();
    const quotas = await getTenantQuotas(input.tenantId);
    return await charge({
      tenantId: input.tenantId,
      actorId: input.actorId,
      unit: VALUATION_LEDGER_UNIT,
      amount: 1,
      feature: "valuation_report",
      quota: quotas.valuation,
      idempotencyKey: `valuation:${input.valuationId}`,
    });
  } catch (e) {
    console.error("ai-credits countValuationReport", e);
    return NOT_METERED(1);
  }
}
