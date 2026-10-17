import type { AnySettingDef } from "../types";
import { defineBool, defineEnum, defineInt, defineString } from "./define";

/**
 * EmlakSoft Zeka ayarları (platform kapsamı, `platform_settings`; Sistem Ayarları Merkezi "AI ve kota" kategorisinde
 * kendiliğinden listelenir). Varsayılan = anahtarsız kurulumda bugünkü davranış: her yüzey AÇIK, kip "otomatik"
 * (OpenAI anahtarı tanımlıysa GPT, değilse yerel zeka). OpenAI anahtarının kendisi BURADA DEĞİL: mevcut gizli ayar
 * `ai.openai_api_key` (şifreli; Sistem > Entegrasyonlar) kullanılır. Okuyucu: `src/lib/ai/zeka/settings.ts`.
 */

export const ZEKA_SURFACE_LABELS = {
  app: "Ofis paneli (ana ekran ve komut paleti)",
  public: "Platform sitesi (ilk ziyaret sayfaları)",
  vitrin: "Ofis vitrinleri",
  admin: "Yönetim paneli",
} as const;

export const ZEKA_MODE_OPTIONS = [
  { value: "auto", label: "Otomatik (anahtar varsa GPT, yoksa yerel zeka)" },
  { value: "local", label: "Yalnız yerel zeka (harici çağrı yok)" },
  { value: "gpt", label: "GPT (hata, anahtar yokluğu ya da kota dolunca yerel zekaya düşer)" },
] as const;

export const ZEKA_SETTING_KEYS = {
  mode: (s: keyof typeof ZEKA_SURFACE_LABELS) => `zeka.mode.${s}`,
  enabled: (s: keyof typeof ZEKA_SURFACE_LABELS) => `zeka.enabled.${s}`,
  model: "zeka.model",
  maxTokens: "zeka.max_tokens",
  embeddings: "zeka.embeddings_enabled",
  embeddingModel: "zeka.embedding_model",
} as const;

// Ayarların ekranı: Sistem Ayarları Merkezi (AI ve kota). Kullanım istatistikleri ve eğitim: /admin/zeka (ayrı paket).

const perSurface: AnySettingDef[] = (Object.keys(ZEKA_SURFACE_LABELS) as (keyof typeof ZEKA_SURFACE_LABELS)[]).flatMap((s) => [
  defineBool({
    key: ZEKA_SETTING_KEYS.enabled(s),
    default: true,
    category: "ai",
    label: `Zeka: ${ZEKA_SURFACE_LABELS[s]} açık`,
    description: `${ZEKA_SURFACE_LABELS[s]} yüzeyinde Zeka girişini gösterir.`,
    impact: "Kapatınca bu yüzeyde Zeka girişi gizlenir ve uç nokta yanıt vermez; diğer yüzeyler etkilenmez.",
  }),
  defineEnum({
    key: ZEKA_SETTING_KEYS.mode(s),
    default: "auto",
    options: ZEKA_MODE_OPTIONS,
    category: "ai",
    label: `Zeka kipi: ${ZEKA_SURFACE_LABELS[s]}`,
    description: "Yanıtı hangi motorun üreteceği. GPT kipinde de veri yalnız aynı yetkili araçlarla okunur.",
    impact: "GPT kipi ofis AI kredisinden düşer (platform yüzeyleri platform AI kotasından). Yerel kip harici çağrı yapmaz.",
  }),
]);

export const ZEKA_SETTING_DEFS: AnySettingDef[] = [
  ...perSurface,
  defineString({
    key: ZEKA_SETTING_KEYS.model,
    default: "",
    maxLength: 60,
    category: "ai",
    label: "Zeka GPT modeli",
    description: "Boş bırakılırsa platform varsayılanı (OPENAI_MODEL, yoksa gpt-4o-mini) kullanılır.",
    impact: "Bir sonraki Zeka çağrısından itibaren geçerlidir; kredi maliyeti modele göre değişir (AI kredi maliyet tablosu).",
  }),
  defineInt({
    key: ZEKA_SETTING_KEYS.maxTokens,
    default: 600,
    min: 100,
    max: 2000,
    unit: "jeton",
    category: "ai",
    label: "Zeka yanıt üst sınırı",
    description: "GPT yanıtının en çok jeton sayısı.",
    impact: "Yükseltmek daha uzun yanıt ve daha çok kredi demektir.",
  }),
  defineBool({
    key: ZEKA_SETTING_KEYS.embeddings,
    default: true,
    category: "ai",
    label: "Zeka anlamsal dizin (gömme)",
    description: "OpenAI anahtarı varken bilgi tabanının gömme dizini gece bakımında kurulur; aramalar sözcüksel + anlamsal birleşir.",
    impact: "Kapalıyken yalnız sözcüksel arama kullanılır. Dizin kurulumu platform AI kotasından düşer.",
  }),
  defineString({
    key: ZEKA_SETTING_KEYS.embeddingModel,
    default: "text-embedding-3-small",
    maxLength: 60,
    category: "ai",
    label: "Zeka gömme modeli",
    description: "Anlamsal dizinde kullanılan OpenAI gömme modeli.",
    impact: "Değişince dizin bir sonraki gece bakımında yeniden kurulur.",
  }),
];
