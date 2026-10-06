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
const RULES: ReadonlyArray<readonly [RegExp, FeaturedPreviewKind]> = [
  [/kayip-kacak|kacan-komisyon/, "leak"],
  [/#(emsal-)?degerleme\b/, "valuation"],
  [/#imza\b/, "signature"],
  [/#ai-asistan\b/, "assistant"],
  [/#portal-kontrol\b|ilan-kontrol/, "listing"],
  [/#guvenlik\b|#uyum\b|^\/kvkk/, "security"],
  [/#otomasyon\b|#nasil\b/, "automation"],
  [/#tur\b|#tv-modu\b|#komisyon\b|#moduller\b|#neden\b/, "dashboard"],
  [/^\/fiyatlar|^\/kayit\?plan=/, "plans"],
];

export function previewForHref(href: string): FeaturedPreviewKind | null {
  const h = href.trim();
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
  assistant: "AI asistan sohbeti",
  listing: "İlan kontrol taraması",
  security: "Güvenlik ve izinler",
  automation: "Otomasyon akışı",
  dashboard: "Ofis paneli",
};
