/**
 * Plan kontör hakkı (EmlakFiyati) — SAF yardımcılar (DB yok, sunucu/istemci güvenli).
 * Tarife `config.ts`ten gelir (sabit yok); aylık hak plan tanımındaki `efCreditsMonthly` alanıdır.
 * Hak verme mantığı cron'da (`api/cron/ef-kontor-hak`), burada yalnız karar/anahtar/metin üretimi vardır.
 */
// Yalnız TÜR import: istemci paketine zod/config girmesin (public plan kartı bu dosyayı kullanır).
import type { EfTariff } from "@/lib/ef-credits/config";

/** Aylık hak alan abonelik durumları (past_due/paused/cancelled HAK ALMAZ). */
export const EF_GRANT_SUBSCRIPTION_STATUSES = ["trialing", "active"] as const;
/** Aylık hak alan ofis durumları (tenants.status: trial/active; past_due/suspended/cancelled hak almaz). */
export const EF_GRANT_TENANT_STATUSES = ["trial", "active"] as const;

export function planMonthlyIdempotencyKey(tenantId: string, monthKey: string): string {
  return `plan:${tenantId}:${monthKey}`;
}

export function welcomeIdempotencyKey(tenantId: string): string {
  return `welcome:${tenantId}`;
}

/** Plan alanından verilecek aylık kontör (null/0/geçersiz = 0). */
export function monthlyUnitsOf(efCreditsMonthly: number | null | undefined): number {
  return typeof efCreditsMonthly === "number" && Number.isInteger(efCreditsMonthly) && efCreditsMonthly > 0 ? efCreditsMonthly : 0;
}

/**
 * Kullanıcı sayısıyla ölçeklenen aylık hak: plan hakkı + (satın alınan ek kullanıcı x ek kullanıcı başına hak).
 * Plan hakkı 0 ise ek kullanıcı hakkı tek başına verilmez.
 */
export function monthlyUnitsWithSeats(
  efCreditsMonthly: number | null | undefined,
  efCreditsPerExtraSeat: number | null | undefined,
  extraSeats: number | null | undefined,
): number {
  const base = monthlyUnitsOf(efCreditsMonthly);
  if (base === 0) return 0;
  const per = monthlyUnitsOf(efCreditsPerExtraSeat);
  const extra = typeof extraSeats === "number" && Number.isFinite(extraSeats) ? Math.max(0, Math.floor(extraSeats)) : 0;
  return base + per * extra;
}

/** Bir değerlemenin kontör bedeli (= `efUnitsFor("valuation_arsa", tarife)`; config'i istemciye çekmemek için alan doğrudan okunur). */
export function valuationUnitCost(tariff: Pick<EfTariff, "valuationArsa">): number {
  return tariff.valuationArsa;
}

/** "Yaklaşık N değerleme": floor(units / değerleme bedeli). Bedel 0 ise hesaplanamaz (null). */
export function approxValuations(units: number, tariff: Pick<EfTariff, "valuationArsa">): number | null {
  const cost = valuationUnitCost(tariff);
  if (!(units > 0) || cost <= 0) return null;
  return Math.floor(units / cost);
}

/** Public/admin satırı: "Aylık N kontör (yaklaşık M değerleme)"; hak yoksa null (satır gizlenir). */
export function efCreditsLine(
  efCreditsMonthly: number | null | undefined,
  valuationCost: number,
  efCreditsPerExtraSeat?: number | null,
): string | null {
  const n = monthlyUnitsOf(efCreditsMonthly);
  if (n === 0) return null;
  let base = `Aylık ${n.toLocaleString("tr-TR")} kontör`;
  if (valuationCost > 0) {
    const m = Math.floor(n / valuationCost);
    if (m > 0) base = `${base} (yaklaşık ${m.toLocaleString("tr-TR")} değerleme)`;
  }
  const per = monthlyUnitsOf(efCreditsPerExtraSeat);
  return per > 0 ? `${base} + her ek kullanıcı için ${per.toLocaleString("tr-TR")} kontör` : base;
}

export type EfGrantCandidate = {
  tenantId: string;
  plan: string;
  subscriptionStatus: string;
  tenantStatus: string | null;
  /** Ofis "valuation" modülünü kapatmış mı. */
  valuationClosed: boolean;
  /** Satın alınmış ek kullanıcı sayısı (subscriptions.extra_seats; sütun yoksa/okunamazsa 0). */
  extraSeats?: number;
};

export type EfGrantPlanEntry = { tenantId: string; kind: "plan_monthly" | "bonus"; units: number; idempotencyKey: string };
export type EfGrantSkipReason = "abonelik_uygun_degil" | "modul_kapali" | "plan_hakki_yok";

export type EfGrantDecision = {
  grants: EfGrantPlanEntry[];
  skipped: { tenantId: string; reason: EfGrantSkipReason }[];
};

/**
 * Hangi ofise hangi hibe: yalnız trialing/active abonelik (+ ofis trial/active) ve "valuation" modülü açık.
 * Aylık hak: plan `efCreditsMonthly` > 0. Hoş geldin: `welcomeUnits` > 0 (0 = kapalı), tek sefer anahtarıyla
 * (RPC aynı anahtarı tekrar vermez; `welcomeGranted`/`monthlyGranted` yalnız ön eleme içindir).
 * Plan kontör hakkı olmayan paket de hoş geldin alabilir.
 */
export function decideGrants(input: {
  candidates: readonly EfGrantCandidate[];
  monthKey: string;
  planMonthly: Readonly<Record<string, number | null | undefined>>;
  /** Plan başına ek kullanıcı başı aylık hak (yoksa ek kullanıcı hakkı verilmez). */
  planPerExtraSeat?: Readonly<Record<string, number | null | undefined>>;
  welcomeUnits: number;
  welcomeGranted: ReadonlySet<string>;
  monthlyGranted?: ReadonlySet<string>;
}): EfGrantDecision {
  const out: EfGrantDecision = { grants: [], skipped: [] };
  for (const c of input.candidates) {
    const subOk = (EF_GRANT_SUBSCRIPTION_STATUSES as readonly string[]).includes(c.subscriptionStatus);
    const tenantOk = c.tenantStatus === null || (EF_GRANT_TENANT_STATUSES as readonly string[]).includes(c.tenantStatus);
    if (!subOk || !tenantOk) {
      out.skipped.push({ tenantId: c.tenantId, reason: "abonelik_uygun_degil" });
      continue;
    }
    if (c.valuationClosed) {
      out.skipped.push({ tenantId: c.tenantId, reason: "modul_kapali" });
      continue;
    }
    const units = monthlyUnitsWithSeats(input.planMonthly[c.plan], input.planPerExtraSeat?.[c.plan], c.extraSeats);
    const monthlyKey = planMonthlyIdempotencyKey(c.tenantId, input.monthKey);
    if (units > 0 && !input.monthlyGranted?.has(monthlyKey)) {
      out.grants.push({ tenantId: c.tenantId, kind: "plan_monthly", units, idempotencyKey: monthlyKey });
    } else if (units === 0 && !(input.welcomeUnits > 0)) {
      out.skipped.push({ tenantId: c.tenantId, reason: "plan_hakki_yok" });
    }
    const wKey = welcomeIdempotencyKey(c.tenantId);
    if (input.welcomeUnits > 0 && !input.welcomeGranted.has(wKey)) {
      out.grants.push({ tenantId: c.tenantId, kind: "bonus", units: input.welcomeUnits, idempotencyKey: wKey });
    }
  }
  return out;
}
