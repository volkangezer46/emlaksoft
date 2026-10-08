/**
 * Plan kontör hakkı (EmlakFiyati) — SAF yardımcılar (DB yok, sunucu/istemci güvenli).
 * Tarife `config.ts`ten gelir (sabit yok); aylık hak plan tanımındaki `efCreditsMonthly` alanıdır.
 * Hak verme mantığı cron'da (`api/cron/ef-kontor-hak`), burada yalnız karar/anahtar/metin üretimi vardır.
 */
// Yalnız TÜR import: istemci paketine zod/config girmesin (public plan kartı bu dosyayı kullanır).
import type { EfTariff } from "@/lib/ef-credits/config";

/**
 * Hibe değerlendirmesine giren abonelik durumları (past_due/paused/cancelled HİÇ hak almaz).
 * trialing yalnız HOŞ GELDİN kontörü alabilir; AYLIK plan hakkı için bkz. EF_MONTHLY_SUBSCRIPTION_STATUSES.
 */
export const EF_GRANT_SUBSCRIPTION_STATUSES = ["trialing", "active"] as const;
/** AYLIK plan hakkı (ve ek kullanıcı kontörü) yalnız ilk gerçek ödemeden sonra: deneme (trialing) almaz. */
export const EF_MONTHLY_SUBSCRIPTION_STATUSES = ["active"] as const;

/** Plan kontörü devir tavanı: en çok bu kadar AYLIK hak birikir (satın alınan paket/hoş geldin/admin kontörü hariç, süresiz). */
export const EF_PLAN_CARRY_MONTHS = 3;

/** Devir tavanı (kontör): aylık hak x EF_PLAN_CARRY_MONTHS; hak yoksa 0. */
export function planCarryCap(monthlyUnits: number): number {
  return monthlyUnitsOf(monthlyUnits) * EF_PLAN_CARRY_MONTHS;
}

/**
 * `ef_credit_expire_plan` SQL hesabının SAF karşılığı (sözleşme testi için): plan grantları ilk tüketilir varsayımı.
 * planKalan = min(max(available,0), max(planGrant - usageSpend - expired, 0)); düşülecek = max(planKalan - keep, 0).
 */
export function planExpiryAmount(input: { available: number; planGranted: number; usageSpent: number; expired: number; keep: number }): number {
  const left = Math.min(Math.max(input.available, 0), Math.max(input.planGranted - input.usageSpent - input.expired, 0));
  return Math.max(left - Math.max(input.keep, 0), 0);
}

/** Aynı ay içinde plan yükseltmesi (ya da ek kullanıcı) farkı: `plan:<tenant>:<YYYY-MM>:delta:<yeniHak>`. */
export function planDeltaIdempotencyKey(tenantId: string, monthKey: string, newMonthlyUnits: number): string {
  return `${planMonthlyIdempotencyKey(tenantId, monthKey)}:delta:${newMonthlyUnits}`;
}

/** Ay devir tavanı çağrısı anahtarı (ledger: `ef:expire:<tenant>:<bu>`). */
export function planExpireIdempotencyKey(monthKey: string): string {
  return `plan-expire:${monthKey}`;
}

/** Ledger'a yazılan gerçek hibe anahtarı (`ef_credit_grant` tenant önekler) — ön eleme sorguları için. */
export function ledgerGrantKey(tenantId: string, idem: string): string {
  return `ef:grant:${tenantId}:${idem}`;
}
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

/**
 * Bir değerlemenin giriş kontör bedeli = en ucuz (0 olmayan) rapor bedeli (varsayılanda konut 700); config'i istemciye
 * çekmemek için alanlar doğrudan okunur. Ticari alanı eski çağıranlarda olmayabilir.
 */
export function valuationUnitCost(tariff: Pick<EfTariff, "valuationArsa"> & Partial<Pick<EfTariff, "valuationKonut" | "valuationTicari">>): number {
  const costs = [tariff.valuationKonut, tariff.valuationArsa, tariff.valuationTicari].filter((n): n is number => typeof n === "number" && n > 0);
  return costs.length > 0 ? Math.min(...costs) : 0;
}

/** "Yaklaşık N değerleme": floor(units / değerleme bedeli). Bedel 0 ise hesaplanamaz (null). */
export function approxValuations(units: number, tariff: Parameters<typeof valuationUnitCost>[0]): number | null {
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
  /** tenants.created_at (ISO). Hoş geldin yalnız `welcomeSinceMs` ve sonrası açılan ofislere verilir. */
  tenantCreatedAt?: string | null;
};

export type EfGrantPlanEntry = {
  tenantId: string;
  kind: "plan_monthly" | "bonus";
  units: number;
  idempotencyKey: string;
  /** Aynı ay içi yükseltme farkı (tam aylık hibe değil). */
  delta?: boolean;
};
export type EfGrantSkipReason = "abonelik_uygun_degil" | "modul_kapali" | "plan_hakki_yok";

export type EfGrantDecision = {
  grants: EfGrantPlanEntry[];
  skipped: { tenantId: string; reason: EfGrantSkipReason }[];
};

/** Hoş geldin geriye dönük dağıtılmaz: ofis `welcomeSinceMs` ve sonrasında açılmış olmalı (ayar yok/geçersiz = kimse). */
export function welcomeEligible(createdAt: string | null | undefined, welcomeSinceMs: number | null | undefined): boolean {
  if (welcomeSinceMs == null || !createdAt) return false;
  const t = Date.parse(createdAt);
  return Number.isFinite(t) && t >= welcomeSinceMs;
}

/**
 * Hangi ofise hangi hibe:
 * - Hoş geldin (`welcomeUnits` > 0, tek sefer `welcome:<tenant>`): trialing/active abonelik + ofis trial/active,
 *   YALNIZ `welcomeSinceMs` sonrası açılan ofisler (geriye dönük yok).
 * - AYLIK plan hakkı (+ ek kullanıcı kontörü): yalnız `active` abonelik (ilk gerçek ödemeden sonra); deneme almaz.
 *   Ay içinde ilk hibe `plan:<tenant>:<ay>`; aynı ay güncel hak o ay verilenden büyükse (yükseltme/ek kullanıcı) pozitif FARK
 *   `plan:<tenant>:<ay>:delta:<yeniHak>` ile verilir. Düşürmede geri alma YOK.
 *   `monthGranted` (tenant -> o ay verilen plan kontörü toplamı) verilmezse yalnız `monthlyGranted` ön elemesi kullanılır (fark yok).
 * valuation modülü kapalı ofis hak almaz.
 */
export function decideGrants(input: {
  candidates: readonly EfGrantCandidate[];
  monthKey: string;
  planMonthly: Readonly<Record<string, number | null | undefined>>;
  /** Plan başına ek kullanıcı başı aylık hak (yoksa ek kullanıcı hakkı verilmez). */
  planPerExtraSeat?: Readonly<Record<string, number | null | undefined>>;
  welcomeUnits: number;
  /** ef.welcome_since (epoch ms); null/yok = hoş geldin kimseye verilmez. */
  welcomeSinceMs?: number | null;
  welcomeGranted: ReadonlySet<string>;
  monthlyGranted?: ReadonlySet<string>;
  monthGranted?: ReadonlyMap<string, number>;
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
    const monthlyOk = (EF_MONTHLY_SUBSCRIPTION_STATUSES as readonly string[]).includes(c.subscriptionStatus);
    const units = monthlyOk ? monthlyUnitsWithSeats(input.planMonthly[c.plan], input.planPerExtraSeat?.[c.plan], c.extraSeats) : 0;
    const welcomeOk = input.welcomeUnits > 0 && welcomeEligible(c.tenantCreatedAt, input.welcomeSinceMs);
    if (units > 0) {
      const baseKey = planMonthlyIdempotencyKey(c.tenantId, input.monthKey);
      if (input.monthGranted) {
        const granted = input.monthGranted.get(c.tenantId) ?? 0;
        if (granted <= 0) {
          out.grants.push({ tenantId: c.tenantId, kind: "plan_monthly", units, idempotencyKey: baseKey });
        } else if (units > granted) {
          out.grants.push({
            tenantId: c.tenantId,
            kind: "plan_monthly",
            units: units - granted,
            idempotencyKey: planDeltaIdempotencyKey(c.tenantId, input.monthKey, units),
            delta: true,
          });
        }
      } else if (!input.monthlyGranted?.has(baseKey)) {
        out.grants.push({ tenantId: c.tenantId, kind: "plan_monthly", units, idempotencyKey: baseKey });
      }
    } else if (!welcomeOk) {
      out.skipped.push({ tenantId: c.tenantId, reason: "plan_hakki_yok" });
    }
    const wKey = welcomeIdempotencyKey(c.tenantId);
    if (welcomeOk && !input.welcomeGranted.has(wKey)) {
      out.grants.push({ tenantId: c.tenantId, kind: "bonus", units: input.welcomeUnits, idempotencyKey: wKey });
    }
  }
  return out;
}