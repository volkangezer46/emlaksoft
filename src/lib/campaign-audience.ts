/**
 * Kampanya hedef kitle filtresi — saf ayrıştırıcı (sunucu action'ı, form ve birim test ortak kullanır).
 *
 * Biçimler (SQL tarafı create_campaign_with_recipients ile BİREBİR aynı katılıkta doğrulanır):
 *   all                       → tüm müşteriler
 *   type:alici|satici|kira    → müşteri türü
 *   tag:<etiket>              → etiket (tam eşleşme; 1-30 karakter, kırpılmış, tek boşluk, kontrol karakteri yok)
 *   district:<uuid>           → açık talebi (new/active/matched) bu ilçede olan müşteriler
 *   advisor:<uuid>            → atanmış danışman
 * Kara liste / telefon / İYS izni kapıları filtreden BAĞIMSIZDIR ve her filtrede uygulanır.
 */
import { normalizeTag, TAG_MAX_LEN } from "@/lib/customer-tags-logic";
import { OPEN_DEMAND_STATUSES } from "@/lib/workflow-state";

export const CAMPAIGN_TYPE_FILTERS = ["type:alici", "type:satici", "type:kira"] as const;

/**
 * "type:*" süzgecinin eşleştiği müşteri türü değerleri: kanonik tanım değeri + eski ASCII yazım (SQL tarafı
 * 20261023030000_normalize_customer_types ile BİREBİR; kanonik yazım `customer-types.ts`).
 */
export const CAMPAIGN_TYPE_VALUES: Readonly<Record<"alici" | "satici" | "kira", readonly string[]>> = {
  alici: ["Alıcı", "alici"],
  satici: ["Satıcı", "satici"],
  kira: ["Kiracı", "kiraci"],
};

/** Talep ilçesi filtresinde "açık" sayılan talep durumları (SQL ile aynı liste). */
export const CAMPAIGN_OPEN_DEMAND_STATUSES = OPEN_DEMAND_STATUSES;

export type CampaignAudienceFilter =
  | { kind: "all" }
  | { kind: "type"; value: "alici" | "satici" | "kira" }
  | { kind: "tag"; value: string }
  | { kind: "district"; value: string }
  | { kind: "advisor"; value: string };

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const CONTROL_RE = /[\u0000-\u001f\u007f-\u009f]/;

/** Geçerli bir etiket değeri mi (kayıtlı etiket biçimiyle aynı: normalize edilmiş, 1-30 karakter). */
export function isValidCampaignTag(tag: string): boolean {
  if (!tag || tag.length > TAG_MAX_LEN) return false;
  if (CONTROL_RE.test(tag)) return false;
  return normalizeTag(tag) === tag;
}

/** Filtre metnini doğrular ve ayrıştırır; geçersizse null. Kırpma çağıranındır (action zaten trim eder). */
export function parseCampaignFilter(raw: string): CampaignAudienceFilter | null {
  const value = String(raw ?? "");
  if (value === "all") return { kind: "all" };
  if ((CAMPAIGN_TYPE_FILTERS as readonly string[]).includes(value)) {
    return { kind: "type", value: value.slice(5) as "alici" | "satici" | "kira" };
  }
  if (value.startsWith("tag:")) {
    const tag = value.slice(4);
    return isValidCampaignTag(tag) ? { kind: "tag", value: tag } : null;
  }
  const idx = value.indexOf(":");
  if (idx > 0) {
    const kind = value.slice(0, idx);
    const id = value.slice(idx + 1);
    if ((kind === "district" || kind === "advisor") && UUID_RE.test(id)) return { kind, value: id };
  }
  return null;
}

export function isValidCampaignFilter(raw: string): boolean {
  return parseCampaignFilter(raw) !== null;
}
