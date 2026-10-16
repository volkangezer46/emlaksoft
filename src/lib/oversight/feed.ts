import { financePath } from "@/lib/finance/routes";
import { actionLabel } from "@/lib/audit-labels";

/**
 * Danisman islem akisi — kategori sozlugu ve etiketler (SAF).
 * Akis, mevcut `audit_logs` uzerinden okunur (yeni kayit sistemi YOK); filtreleme
 * mantigi `src/lib/audit-filters.ts` ile ortaktir, kategori burada eklenir.
 */

export type FeedCategoryId =
  | "ilan"
  | "musteri"
  | "talep"
  | "randevu"
  | "anlasma"
  | "komisyon"
  | "belge"
  | "export"
  | "devir"
  | "onay"
  | "ekip"
  | "guvenlik";

export type FeedCategory = {
  id: FeedCategoryId;
  label: string;
  /** PostgREST `like` kaliplari ("*" joker): action kolonu. */
  patterns: readonly string[];
};

/** Sira onemli: `categoryOf` ilk eslesmeyi dondurur (devir, ilan/musteriden once). */
export const FEED_CATEGORIES: readonly FeedCategory[] = [
  { id: "devir", label: "Devir", patterns: ["*.reassign", "customer.bulk_assign", "team.handoff*"] },
  { id: "export", label: "Dışa aktarma", patterns: ["export.*"] },
  { id: "belge", label: "Belge", patterns: ["customer_file.*", "property_media.*", "property.doc_*"] },
  { id: "ilan", label: "İlan", patterns: ["property.*", "portal.*"] },
  { id: "musteri", label: "Müşteri", patterns: ["customer.*"] },
  { id: "talep", label: "Talep", patterns: ["demand.*"] },
  { id: "randevu", label: "Randevu", patterns: ["appointment.*"] },
  { id: "anlasma", label: "Anlaşma", patterns: ["deal.*", "workflow.*", "contract.*", "offer.*"] },
  { id: "komisyon", label: "Komisyon", patterns: ["commission.*"] },
  { id: "onay", label: "Onay", patterns: ["approval_request_*", "oversight.*"] },
  { id: "ekip", label: "Ekip / yetki", patterns: ["team.*", "permission.*"] },
  { id: "guvenlik", label: "Güvenlik / giriş", patterns: ["auth.*", "security.*"] },
];

export const FEED_CATEGORY_IDS: readonly string[] = FEED_CATEGORIES.map((c) => c.id);

export function isFeedCategory(v: string): v is FeedCategoryId {
  return FEED_CATEGORY_IDS.includes(v);
}

function matches(pattern: string, action: string): boolean {
  const re = new RegExp(`^${pattern.replace(/[.+?^${}()|[\]\\]/g, "\\$&").replace(/\*/g, ".*")}$`);
  return re.test(action);
}

/** Aksiyon kodunun kategorisi; bilinmeyen kod null. */
export function categoryOf(action: string): FeedCategory | null {
  return FEED_CATEGORIES.find((c) => c.patterns.some((p) => matches(p, action))) ?? null;
}

/** Kategori icin PostgREST `.or()` ifadesi; gecersiz kategori null. */
export function categoryOrExpr(id: string): string | null {
  const c = FEED_CATEGORIES.find((x) => x.id === id);
  if (!c) return null;
  return c.patterns.map((p) => `action.like.${p}`).join(",");
}

/** Akisa ozgu ek etiketler (denetim sozlugunu tamamlar; ortak sozluk degistirilmez). */
const EXTRA_LABELS: Record<string, string> = {
  "commission.paid_bulk": "Toplu komisyon tahsili",
  "commission.payment_reverted": "Komisyon tahsilatı geri alındı",
  "customer.bulk_assign": "Müşteri toplu devri",
  "customer.bulk_reheat": "Müşteri yeniden ısıtma",
  "customer.bulk_tag": "Müşteriye toplu etiket",
  "property.restore": "Portföy geri yüklendi",
  "property.import": "Portföy içe aktarıldı",
  "property_media.delete": "Portföy medyası silindi",
  "property_media.bulk_delete": "Portföy medyası toplu silindi",
  "export.csv.full": "Tam veri dışa aktarma",
  "team.handoff": "Danışman devri",
  "team.member_created": "Üye eklendi",
  "task.delete": "Görev silindi",
  "approval_request_created": "Onay talebi açıldı",
  "approval_request_approved": "Onay verildi",
  "approval_request_rejected": "Onay reddedildi",
  "approval_request_cancelled": "Onay talebi geri çekildi",
  "oversight.approval_requested": "Ofis kuralı gereği onay istendi",
  "oversight.approval_consumed": "Onaylı işlem tamamlandı",
  "oversight.alert_reviewed": "Uyarı incelendi",
  "oversight.settings_update": "Ofis kontrol ayarları güncellendi",
  "auth.login": "Panele giriş yapıldı",
  "security.policy.update": "Ofis güvenlik politikası güncellendi",
  "security.session.revoke": "Kullanıcı oturumu kapatıldı",
};

export function feedActionLabel(action: string): string {
  return actionLabel[action] ?? EXTRA_LABELS[action] ?? action;
}

/** Akis aksiyon seceneklerinin tam listesi (filtre acilir listesi). */
export function feedActionOptions(): { code: string; label: string }[] {
  const all = { ...EXTRA_LABELS, ...actionLabel };
  return Object.entries(all)
    .filter(([code]) => categoryOf(code) !== null)
    .map(([code, label]) => ({ code, label }))
    .sort((a, b) => a.label.localeCompare(b.label, "tr-TR"));
}

/** Kayit turune gore panel ici hedef (bilinmeyen tur: null — yanlis yere gotürmekten iyidir). */
export function entityHref(entityType: string | null, entityId: string | null): string | null {
  if (!entityType || !entityId) return null;
  switch (entityType) {
    case "customer":
      return `/app/musteriler/${entityId}`;
    case "property":
      return `/app/portfoyler/${entityId}`;
    case "deal":
      return `/app/anlasmalar/${entityId}`;
    case "approval_request":
      return "/app/onaylar";
    case "commission":
      return financePath("komisyon");
    case "appointment":
      return "/app/randevular";
    case "task":
      return `/app/gorevler?gorev=${entityId}`;
    case "customer_demand":
    case "demand":
      return `/app/talepler/${entityId}`;
    default:
      return null;
  }
}

/** Kayit turu icin okunur ad: tek sozluk `src/lib/labels/entity.ts` (ham kod gosterilmez, bilinmeyen tur "Kayıt"). */
export { entityLabel } from "@/lib/labels/entity";
