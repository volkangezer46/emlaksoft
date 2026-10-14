import { z } from "zod";

/**
 * ÖZELLİK BAYRAĞI HEDEFLEME (saf; DG8). Kural deposu `feature_flag_rules` (bayrak başına tek satır), okuyucu
 * `./rules.ts`, değerlendirme kapısı `isFeatureEnabled(key, target)` (`./server.ts`). Bayrak ENVANTERİ değişmez:
 * hangi bayrakların hedeflenebildiği `registry.ts`'teki `targetable` alanıdır (tek kaynak).
 *
 * Anlam (güvenli yayın):
 *  - Genel anahtar KAPALI → herkes kapalı (hedefleme etkisiz; kill switch).
 *  - Genel anahtar açık + kural YOK → herkes açık (bugünkü davranış).
 *  - Genel anahtar açık + kural VAR → yalnız kurala uyan ofislerde, yalnız zaman penceresi içinde açık.
 * Kurala uyma: pencere içinde VE (ofis listesinde VEYA [plan süzgecine uyar VE yüzde kovasında]).
 * Yüzde kovası `flagBucket(bayrak, ofis)` = FNV-1a 32 bit % 100: aynı ofis aynı bayrakta HEP aynı kovadadır
 * (kararlı); yüzde büyütülünce önceden açık ofisler açık kalır (kova < yüzde), farklı bayraklar bağımsız dağılır.
 */

export const FLAG_RULE_PLANS = ["advisor", "office", "professional", "business", "enterprise"] as const;
export type FlagRulePlan = (typeof FLAG_RULE_PLANS)[number];

export type FlagRule = {
  flagKey: string;
  tenantIds: readonly string[];
  plans: readonly string[];
  /** 0-100: plan süzgecine uyan ofislerin yüzdesi (0 = yalnız ofis listesi). */
  percentage: number;
  startsAt: string | null;
  endsAt: string | null;
  note?: string | null;
};

export type FlagTarget = { tenantId: string; plan: string | null };

/** FNV-1a (32 bit) → 0..99. Saf ve platformdan bağımsız (Node/tarayıcı aynı sonucu verir). */
export function flagBucket(flagKey: string, tenantId: string): number {
  const input = `${flagKey}:${tenantId.toLowerCase()}`;
  let h = 0x811c9dc5;
  for (let i = 0; i < input.length; i++) {
    h ^= input.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return (h >>> 0) % 100;
}

const ms = (iso: string | null): number | null => {
  if (!iso) return null;
  const t = new Date(iso).getTime();
  return Number.isFinite(t) ? t : null;
};

/** Kural şu an zaman penceresinin içinde mi (başlangıç dahil, bitiş hariç; boş uç = sınırsız). */
export function ruleInWindow(rule: Pick<FlagRule, "startsAt" | "endsAt">, nowMs: number): boolean {
  const s = ms(rule.startsAt);
  const e = ms(rule.endsAt);
  if (s !== null && nowMs < s) return false;
  if (e !== null && nowMs >= e) return false;
  return true;
}

/** Ofis kurala uyuyor mu (pencere dahil). */
export function ruleMatchesTarget(rule: FlagRule, target: FlagTarget, nowMs: number): boolean {
  if (!ruleInWindow(rule, nowMs)) return false;
  const id = target.tenantId.toLowerCase();
  if (rule.tenantIds.some((t) => t.toLowerCase() === id)) return true;
  if (rule.plans.length > 0 && !rule.plans.includes(target.plan ?? "")) return false;
  return rule.percentage > 0 && flagBucket(rule.flagKey, target.tenantId) < rule.percentage;
}

/** Son karar: genel anahtar + (varsa) kural. Bkz. dosya başı "Anlam". */
export function evaluateTargeted(input: { globalOn: boolean; rule: FlagRule | null | undefined; target: FlagTarget; nowMs: number }): boolean {
  if (!input.globalOn) return false;
  if (!input.rule) return true;
  return ruleMatchesTarget(input.rule, input.target, input.nowMs);
}

const PLAN_LABEL: Record<string, string> = {
  advisor: "Danışman",
  office: "Ofis",
  professional: "Profesyonel",
  business: "İşletme",
  enterprise: "Kurumsal",
};

/** Kısa Türkçe özet ("3 seçili ofis · Profesyonel planında %10 · 14.10.2026 – 20.10.2026"). */
export function describeFlagRule(rule: FlagRule, fmtDate: (iso: string) => string): string {
  const parts: string[] = [];
  if (rule.tenantIds.length) parts.push(`${rule.tenantIds.length} seçili ofis`);
  if (rule.percentage > 0) {
    const plans = rule.plans.map((p) => PLAN_LABEL[p] ?? p).join(", ");
    parts.push(plans ? `${plans} planında %${rule.percentage}` : `tüm ofislerin %${rule.percentage}'i`);
  }
  if (rule.startsAt || rule.endsAt) {
    parts.push(`${rule.startsAt ? fmtDate(rule.startsAt) : "şimdi"} – ${rule.endsAt ? fmtDate(rule.endsAt) : "süresiz"}`);
  }
  return parts.join(" · ");
}

const uuid = z.string().regex(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i);

export const flagRuleInputSchema = z
  .object({
    tenantIds: z.array(uuid).max(500, "En çok 500 ofis seçilebilir."),
    plans: z.array(z.enum(FLAG_RULE_PLANS)).max(FLAG_RULE_PLANS.length),
    percentage: z.number().int().min(0).max(100),
    startsAt: z.iso.datetime().nullable(),
    endsAt: z.iso.datetime().nullable(),
    note: z.string().trim().max(300).nullable(),
  })
  .strict();

export type FlagRuleInput = z.infer<typeof flagRuleInputSchema>;

/** Kural girdisini doğrular (DB CHECK'leriyle aynı kurallar; hatalar Türkçe). */
export function validateFlagRuleInput(raw: unknown): { ok: true; value: FlagRuleInput } | { ok: false; error: string } {
  const r = flagRuleInputSchema.safeParse(raw);
  if (!r.success) return { ok: false, error: r.error.issues[0]?.message?.startsWith("En çok") ? r.error.issues[0].message : "Hedefleme kuralı geçersiz." };
  const v = r.data;
  const tenantIds = [...new Set(v.tenantIds.map((t) => t.toLowerCase()))];
  if (tenantIds.length === 0 && v.percentage === 0) return { ok: false, error: "Hedef boş: en az bir ofis seçin ya da yüzde girin." };
  if (v.plans.length > 0 && v.percentage === 0) return { ok: false, error: "Plan seçtiyseniz o planlardaki ofislerin yüzde kaçında açılacağını girin." };
  if (v.startsAt && v.endsAt && new Date(v.endsAt).getTime() <= new Date(v.startsAt).getTime()) return { ok: false, error: "Bitiş, başlangıçtan sonra olmalı." };
  return { ok: true, value: { ...v, tenantIds, plans: [...new Set(v.plans)], note: v.note || null } };
}
