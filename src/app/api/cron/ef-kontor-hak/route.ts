import { NextRequest, NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { recordHeartbeat } from "@/lib/cron-heartbeat";
import { trMonthKey } from "@/lib/clock";
import { getPlatformSettingsMany } from "@/lib/platform-settings";
import { PLAN_DEFINITIONS_SETTING_KEY, applyPlanOverrides, resolveCatalogSettings } from "@/lib/billing/plan-overrides";
import { EF_RPC, EF_UNIT, EF_WELCOME_SETTING_KEY, parseEfWelcomeUnits, type EfGrantResult } from "@/lib/ef-credits/config";
import {
  EF_GRANT_SUBSCRIPTION_STATUSES,
  decideGrants,
  monthlyUnitsOf,
  planMonthlyIdempotencyKey,
  welcomeIdempotencyKey,
  type EfGrantCandidate,
  type EfGrantPlanEntry,
} from "@/lib/ef-credits/plan-credits";
import { getDisabledModulesByTenant, isDisabledFor } from "@/lib/modules/state";

export const maxDuration = 300;

const PAGE = 1000;
const CHUNK = 200;
const CONCURRENCY = 8;

function authorized(req: NextRequest) {
  const secret = process.env.CRON_SECRET?.trim();
  if (!secret) return process.env.NODE_ENV !== "production";
  return req.headers.get("authorization") === `Bearer ${secret}`;
}

function chunks<T>(items: readonly T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size));
  return out;
}

/**
 * Aylık EmlakFiyati kontör hakkı (günlük çalışır; ay içinde ikinci kez hak vermez).
 *
 * - Yalnız trialing/active abonelik (+ ofis trial/active) ve "valuation" modülü açık ofisler hak alır;
 *   past_due/askıda/iptal/duraklatılmış ofis ALMAZ.
 * - Plan `efCreditsMonthly` > 0 ise `ef_credit_grant(kind 'plan_monthly', idem 'plan:<tenant>:<YYYY-MM>')` (TR ay anahtarı).
 * - Hoş geldin (ayar `ef.welcome_units`, 0 = kapalı): `welcome:<tenant>` anahtarıyla TEK SEFER `bonus`.
 * - Kontör cüzdanı (`ef_credit_ready()`) hazır değilse HİÇ hibe yapılmaz ("atlandı"), hata verilmez.
 * - Kullanılmayan kontör süresiz devreder; plan yükseltmede ara hak verilmez.
 */
export async function GET(req: NextRequest) {
  if (!authorized(req)) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const admin = createAdminClient();

  try {
    const ready = await admin.rpc("ef_credit_ready");
    if (ready.error || ready.data !== true) {
      await recordHeartbeat("ef-kontor-hak", "ok", "atlandı: cüzdan hazır değil");
      return NextResponse.json({ ok: true, skipped: true, reason: "wallet_not_ready" });
    }

    const settings = await getPlatformSettingsMany([PLAN_DEFINITIONS_SETTING_KEY, EF_WELCOME_SETTING_KEY]);
    const defs = applyPlanOverrides(resolveCatalogSettings(settings[PLAN_DEFINITIONS_SETTING_KEY]).overrides);
    const planMonthly: Record<string, number> = {};
    for (const p of defs) planMonthly[p.id] = monthlyUnitsOf(p.efCreditsMonthly);
    const welcomeUnits = parseEfWelcomeUnits(settings[EF_WELCOME_SETTING_KEY]);
    const monthKey = trMonthKey();

    // Uygun abonelikler (sayfalı).
    const subs: { tenant_id: string; plan: string; status: string }[] = [];
    for (let from = 0; ; from += PAGE) {
      const { data, error } = await admin
        .from("subscriptions")
        .select("tenant_id, plan, status")
        .in("status", [...EF_GRANT_SUBSCRIPTION_STATUSES])
        .order("tenant_id", { ascending: true })
        .range(from, from + PAGE - 1);
      if (error) throw new Error(`subscriptions: ${error.message}`);
      subs.push(...((data ?? []) as typeof subs));
      if (!data || data.length < PAGE) break;
    }

    // Ofis durumu (askıda/iptal/gecikmiş ofis hak almaz) ve kapalı modüller.
    const tenantStatus = new Map<string, string>();
    for (const ids of chunks(subs.map((s) => s.tenant_id), CHUNK)) {
      const { data, error } = await admin.from("tenants").select("id, status").in("id", ids);
      if (error) throw new Error(`tenants: ${error.message}`);
      for (const t of (data ?? []) as { id: string; status: string }[]) tenantStatus.set(t.id, t.status);
    }
    const disabled = await getDisabledModulesByTenant(admin);

    const candidates: EfGrantCandidate[] = subs.map((s) => ({
      tenantId: s.tenant_id,
      plan: s.plan,
      subscriptionStatus: s.status,
      tenantStatus: tenantStatus.get(s.tenant_id) ?? "",
      valuationClosed: isDisabledFor(disabled, s.tenant_id, "valuation"),
    }));

    // Ön eleme (yalnız performans): zaten yazılmış anahtarlar. Okunamazsa RPC idempotency'si korur.
    const alreadyKeys = new Set<string>();
    const wantedKeys = candidates.flatMap((c) => [planMonthlyIdempotencyKey(c.tenantId, monthKey), welcomeIdempotencyKey(c.tenantId)]);
    for (const keys of chunks(wantedKeys, CHUNK)) {
      const { data, error } = await admin.from("account_credit_ledger").select("idempotency_key").in("idempotency_key", keys);
      if (error) break;
      for (const r of (data ?? []) as { idempotency_key: string }[]) alreadyKeys.add(r.idempotency_key);
    }

    const decision = decideGrants({
      candidates,
      monthKey,
      planMonthly,
      welcomeUnits,
      welcomeGranted: alreadyKeys,
      monthlyGranted: alreadyKeys,
    });

    let granted = 0;
    let already = 0;
    let failed = 0;
    let units = 0;
    const grantedTenants = new Set<string>();

    async function run(entry: EfGrantPlanEntry) {
      const { data, error } = await admin.rpc(EF_RPC.grant, {
        p_tenant: entry.tenantId,
        p_units: entry.units,
        p_kind: entry.kind,
        p_idem: entry.idempotencyKey,
        p_meta: { source: "ef-kontor-hak", unit: EF_UNIT, month: monthKey },
      });
      const result = (data ?? null) as EfGrantResult | null;
      if (error || !result || result.ok !== true) {
        failed += 1;
        return;
      }
      if (result.already) {
        already += 1;
        return;
      }
      granted += 1;
      units += entry.units;
      grantedTenants.add(entry.tenantId);
    }

    for (const batch of chunks(decision.grants, CONCURRENCY)) await Promise.all(batch.map(run));

    const skippedModule = decision.skipped.filter((s) => s.reason === "modul_kapali").length;
    const skippedOther = decision.skipped.length - skippedModule;
    const detail = `${grantedTenants.size} ofis, ${units} kontör, ${granted} hibe, ${already + alreadyKeys.size} zaten verilmiş, ${skippedModule + skippedOther} atlandı (${skippedModule} modül kapalı), ${failed} hata`;
    await recordHeartbeat("ef-kontor-hak", failed > 0 ? "error" : "ok", detail);
    return NextResponse.json({
      ok: failed === 0,
      month: monthKey,
      offices: grantedTenants.size,
      units,
      grants: granted,
      already: already + alreadyKeys.size,
      skipped: decision.skipped.length,
      skippedModuleClosed: skippedModule,
      failed,
    });
  } catch (err) {
    console.error("cron ef-kontor-hak", err);
    await recordHeartbeat("ef-kontor-hak", "error", "hak verme başarısız");
    return NextResponse.json({ error: "grant_failed" }, { status: 500 });
  }
}
