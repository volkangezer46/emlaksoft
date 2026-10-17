import { flagBucket, ruleInWindow, type FlagRule, type FlagTarget } from "@/lib/feature-flags/targeting";

/**
 * OFİS BAZINDA BAYRAK AÇIKLAMASI (saf). Ofis 360 > Yönetim "Özellik bayrakları" kartı: her bayrağın BU ofiste açık mı
 * olduğunu ve NEDENİNİ söyler. Karar `evaluateTargeted` (targeting.ts) ile birebir aynıdır; burada yalnız gerekçe
 * metni eklenir (test: aynı sonucu verdiği sınanır).
 */

export type FlagExplainInput = {
  /** Genel anahtar (bağlı bayrak dahil) açık mı. */
  globalOn: boolean;
  /** Bağlı bayrağın kapalı olması yüzünden mi kapalı (yalnız gerekçe için). */
  blockedByRequires?: boolean;
  targetable: boolean;
  rule: FlagRule | null;
  target: FlagTarget;
  nowMs: number;
};

export type FlagReason =
  | "genel_kapali"
  | "bagli_kapali"
  | "herkese_acik"
  | "ofis_listesinde"
  | "plan_disinda"
  | "yuzde_icinde"
  | "yuzde_disinda"
  | "pencere_disinda";

export type FlagExplain = { on: boolean; reason: FlagReason; text: string; inList: boolean; bucket: number | null };

export function explainFlagForOffice(i: FlagExplainInput): FlagExplain {
  const id = i.target.tenantId.toLowerCase();
  const inList = Boolean(i.rule?.tenantIds.some((t) => t.toLowerCase() === id));
  const bucket = i.rule && i.rule.percentage > 0 ? flagBucket(i.rule.flagKey, i.target.tenantId) : null;
  if (!i.globalOn) {
    return i.blockedByRequires
      ? { on: false, reason: "bagli_kapali", text: "Bağlı olduğu bayrak kapalı", inList, bucket }
      : { on: false, reason: "genel_kapali", text: "Genel anahtar kapalı (tüm ofislerde kapalı)", inList, bucket };
  }
  if (!i.targetable || !i.rule) return { on: true, reason: "herkese_acik", text: "Genel anahtar açık, hedefleme yok (tüm ofislerde açık)", inList, bucket };
  if (!ruleInWindow(i.rule, i.nowMs)) return { on: false, reason: "pencere_disinda", text: "Hedefleme kuralı zaman penceresi dışında", inList, bucket };
  if (inList) return { on: true, reason: "ofis_listesinde", text: "Ofis, kuralın seçili ofis listesinde", inList, bucket };
  if (i.rule.plans.length > 0 && !i.rule.plans.includes(i.target.plan ?? "")) {
    return { on: false, reason: "plan_disinda", text: "Ofisin paketi kuralın plan süzgecinde değil", inList, bucket };
  }
  if (i.rule.percentage > 0 && bucket !== null && bucket < i.rule.percentage) {
    return { on: true, reason: "yuzde_icinde", text: `Kademeli açılımın %${i.rule.percentage} diliminde (ofis dilimi ${bucket})`, inList, bucket };
  }
  return {
    on: false,
    reason: "yuzde_disinda",
    text: i.rule.percentage > 0 ? `Kademeli açılımın %${i.rule.percentage} dilimi dışında (ofis dilimi ${bucket})` : "Kural yalnız seçili ofislerde açık; bu ofis listede değil",
    inList,
    bucket,
  };
}

/** Ofisi kuralın seçili ofis listesine ekler / çıkarır (yinelenen ve büyük-küçük harf farkı temizlenir). */
export function toggleTenantInList(list: readonly string[], tenantId: string, include: boolean): string[] {
  const id = tenantId.toLowerCase();
  const rest = list.filter((t) => t.toLowerCase() !== id);
  return include ? [...rest, tenantId] : rest;
}
