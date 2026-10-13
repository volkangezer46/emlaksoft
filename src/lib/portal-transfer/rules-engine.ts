import type { FillPlan, FieldReport } from "./fill-plan";
import { isRuleSetExpired, validateRuleSet, type RuleSet } from "./rule-format";

/**
 * KURAL MOTORU SEÇİMLERİ (SAF, testli). Popup kuralları kullanmadan önce İKİNCİ kez savunur: depodaki set (arka planın
 * kabul ettiği; popup imzayı da yeniden doğrular) katı doğrulayıcıdan geçmezse, süresi dolmuşsa ya da portal uyuşmazsa
 * TOHUM kullanılır. Uzak setle çıkan plan tohum planından belirgin kötüyse (3+ daha az eşleşme) o turda tohum planı seçilir.
 */

export type ResolvedRules = { set: RuleSet; source: "remote" | "seed"; reason: string | null };

export function resolveRules(stored: unknown, seed: RuleSet, opts: { nowMs?: number; installedVersion?: string } = {}): ResolvedRules {
  if (stored === null || stored === undefined) return { set: seed, source: "seed", reason: null };
  const v = validateRuleSet(stored, { allowSeed: false, portal: seed.portal, ...(opts.installedVersion ? { extensionVersion: opts.installedVersion } : {}) });
  if (!v.ok) return { set: seed, source: "seed", reason: v.reason };
  if (opts.nowMs !== undefined && isRuleSetExpired(v.set, opts.nowMs)) return { set: seed, source: "seed", reason: "expired" };
  return { set: v.set, source: "remote", reason: null };
}

/** Planın sayfada BULDUĞU alan sayısı (doldurulan, zaten dolu, seçeneği eşleşmeyen). */
export function matchedCount(plan: Pick<FillPlan, "report">): number {
  return plan.report.filter((r) => r.status === "planned" || r.status === "already_filled" || r.status === "no_option").length;
}

export const REGRESSION_MARGIN = 3;

/**
 * Uzak plan ↔ tohum planı. Uzak plan tohumdan `REGRESSION_MARGIN`+ daha az alan buluyorsa tohum planı kullanılır ve
 * `rulesRegressed` işaretlenir (geri bildirime girer). Aksi halde uzak plan kullanılır; ama tohumun BAŞKA bir denetime
 * atadığı alan (iki set anlaşmıyor) "kontrol edin" (degraded) olarak işaretlenir — yanlış ama çok eşleşen set fark edilsin.
 */
export function pickPlan(remotePlan: FillPlan, seedPlan: FillPlan): FillPlan {
  if (remotePlan === seedPlan || remotePlan.ruleVersion === 0) return remotePlan;
  if (matchedCount(remotePlan) + REGRESSION_MARGIN <= matchedCount(seedPlan)) return { ...seedPlan, rulesRegressed: true };
  const seedIdx = new Map(seedPlan.report.filter((r) => r.idx !== undefined).map((r) => [r.key, r.idx]));
  const report: FieldReport[] = remotePlan.report.map((r) => {
    const s = seedIdx.get(r.key);
    if (r.idx === undefined || s === undefined || s === r.idx || r.state === "disabled") return r;
    return { ...r, state: "degraded" };
  });
  return { ...remotePlan, report, rulesRegressed: false };
}
