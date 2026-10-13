import type { AnySettingDef } from "../types";
import { defineString } from "./define";

/**
 * ŞİRKET KİMLİĞİ ve DESTEK İLETİŞİMİ (AD12; platform kapsamı, `platform_settings` deposu). Düzenleme yeri
 * /admin/ayarlar/yasal?sekme=sirket. Okuyucular: `src/lib/legal-entity.ts` (mesafeli satış, ön bilgilendirme, fatura
 * başlığı) ve `src/lib/contact-info-server.ts` (yasal sayfalar, askı ekranı). Boş değer = env yedeği (`envFallback`),
 * o da yoksa alan hiç gösterilmez; bilgi uydurulmaz. Değişiklik ≤30 sn'de (ayar önbelleği) yayına yansır, deploy gerekmez.
 */
export const LEGAL_ENTITY_HOME = { href: "/admin/ayarlar/yasal?sekme=sirket", label: "Ayarlar > Yasal > Şirket" } as const;

/** Telefon ayarı hafif biçim kuralı (registry istemciyle ortaktır; phone-rules burada statik import edilmez). */
function phoneRule(v: string): string | null {
  const t = v.trim();
  if (!t) return null;
  if (!/^\+?[0-9 ()-]{7,24}$/.test(t)) return "Telefonu rakamlarla yazın (ör. 0850 000 00 00 veya +90 532 000 00 00).";
  const digits = t.replace(/\D/g, "");
  return digits.length >= 10 && digits.length <= 15 ? null : "Telefon 10-15 haneli olmalı.";
}

function emailRule(v: string): string | null {
  const t = v.trim();
  if (!t) return null;
  return /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(t) ? null : "Geçerli bir e-posta adresi yazın.";
}

const entity = (
  key: string,
  label: string,
  description: string,
  envFallback: string,
  extra: { maxLength?: number; multiline?: boolean; crossRule?: (v: string) => string | null } = {},
): AnySettingDef =>
  defineString({
    key: `legal.entity_${key}`,
    home: LEGAL_ENTITY_HOME,
    default: "",
    maxLength: extra.maxLength ?? 200,
    multiline: extra.multiline,
    crossRule: extra.crossRule,
    category: "uyum",
    label,
    description,
    impact:
      "Mesafeli satış sözleşmesi, ön bilgilendirme formu ve abonelik faturası başlığında hemen (≤30 sn) görünür. Boş bırakılırsa sunucu ortamındaki yedek değer, o da yoksa satır hiç gösterilmez.",
    risk: "high",
    envFallback,
  });

export const LEGAL_SETTING_DEFS: AnySettingDef[] = [
  entity("unvan", "Ticari ünvan", "Sağlayıcının (EmlakSoft işletmecisi) ticaret sicilindeki tam ünvanı.", "LEGAL_UNVAN"),
  entity("adres", "Adres", "Sağlayıcının tebligat/merkez adresi.", "LEGAL_ADRES", { maxLength: 400, multiline: true }),
  entity("mersis", "MERSİS no", "16 haneli MERSİS numarası.", "LEGAL_MERSIS", {
    maxLength: 32,
    crossRule: (v) => (!v.trim() || /^[0-9 ]{16,20}$/.test(v.trim()) ? null : "MERSİS numarası 16 rakamdan oluşur."),
  }),
  entity("vergi_dairesi", "Vergi dairesi", "Sağlayıcının bağlı olduğu vergi dairesi.", "LEGAL_VERGI_DAIRESI", { maxLength: 120 }),
  entity("vergi_no", "Vergi no", "10 haneli vergi kimlik numarası.", "LEGAL_VERGI_NO", {
    maxLength: 32,
    crossRule: (v) => (!v.trim() || /^[0-9]{10,11}$/.test(v.trim()) ? null : "Vergi numarası 10 (şahıs şirketinde 11) rakamdır."),
  }),
  entity("kep", "KEP adresi", "Kayıtlı elektronik posta adresi.", "LEGAL_KEP", { maxLength: 200, crossRule: emailRule }),
  entity("telefon", "Şirket telefonu", "Yasal metinlerde sağlayıcı telefonu olarak gösterilir.", "LEGAL_TELEFON", { maxLength: 32, crossRule: phoneRule }),
  defineString({
    key: "support.email",
    home: LEGAL_ENTITY_HOME,
    default: "",
    maxLength: 200,
    crossRule: emailRule,
    category: "uyum",
    label: "Destek e-postası",
    description: "Yasal sayfalar ve askıya alınmış hesap ekranında gösterilen destek adresi.",
    impact:
      "Yasal sayfalarda ≤30 sn içinde görünür. Boşsa sunucu yedeği, o da yoksa koddaki varsayılan adres kullanılır. " +
      "DİKKAT: ana sayfa SSS'si ve site menüsü (destek bağlantısı, menü görseli) bu ayarı okumaz; derleme anındaki adresi " +
      "(NEXT_PUBLIC_SUPPORT_EMAIL ya da koddaki varsayılan) gösterir. Bu yüzeylerde adres yalnız env değişip uygulama yeniden derlenince güncellenir.",
    risk: "high",
    envFallback: "SUPPORT_EMAIL",
  }),
  defineString({
    key: "support.phone",
    home: LEGAL_ENTITY_HOME,
    default: "",
    maxLength: 32,
    crossRule: phoneRule,
    category: "uyum",
    label: "Destek telefonu",
    description: "İsteğe bağlı destek hattı; boşsa hiçbir yerde gösterilmez.",
    impact: "Mesafeli satış ve ön bilgilendirme sayfalarında aranabilir bağlantı olarak çıkar.",
    risk: "low",
    envFallback: "SUPPORT_PHONE",
  }),
  defineString({
    key: "support.whatsapp",
    home: LEGAL_ENTITY_HOME,
    default: "",
    maxLength: 32,
    crossRule: phoneRule,
    category: "uyum",
    label: "Destek WhatsApp hattı",
    description: "İsteğe bağlı WhatsApp hattı; boşsa hiçbir yerde gösterilmez.",
    impact: "Mesafeli satış ve ön bilgilendirme sayfalarında wa.me bağlantısı olarak çıkar.",
    risk: "low",
    envFallback: "SUPPORT_WHATSAPP",
  }),
];

/** Şirket sekmesinde gösterilen anahtarlar (ekran sırası). */
export const LEGAL_ENTITY_KEYS = [
  "legal.entity_unvan",
  "legal.entity_adres",
  "legal.entity_mersis",
  "legal.entity_vergi_dairesi",
  "legal.entity_vergi_no",
  "legal.entity_kep",
  "legal.entity_telefon",
] as const;
export const SUPPORT_CONTACT_KEYS = ["support.email", "support.phone", "support.whatsapp"] as const;
