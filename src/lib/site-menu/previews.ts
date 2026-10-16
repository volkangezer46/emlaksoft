import type { FeaturedPreviewKind } from "./schema";

/**
 * Mega menü CANLI ÖNİZLEME eşlemesi (saf; vitest kapsamında).
 *
 * Bağlantı öğesinin hedefinden (href) hangi mini ürün önizlemesinin gösterileceği türetilir; admin şemasına yeni alan
 * eklenmez (eski yayınlar aynen çalışır). Öne çıkan kartın kendi `preview` seçimi admin'den gelir ve VARSAYILAN
 * katmandır; fare/klavye odağı bir öğeye gelince kart o öğenin önizlemesine geçer. Eşleşme yoksa (ör. vitrin, destek
 * e-postası) varsayılan katman kalır. Sıra önemlidir: ilk eşleşen kazanır ("kaçan komisyon" fiyat sayfasında olsa da
 * kayıp-kaçak önizlemesidir).
 */
/** Admin'de seçilebilen 9 tür + her alt menü öğesine özel ek sahneler (yalnız hedefe göre türetilir; şema değişmez). */
export const EXTRA_SCENES = [
  "setup", "plan-advisor", "plan-office", "plan-team", "plan-enterprise", "compare", "calc", "billing", "commission", "tv",
  "modules", "why", "showcase", "steps", "faq", "consent", "legal", "support", "parcel",
] as const;
export type SceneKind = FeaturedPreviewKind | (typeof EXTRA_SCENES)[number];

const RULES: ReadonlyArray<readonly [RegExp, SceneKind]> = [
  [/^\/fiyatlar#kacan-komisyon/, "calc"],
  [/^\/fiyatlar#sss/, "billing"],
  [/#karsilastirma\b/, "compare"],
  [/kayip-kacak|kacan-komisyon/, "leak"],
  [/#emsal-degerleme\b/, "valuation"],
  [/#degerleme\b/, "parcel"],
  [/#imza\b/, "signature"],
  [/#ai-asistan\b/, "assistant"],
  [/#portal-kontrol\b|ilan-kontrol/, "listing"],
  [/#guvenlik\b/, "security"],
  [/#uyum\b/, "consent"],
  [/^\/kvkk/, "legal"],
  [/#otomasyon\b/, "automation"],
  [/#nasil\b/, "steps"],
  [/#sss\b/, "faq"],
  [/#vitrin\b/, "showcase"],
  [/#komisyon\b/, "commission"],
  [/#tv-modu\b/, "tv"],
  [/#moduller\b/, "modules"],
  [/#neden\b/, "why"],
  [/#tur\b/, "dashboard"],
  [/^\/kayit\?plan=advisor\b/, "plan-advisor"],
  [/^\/kayit\?plan=office\b/, "plan-office"],
  [/^\/kayit\?plan=professional\b/, "plan-team"],
  [/^\/kayit\?plan=enterprise\b/, "plan-enterprise"],
  [/^\/kayit\/?$/, "setup"],
  [/^\/fiyatlar/, "plans"],
];

export function previewForHref(href: string): SceneKind | null {
  const h = href.trim();
  if (/^mailto:destek@/i.test(h)) return "support";
  if (!h || /^(mailto|tel):/i.test(h)) return null;
  for (const [re, kind] of RULES) if (re.test(h)) return kind;
  return null;
}

/** Sütun başlığı ikon karosu (lucide adı, `icon-registry` listesinde olmalı). Eşleşmezse ilk öğenin ikonu kullanılır. */
const SECTION_ICONS: ReadonlyArray<readonly [RegExp, string]> = [
  [/satış|kazanç/i, "TrendingUp"],
  [/otomasyon|ofis$/i, "Workflow"],
  [/büyüklü/i, "Building2"],
  [/karar/i, "Scale"],
  [/öğren/i, "Sparkles"],
  [/yasal|destek/i, "ShieldCheck"],
  [/fiyat/i, "Tag"],
];

export function sectionIconName(title: string): string | null {
  for (const [re, name] of SECTION_ICONS) if (re.test(title)) return name;
  return null;
}

/** Önizleme katmanı etiketi (admin seçim listesi ve kart alt yazısı ortak). */
export const PREVIEW_LABELS: Record<FeaturedPreviewKind, string> = {
  leak: "Kayıp-kaçak radarı",
  valuation: "Emsal değer eğrisi",
  signature: "Dijital imza akışı",
  plans: "Paket karşılaştırma",
  assistant: "Yardımcı sohbeti",
  listing: "İlan kontrol taraması",
  security: "Güvenlik ve izinler",
  automation: "Otomasyon akışı",
  dashboard: "Ofis paneli",
};

/** Alt menü öğesine özel sahnelerin dahil olduğu tam etiket tablosu (kart alt yazısı). */
export const SCENE_LABELS: Record<SceneKind, string> = {
  ...PREVIEW_LABELS,
  setup: "Dakikalar içinde kurulum",
  "plan-advisor": "Bağımsız danışman",
  "plan-office": "Emlak ofisi",
  "plan-team": "Büyüyen ekip",
  "plan-enterprise": "Kurumsal yapı",
  compare: "Paket karşılaştırma tablosu",
  calc: "Kaçan komisyon hesabı",
  billing: "Fatura ve KDV",
  commission: "Komisyon ve anlaşma",
  tv: "Ofis panosu",
  modules: "Modül aç/kapa",
  why: "Excel ve defterden geçiş",
  showcase: "Vitrin ve portallar",
  steps: "Üç adımda başlangıç",
  faq: "Sık sorulan sorular",
  consent: "Telefon ve KVKK uyumu",
  legal: "KVKK aydınlatma metni",
  support: "Destek",
  parcel: "Ada/parsel değerleme",
};
