import { NextRequest, NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { recordHeartbeat } from "@/lib/cron-heartbeat";
import { trMonthKey } from "@/lib/clock";
import { getPlatformSettingsMany } from "@/lib/platform-settings";
import { PLAN_DEFINITIONS_SETTING_KEY, applyPlanOverrides, resolveCatalogSettings } from "@/lib/billing/plan-overrides";
import {
  EF_RPC,
  EF_RPC_BURN_EXPIRED,
  EF_UNIT,
  EF_WELCOME_SETTING_KEY,
  EF_WELCOME_SINCE_SETTING_KEY,
  parseEfWelcomeSince,
  parseEfWelcomeUnits,
  type EfBurnResult,
  type EfGrantResult,
} from "@/lib/ef-credits/config";
import {
  EF_GRANT_SUBSCRIPTION_STATUSES,
  EF_MONTHLY_SUBSCRIPTION_STATUSES,
  decideGrants,
  ledgerGrantKey,
  monthlyUnitsOf,
  planMonthlyIdempotencyKey,
  welcomeIdempotencyKey,
  type EfGrantCandidate,
  type EfGrantPlanEntry,
} from "@/lib/ef-credits/plan-credits";
import { getDisabledModulesByTenant, isDisabledFor } from "@/lib/modules/state";
import { authorizeCron } from "@/lib/cron-auth";

export const maxDuration = 300;

const PAGE = 1000;
const CHUNK = 200;
const CONCURRENCY = 8;
/** Tek koşuda yakılacak en çok parti sayısı (kalan sonraki günkü koşuya). */
const BURN_LIMIT = 2000;

function chunks<T>(items: readonly T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size));
  return out;
}

/**
 * Aylık EmlakFiyati kontör hakkı (günlük çalışır; ay içinde ikinci kez hak vermez).
 *
 * - Hoş geldin + aylık hak değerlendirmesine yalnız trialing/active abonelik (+ ofis trial/active) ve "valuation" modülü
 *   açık ofisler girer; past_due/askıda/iptal/duraklatılmış ofis ALMAZ.
 * - AYLIK plan hakkı (+ ek kullanıcı kontörü) yalnız `active` abonelikte (ilk gerçek ödemeden sonra); deneme (trialing) almaz.
 *   Plan `efCreditsMonthly` > 0 ise `ef_credit_grant(kind 'plan_monthly', idem 'plan:<tenant>:<YYYY-MM>')` (TR ay anahtarı).
 *   Aynı ay yükseltmede güncel hak ile o ay verilen toplam arasındaki pozitif fark `plan:<t>:<ay>:delta:<yeniHak>` ile verilir.
 * - Hoş geldin (ayar `ef.welcome_units`, 0 = kapalı): `welcome:<tenant>` anahtarıyla TEK SEFER `bonus`; yalnız
 *   `tenants.created_at >= ef.welcome_since` ofislere (geriye dönük dağıtım yok; ayar yoksa kimse almaz).
 * - SÜRELİ KONTÖR (20261010000300): her hibe bir parti (lot) olur. Aylık plan hakkı TR ay sonunda, hoş geldin
 *   kontörü 30 gün sonra (EF_WELCOME_VALID_DAYS), paket seçilen süre sonunda yanar (devretmez). Cron'un son adımı
 *   `ef_credit_burn_expired` suresi dolmuş partileri defterde "expire" satırıyla yakar (idempotent; şema yoksa atlanır,
 *   hata cron'u düşürmez). Eski "3 aylık devir tavanı" kaldırıldı.
 * - Kontör cüzdanı (`ef_credit_ready()`) hazır değilse HİÇ hibe yapılmaz ("atlandı"), hata verilmez.
 */
export async function GET(req: NextRequest) {
  const denied = authorizeCron(req);
  if (denied) return denied;

  const admin = createAdminClient();

  try {
    const ready = await admin.rpc("ef_credit_ready");
    if (ready.error || ready.data !== true) {
      await recordHeartbeat("ef-kontor-hak", "ok", "atlandı: cüzdan hazır değil");
      return NextResponse.json({ ok: true, skipped: true, reason: "wallet_not_ready" });
    }

    const settings = await getPlatformSettingsMany([PLAN_DEFINITIONS_SETTING_KEY, EF_WELCOME_SETTING_KEY, EF_WELCOME_SINCE_SETTING_KEY]);
    const defs = applyPlanOverrides(resolveCatalogSettings(settings[PLAN_DEFINITIONS_SETTING_KEY]).overrides);
    const planMonthly: Record<string, number> = {};
    const planPerExtraSeat: Record<string, number> = {};
    for (const p of defs) {
      planMonthly[p.id] = monthlyUnitsOf(p.efCreditsMonthly);
      planPerExtraSeat[p.id] = monthlyUnitsOf(p.efCreditsPerExtraSeat);
    }
    const welcomeUnits = parseEfWelcomeUnits(settings[EF_WELCOME_SETTING_KEY]);
    // Geriye dönük hoş geldin YOK: ayar yoksa/geçersizse null (kimse almaz).
    const welcomeSinceMs = parseEfWelcomeSince(settings[EF_WELCOME_SINCE_SETTING_KEY]);
    const monthKey = trMonthKey();

    // Uygun abonelikler (sayfalı).
    // extra_seats (koltuk satışı migration'ı) henüz uygulanmamış olabilir: önce sütunla denenir, sütun yoksa 0 sayılır.
    const subs: { tenant_id: string; plan: string; status: string; extra_seats?: number | null }[] = [];
    let withExtraSeats = true;
    type SubPage = { data: unknown[] | null; error: { message: string } | null };
    const fetchSubs = async (from: number, extra: boolean): Promise<SubPage> => {
      const base = admin.from("subscriptions");
      const q = extra ? base.select("tenant_id, plan, status, extra_seats") : base.select("tenant_id, plan, status");
      return (await q
        .in("status", [...EF_GRANT_SUBSCRIPTION_STATUSES])
        .order("tenant_id", { ascending: true })
        .range(from, from + PAGE - 1)) as unknown as SubPage;
    };
    for (let from = 0; ; from += PAGE) {
      let res = await fetchSubs(from, withExtraSeats);
      if (res.error && withExtraSeats) {
        withExtraSeats = false;
        res = await fetchSubs(from, false);
      }
      if (res.error) throw new Error(`subscriptions: ${res.error.message}`);
      const rows = (res.data ?? []) as unknown as typeof subs;
      subs.push(...rows);
      if (rows.length < PAGE) break;
    }

    // Ofis durumu (askıda/iptal/gecikmiş ofis hak almaz) ve kapalı modüller.
    const tenantStatus = new Map<string, string>();
    const tenantCreated = new Map<string, string>();
    for (const ids of chunks(subs.map((s) => s.tenant_id), CHUNK)) {
      const { data, error } = await admin.from("tenants").select("id, status, created_at").in("id", ids);
      if (error) throw new Error(`tenants: ${error.message}`);
      for (const t of (data ?? []) as { id: string; status: string; created_at?: string | null }[]) {
        tenantStatus.set(t.id, t.status);
        if (t.created_at) tenantCreated.set(t.id, t.created_at);
      }
    }
    const disabled = await getDisabledModulesByTenant(admin);

    const candidates: EfGrantCandidate[] = subs.map((s) => ({
      tenantId: s.tenant_id,
      plan: s.plan,
      subscriptionStatus: s.status,
      tenantStatus: tenantStatus.get(s.tenant_id) ?? "",
      valuationClosed: isDisabledFor(disabled, s.tenant_id, "valuation"),
      extraSeats: typeof s.extra_seats === "number" ? s.extra_seats : 0,
      tenantCreatedAt: tenantCreated.get(s.tenant_id) ?? null,
    }));

    // Ön eleme (yalnız performans): zaten yazılmış anahtarlar. Okunamazsa RPC idempotency'si korur.
    const alreadyKeys = new Set<string>();
    const wantedKeys = candidates.flatMap((c) => [
      ledgerGrantKey(c.tenantId, planMonthlyIdempotencyKey(c.tenantId, monthKey)),
      ledgerGrantKey(c.tenantId, welcomeIdempotencyKey(c.tenantId)),
    ]);
    for (const keys of chunks(wantedKeys, CHUNK)) {
      const { data, error } = await admin.from("account_credit_ledger").select("idempotency_key").in("idempotency_key", keys);
      if (error) break;
      for (const r of (data ?? []) as { idempotency_key: string }[]) alreadyKeys.add(r.idempotency_key);
    }

    const alreadyIdems = new Set<string>();
    for (const c of candidates) {
      for (const idem of [planMonthlyIdempotencyKey(c.tenantId, monthKey), welcomeIdempotencyKey(c.tenantId)]) {
        if (alreadyKeys.has(ledgerGrantKey(c.tenantId, idem))) alreadyIdems.add(idem);
      }
    }

    // Bu ay verilen plan kontörü toplamı (yükseltme farkı için). Okunamazsa null: fark verilmez, yalnız anahtar ön elemesi.
    const monthGranted = await loadMonthGranted(
      admin,
      candidates.filter((c) => (EF_MONTHLY_SUBSCRIPTION_STATUSES as readonly string[]).includes(c.subscriptionStatus)).map((c) => c.tenantId),
      monthKey,
    );

    const decision = decideGrants({
      candidates,
      monthKey,
      planMonthly,
      planPerExtraSeat,
      welcomeUnits,
      welcomeSinceMs,
      welcomeGranted: alreadyIdems,
      monthlyGranted: alreadyIdems,
      monthGranted: monthGranted ?? undefined,
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

    // SÜRESİ DOLAN PARTİLERİ YAK (ay sonu plan hakkı, 30 günlük hoş geldin, süresi bitmiş paketler). Hibelerden SONRA çalışır;
    // şema/RPC yoksa (20261010000300 uygulanmamış) sessizce atlanır, hata cron'u düşürmez.
    let burnedUnits = 0;
    let burnedLots = 0;
    let burnFailed = 0;
    try {
      const res = await admin.rpc(EF_RPC_BURN_EXPIRED, { p_limit: BURN_LIMIT });
      const out = (res.data ?? null) as EfBurnResult | null;
      if (res.error) {
        // PGRST202 / 42883: fonksiyon yok = eski şema. Diğer hatalar sayılır.
        const missing = res.error.code === "PGRST202" || res.error.code === "42883";
        if (!missing) burnFailed += 1;
      } else if (out && out.ok === true) {
        burnedUnits = Math.max(0, Number(out.burned_units) || 0);
        burnedLots = Math.max(0, Number(out.burned_lots) || 0);
      }
    } catch {
      burnFailed += 1;
    }

    const skippedModule = decision.skipped.filter((s) => s.reason === "modul_kapali").length;
    const skippedOther = decision.skipped.length - skippedModule;
    const detail = `${grantedTenants.size} ofis, ${units} kontör, ${granted} hibe, ${already + alreadyKeys.size} zaten verilmiş, ${skippedModule + skippedOther} atlandı (${skippedModule} modül kapalı), ${failed} hata, ${burnedUnits} kontör süresi dolduğu için yandı (${burnedLots} parti)${burnFailed > 0 ? `, ${burnFailed} yakma hatası` : ""}`;
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
      burnedUnits,
      burnedLots,
      burnFailed,
    });
  } catch (err) {
    console.error("cron ef-kontor-hak", err);
    await recordHeartbeat("ef-kontor-hak", "error", "hak verme başarısız");
    return NextResponse.json({ error: "grant_failed" }, { status: 500 });
  }
}

/**
 * Bu ay (TR ay anahtarı) verilen PLAN kontörü toplamı (tenant -> kontör): tam hibe `plan:<t>:<ay>` + yükseltme farkları
 * `plan:<t>:<ay>:delta:<n>`. Okunamazsa null (çağıran fark vermez; yalnız idempotency ön elemesi kalır).
 */
async function loadMonthGranted(
  admin: ReturnType<typeof createAdminClient>,
  tenantIds: readonly string[],
  monthKey: string,
): Promise<Map<string, number> | null> {
  const out = new Map<string, number>();
  for (const ids of chunks(tenantIds, CHUNK)) {
    const { data, error } = await admin
      .from("account_credit_ledger")
      .select("tenant_id, amount, idempotency_key")
      .eq("unit", EF_UNIT)
      .eq("source", "plan")
      .like("idempotency_key", `%:${monthKey}%`)
      .in("tenant_id", ids);
    if (error) return null;
    for (const r of (data ?? []) as { tenant_id: string; amount: number | string; idempotency_key: string }[]) {
      const base = ledgerGrantKey(r.tenant_id, planMonthlyIdempotencyKey(r.tenant_id, monthKey));
      if (r.idempotency_key !== base && !r.idempotency_key.startsWith(`${base}:delta:`)) continue;
      out.set(r.tenant_id, (out.get(r.tenant_id) ?? 0) + (Number(r.amount) || 0));
    }
  }
  return out;
}