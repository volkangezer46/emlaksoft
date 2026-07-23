/**
 * Portföy Sağlık Skoru — tamamlık yüzdesi + eksik alanlar + uyarı listesi
 * İlan Kalite Puanı   — portal performansı için içerik kalitesi
 *
 * Her iki skor da 0–100 arasında, ağırlıklı puan hesabı ile.
 */

// ---------------------------------------------------------------------------
// Tipler
// ---------------------------------------------------------------------------

export type HealthCheckItem = {
  key:     string;
  label:   string;
  passed:  boolean;
  weight:  number; // 1–3 arası öncelik
  tip?:    string; // geçmezse gösterilecek öneri
};

export type PropertyHealthScore = {
  score:         number;           // 0–100
  grade:         "A" | "B" | "C" | "D" | "F";
  passed:        number;
  total:         number;
  items:         HealthCheckItem[];
  criticalMissing: string[];       // hemen düzeltilmesi gereken
};

export type ListingQualityScore = {
  score:   number;
  grade:   "A" | "B" | "C" | "D" | "F";
  items:   HealthCheckItem[];
};

// ---------------------------------------------------------------------------
// Portföy sağlık skoru
// ---------------------------------------------------------------------------

type PropertyInput = {
  title:              string | null;
  property_type:      string | null;
  transaction_type:   string | null;
  list_price:         number | null;
  address_line:       string | null;
  province_id:        string | null;
  parcel_block:       string | null;
  parcel_lot:         string | null;
  commission_rate:    number | null;
  features:           Record<string, unknown> | null;
  authorization_start?: string | null;
  authorization_end?:   string | null;
  authorization_type?:  string | null;
  mediaCount:         number;
  hasActivePortal:    boolean;
};

const HEALTH_CHECKS: ((p: PropertyInput) => HealthCheckItem)[] = [
  // Temel bilgiler (ağırlık 3)
  (p) => ({
    key:    "title",
    label:  "İlan başlığı girildi",
    passed: Boolean(p.title?.trim()),
    weight: 3,
    tip:    "Dikkat çekici bir başlık ilanınızın tıklanma oranını artırır.",
  }),
  (p) => ({
    key:    "property_type",
    label:  "Gayrimenkul türü seçildi",
    passed: Boolean(p.property_type),
    weight: 3,
    tip:    "Portföy türünü belirtin (Daire, Villa, Arsa vb.).",
  }),
  (p) => ({
    key:    "transaction_type",
    label:  "İşlem türü seçildi",
    passed: Boolean(p.transaction_type),
    weight: 3,
    tip:    "Satılık mı kiralık mı olduğunu belirtin.",
  }),
  (p) => ({
    key:    "list_price",
    label:  "Fiyat girildi",
    passed: Boolean(p.list_price && p.list_price > 0),
    weight: 3,
    tip:    "Fiyat girilmemiş portföyler müşterilerde güven oluşturmaz.",
  }),

  // Konum (ağırlık 3)
  (p) => ({
    key:    "province",
    label:  "İl seçildi",
    passed: Boolean(p.province_id),
    weight: 3,
    tip:    "Konum bilgisi eşleştirme motorunun çalışması için zorunludur.",
  }),
  (p) => ({
    key:    "address",
    label:  "Adres girildi",
    passed: Boolean(p.address_line?.trim()),
    weight: 2,
    tip:    "Açık adres müşterilerin güvenini artırır.",
  }),

  // Tapu (ağırlık 2)
  (p) => ({
    key:    "parcel",
    label:  "Ada/parsel bilgisi var",
    passed: Boolean(p.parcel_block && p.parcel_lot),
    weight: 2,
    tip:    "Ada ve parsel numarası tapu kontrolü için gereklidir.",
  }),

  // Finansal (ağırlık 2)
  (p) => ({
    key:    "commission",
    label:  "Komisyon oranı girildi",
    passed: Boolean(p.commission_rate && p.commission_rate > 0),
    weight: 2,
    tip:    "Komisyon oranı girilmezse hakediş hesaplanamaz.",
  }),

  // Medya (ağırlık 3)
  (p) => ({
    key:    "photos",
    label:  "En az 3 fotoğraf var",
    passed: p.mediaCount >= 3,
    weight: 3,
    tip:    `Şu an ${p.mediaCount} fotoğraf var. En az 3, ideal 8+ fotoğraf ekleyin.`,
  }),
  (p) => ({
    key:    "photos_good",
    label:  "8+ fotoğraf (önerilen)",
    passed: p.mediaCount >= 8,
    weight: 1,
    tip:    "8 ve üzeri fotoğraf olan portföyler %40 daha fazla ilgi görür.",
  }),

  // Özellikler (ağırlık 1)
  (p) => ({
    key:    "features_rooms",
    label:  "Oda sayısı girildi",
    passed: Boolean(p.features?.rooms || p.features?.room_count),
    weight: 1,
    tip:    "Oda sayısı müşteri filtrelemesinde kritiktir.",
  }),
  (p) => ({
    key:    "features_sqm",
    label:  "Metrekare girildi",
    passed: Boolean(p.features?.net_sqm || p.features?.gross_sqm || p.features?.sqm),
    weight: 2,
    tip:    "Brüt veya net metrekare bilgisi ekleyin.",
  }),
  (p) => ({
    key:    "features_floor",
    label:  "Kat bilgisi girildi",
    passed: Boolean(p.features?.floor || p.features?.floor_number),
    weight: 1,
    tip:    "Kat bilgisi müşteri filtrelemesinde kullanılır.",
  }),
  (p) => ({
    key:    "features_heating",
    label:  "Isınma türü seçildi",
    passed: Boolean(p.features?.heating || p.features?.heating_type),
    weight: 1,
    tip:    "Isınma türü portallerde ayrıca filtrelenir.",
  }),

  // Yetki belgesi (ağırlık 2)
  (p) => ({
    key:    "authorization",
    label:  "Yetki belgesi girildi",
    passed: Boolean(p.authorization_start && p.authorization_end),
    weight: 2,
    tip:    "Yetki belgesi tarihleri takip için zorunludur.",
  }),

  // Portal (ağırlık 2)
  (p) => ({
    key:    "portal",
    label:  "En az 1 portalde yayında",
    passed: p.hasActivePortal,
    weight: 2,
    tip:    "Portale yayınlanmayan portföyler müşterilere ulaşamaz.",
  }),
];

function gradeFrom(score: number): "A" | "B" | "C" | "D" | "F" {
  if (score >= 90) return "A";
  if (score >= 75) return "B";
  if (score >= 60) return "C";
  if (score >= 40) return "D";
  return "F";
}

export function computePropertyHealth(input: PropertyInput): PropertyHealthScore {
  const items = HEALTH_CHECKS.map((fn) => fn(input));

  const totalWeight  = items.reduce((s, i) => s + i.weight, 0);
  const earnedWeight = items.filter((i) => i.passed).reduce((s, i) => s + i.weight, 0);
  const score = Math.round((earnedWeight / totalWeight) * 100);

  const criticalMissing = items
    .filter((i) => !i.passed && i.weight === 3)
    .map((i) => i.label);

  return {
    score,
    grade: gradeFrom(score),
    passed: items.filter((i) => i.passed).length,
    total:  items.length,
    items,
    criticalMissing,
  };
}

// ---------------------------------------------------------------------------
// İlan kalite puanı (portal ilan içeriği)
// ---------------------------------------------------------------------------

type ListingQualityInput = {
  title:       string | null;
  description: string | null;
  mediaCount:  number;
  hasPortalId: boolean;   // portal ilan numarası girilmiş mi
  hasPortalUrl: boolean;  // portal URL bağlantısı var mı
  priceSet:    boolean;
  locationSet: boolean;
};

const QUALITY_CHECKS: ((l: ListingQualityInput) => HealthCheckItem)[] = [
  (l) => ({
    key: "q_title", label: "Başlık 20+ karakter",
    passed: (l.title?.length ?? 0) >= 20, weight: 3,
    tip: "Başlığınız en az 20 karakter olmalı.",
  }),
  (l) => ({
    key: "q_title_keyword", label: "Başlıkta konum veya özellik geçiyor",
    passed: Boolean(l.title && /[a-zA-ZçğışöüÇĞİŞÖÜ]{4}/.test(l.title)),
    weight: 2,
    tip: "Başlığa mahalle, tür veya özellik ekleyin.",
  }),
  (l) => ({
    key: "q_desc", label: "Açıklama 100+ karakter",
    passed: (l.description?.length ?? 0) >= 100, weight: 3,
    tip: "Detaylı açıklama arama motorlarında daha iyi sıralanmanızı sağlar.",
  }),
  (l) => ({
    key: "q_photos_min", label: "En az 5 fotoğraf",
    passed: l.mediaCount >= 5, weight: 3,
    tip: "Portal ilanları için minimum 5 fotoğraf önerilir.",
  }),
  (l) => ({
    key: "q_photos_good", label: "10+ fotoğraf",
    passed: l.mediaCount >= 10, weight: 2,
    tip: "10+ fotoğraf olan ilanlar %60 daha fazla görüntülenir.",
  }),
  (l) => ({
    key: "q_price", label: "Fiyat girildi",
    passed: l.priceSet, weight: 3,
    tip: "Fiyatsız ilanlar portallerde geri planda kalır.",
  }),
  (l) => ({
    key: "q_location", label: "Konum bilgisi eksiksiz",
    passed: l.locationSet, weight: 2,
    tip: "Portal harita aramasında çıkmak için konum şart.",
  }),
  (l) => ({
    key: "q_portal_id", label: "Portal ilan no. girildi",
    passed: l.hasPortalId, weight: 1,
    tip: "Portal ilan numarasını girerek takibi kolaylaştırın.",
  }),
];

export function computeListingQuality(input: ListingQualityInput): ListingQualityScore {
  const items = QUALITY_CHECKS.map((fn) => fn(input));
  const totalWeight  = items.reduce((s, i) => s + i.weight, 0);
  const earnedWeight = items.filter((i) => i.passed).reduce((s, i) => s + i.weight, 0);
  const score = Math.round((earnedWeight / totalWeight) * 100);

  return { score, grade: gradeFrom(score), items };
}
