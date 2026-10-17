import { ZEKA_KNOWLEDGE_SOURCES, ZEKA_OFFICE_LIMIT_SURFACES, ZEKA_SETTING_KEYS, ZEKA_SURFACE_LABELS, type ZekaKnowledgeSourceId } from "@/lib/settings/registry/zeka";
import type { OpenAiErrorKind } from "@/lib/ai/openai-client";
import { ZEKA_SURFACES } from "./types";

/**
 * Yapay zeka merkezi (/admin/zeka) SAF tanımları: sekmeler ve her sekmenin yazdığı ayar anahtarları (eylem bu beyaz
 * listenin dışını yazamaz). Etiketler ve doğrulama registry'den (`registry/zeka.ts`).
 */

export const ZEKA_CENTER_TABS = {
  baglanti: "Bağlantı",
  yuzeyler: "Yüzeyler",
  davranis: "Davranış",
  bilgi: "Bilgi",
  kullanim: "Kullanım",
  kayitlar: "Kayıtlar",
} as const;
export type ZekaCenterTab = keyof typeof ZEKA_CENTER_TABS;

export const zekaCenterTabOf = (sekme: string | undefined): ZekaCenterTab => (sekme && Object.hasOwn(ZEKA_CENTER_TABS, sekme) ? (sekme as ZekaCenterTab) : "baglanti");

const surfaces = [...ZEKA_SURFACES];

export const ZEKA_CENTER_GROUPS = {
  baglanti: [ZEKA_SETTING_KEYS.model],
  yuzeyler: [
    ...surfaces.flatMap((s) => [ZEKA_SETTING_KEYS.enabled(s), ZEKA_SETTING_KEYS.mode(s), ZEKA_SETTING_KEYS.dailyUser(s), ZEKA_SETTING_KEYS.surfaceMaxTokens(s)]),
    ...ZEKA_OFFICE_LIMIT_SURFACES.map((s) => ZEKA_SETTING_KEYS.dailyOffice(s)),
    ZEKA_SETTING_KEYS.maxTokens,
  ],
  davranis: [ZEKA_SETTING_KEYS.persona, ZEKA_SETTING_KEYS.language, ZEKA_SETTING_KEYS.bannedTopics, ...surfaces.map((s) => ZEKA_SETTING_KEYS.prompt(s))],
  bilgi: [...(Object.keys(ZEKA_KNOWLEDGE_SOURCES) as ZekaKnowledgeSourceId[]).map((id) => ZEKA_SETTING_KEYS.source(id)), ZEKA_SETTING_KEYS.embeddings, ZEKA_SETTING_KEYS.embeddingModel],
} as const satisfies Record<string, readonly string[]>;
export type ZekaCenterGroup = keyof typeof ZEKA_CENTER_GROUPS;

export const isZekaCenterGroup = (g: string): g is ZekaCenterGroup => Object.hasOwn(ZEKA_CENTER_GROUPS, g);

/** Yüzey adları (merkezde kısa). */
export const ZEKA_SURFACE_SHORT: Record<keyof typeof ZEKA_SURFACE_LABELS, string> = {
  app: "Ofis paneli",
  public: "Ana sayfa ve site",
  vitrin: "Vitrin",
  admin: "Yönetim",
};

/** Model önerileri (serbest metin de girilebilir; boş = platform varsayılanı). */
export const ZEKA_MODEL_SUGGESTIONS = ["gpt-4o-mini", "gpt-4o", "gpt-4.1-mini", "gpt-4.1", "gpt-5-mini"] as const;

/** Bağlantı testi hatasının Türkçe açıklaması (içerik/anahtar yok). */
export function zekaTestErrorMessage(kind: OpenAiErrorKind): string {
  switch (kind) {
    case "auth":
      return "Anahtar reddedildi (geçersiz ya da iptal edilmiş). Yeni anahtar girin.";
    case "rate_limit":
      return "OpenAI hız ya da kota sınırı: hesabın bakiyesini ve sınırlarını kontrol edin.";
    case "bad_request":
      return "İstek reddedildi: model adı yanlış olabilir ya da hesabın bu modele erişimi yok.";
    case "timeout":
      return "OpenAI zamanında yanıt vermedi. Biraz sonra tekrar deneyin.";
    case "server":
      return "OpenAI tarafında geçici hata. Biraz sonra tekrar deneyin.";
    case "network":
      return "Sunucu OpenAI'ye ulaşamadı (ağ). Sunucunun dış bağlantısını kontrol edin.";
    default:
      return "Bağlantı başarısız oldu. Biraz sonra tekrar deneyin.";
  }
}
