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

type SurfaceKey = keyof typeof ZEKA_SURFACE_LABELS;

/** Bilgi kaynağı anahtarları (Yapay zeka merkezi > Bilgi). Menü/sayfa grafiği ve oluşturma eylemleri kapatılamaz (gezinme çekirdeği). */
export const ZEKA_KNOWLEDGE_SOURCES = {
  help: { label: "Yardım merkezi (SSS, rehber, sözlük)", sources: ["faq", "guide", "glossary"] },
  qa: { label: "Onaylı soru-cevaplar", sources: ["qa"] },
  terms: { label: "Terimler", sources: ["term"] },
  pricing: { label: "Paketler ve fiyatlar (platform sitesi)", sources: ["plan"] },
  site: { label: "Site sayfaları ve ana sayfa SSS'si", sources: ["site"] },
  settings: { label: "Yönetim ayar açıklamaları (yönetim paneli)", sources: ["setting"] },
} as const;
export type ZekaKnowledgeSourceId = keyof typeof ZEKA_KNOWLEDGE_SOURCES;

/** Günlük ofis sınırı olan yüzeyler (ofis paneli: kullanıcıların toplamı; vitrin: o ofisin tüm ziyaretçileri). */
export const ZEKA_OFFICE_LIMIT_SURFACES = ["app", "vitrin"] as const;

export const ZEKA_LANGUAGE_OPTIONS = [
  { value: "tr", label: "Türkçe (her zaman)" },
  { value: "auto", label: "Sorunun dilinde (emin olunamazsa Türkçe)" },
] as const;

export const ZEKA_SETTING_KEYS = {
  mode: (s: SurfaceKey) => `zeka.mode.${s}`,
  enabled: (s: SurfaceKey) => `zeka.enabled.${s}`,
  model: "zeka.model",
  maxTokens: "zeka.max_tokens",
  embeddings: "zeka.embeddings_enabled",
  embeddingModel: "zeka.embedding_model",
  /** Yüzey başına jeton üst sınırı (0 = genel `zeka.max_tokens`). */
  surfaceMaxTokens: (s: SurfaceKey) => `zeka.max_tokens.${s}`,
  /** Kişi başına 24 saatte en çok soru (oturumlu yüzeyde kullanıcı, public/vitrinde IP; 0 = sınırsız). */
  dailyUser: (s: SurfaceKey) => `zeka.daily_user.${s}`,
  /** Ofis başına 24 saatte en çok soru (yalnız app ve vitrin; 0 = sınırsız). */
  dailyOffice: (s: (typeof ZEKA_OFFICE_LIMIT_SURFACES)[number]) => `zeka.daily_office.${s}`,
  persona: "zeka.persona",
  /** Yüzeye özel sistem istemi eki (GPT; güvenlik ve kapsam kurallarını geçersiz kılamaz). */
  prompt: (s: SurfaceKey) => `zeka.prompt.${s}`,
  bannedTopics: "zeka.banned_topics",
  language: "zeka.answer_language",
  source: (id: ZekaKnowledgeSourceId) => `zeka.source.${id}`,
} as const;

// Ayarların ana ekranı: Yapay zeka merkezi (/admin/zeka; Bağlantı, Yüzeyler, Davranış, Bilgi sekmeleri). Sistem Ayarları
// Merkezi (AI ve kota) aynı kayıtları listeler; yazım iki yerde de registry üzerinden (geçmiş + denetim).

/** Kişi başına günlük soru varsayılanı: bugünkü dakikalık sınırların üstünde, kötüye kullanımı keser. */
const DAILY_USER_DEFAULT: Record<SurfaceKey, number> = { app: 300, public: 60, vitrin: 60, admin: 500 };

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

const perSurfaceGovernance: AnySettingDef[] = (Object.keys(ZEKA_SURFACE_LABELS) as SurfaceKey[]).flatMap((s) => [
  defineInt({
    key: ZEKA_SETTING_KEYS.surfaceMaxTokens(s),
    default: 0,
    min: 0,
    max: 2000,
    unit: "jeton",
    category: "ai",
    label: `Zeka yanıt üst sınırı: ${ZEKA_SURFACE_LABELS[s]}`,
    description: "Bu yüzeyde GPT yanıtının en çok jeton sayısı. 0 = genel üst sınır (zeka.max_tokens).",
    impact: "Yükseltmek bu yüzeyde daha uzun yanıt ve daha çok kredi demektir.",
  }),
  defineInt({
    key: ZEKA_SETTING_KEYS.dailyUser(s),
    default: DAILY_USER_DEFAULT[s],
    min: 0,
    max: 100000,
    unit: "soru / 24 saat",
    category: "ai",
    label: `Zeka kişi başına günlük soru: ${ZEKA_SURFACE_LABELS[s]}`,
    description: s === "public" || s === "vitrin" ? "Ziyaretçi (IP) başına 24 saatte en çok yanıt. 0 = sınırsız." : "Kullanıcı başına 24 saatte en çok yanıt. 0 = sınırsız.",
    impact: "Sınır dolunca Zeka o kişiye 24 saat dolana kadar 'günlük soru sınırına ulaşıldı' der; öneriler çalışmaya devam eder.",
  }),
  defineString({
    key: ZEKA_SETTING_KEYS.prompt(s),
    default: "",
    maxLength: 1500,
    multiline: true,
    category: "ai",
    label: `Zeka sistem istemi eki: ${ZEKA_SURFACE_LABELS[s]}`,
    description: "Bu yüzeyde GPT sistem istemine eklenen yönetici talimatı (sunucuda kalır, istemciye gitmez).",
    impact: "Yalnız GPT yanıtlarını etkiler. Güvenlik, yazmama ve yetki kuralları her zaman önce gelir; çelişen talimat yok sayılır.",
  }),
]);

const officeLimits: AnySettingDef[] = ZEKA_OFFICE_LIMIT_SURFACES.map((s) =>
  defineInt({
    key: ZEKA_SETTING_KEYS.dailyOffice(s),
    default: s === "app" ? 3000 : 1500,
    min: 0,
    max: 999999,
    unit: "soru / 24 saat",
    category: "ai",
    label: `Zeka ofis başına günlük soru: ${ZEKA_SURFACE_LABELS[s]}`,
    description: s === "app" ? "Bir ofisin tüm kullanıcılarının 24 saatteki toplam yanıt sayısı. 0 = sınırsız." : "Bir ofis vitrininin tüm ziyaretçilerine 24 saatte verilen yanıt sayısı. 0 = sınırsız.",
    impact: "Sınır dolunca o ofiste Zeka 24 saat dolana kadar yeni yanıt vermez; diğer ofisler etkilenmez.",
  }),
);

const sourceToggles: AnySettingDef[] = (Object.keys(ZEKA_KNOWLEDGE_SOURCES) as ZekaKnowledgeSourceId[]).map((id) =>
  defineBool({
    key: ZEKA_SETTING_KEYS.source(id),
    default: true,
    category: "ai",
    label: `Zeka bilgi kaynağı: ${ZEKA_KNOWLEDGE_SOURCES[id].label}`,
    description: "Bu kaynağın parçaları Zeka'nın bilgi tabanına (yerel zeka ve GPT bağlamı) girer.",
    impact: "Kapatınca bu kaynaktan yanıt ve bağlam verilmez (en geç 5 dk içinde, ya da Bilgi sekmesinde dizini yeniden oluşturunca).",
  }),
);

/** Ayarın düzenlendiği Yapay zeka merkezi sekmesi (merkez bu ayarları bağlantı olarak gösterir; tek yerde düzenlenir). */
export function zekaSettingTab(key: string): "baglanti" | "yuzeyler" | "davranis" | "bilgi" {
  if (key === ZEKA_SETTING_KEYS.model) return "baglanti";
  if (key.startsWith("zeka.source.") || key === ZEKA_SETTING_KEYS.embeddings || key === ZEKA_SETTING_KEYS.embeddingModel) return "bilgi";
  if (key === ZEKA_SETTING_KEYS.persona || key === ZEKA_SETTING_KEYS.bannedTopics || key === ZEKA_SETTING_KEYS.language || key.startsWith("zeka.prompt.")) return "davranis";
  return "yuzeyler";
}

const ZEKA_DEFS_RAW: AnySettingDef[] = [
  ...perSurface,
  ...perSurfaceGovernance,
  ...officeLimits,
  ...sourceToggles,
  defineString({
    key: ZEKA_SETTING_KEYS.persona,
    default: "",
    maxLength: 800,
    multiline: true,
    category: "ai",
    label: "Zeka kişiliği ve tonu",
    description: "Tüm yüzeylerde GPT sistem istemine eklenen kişilik/ton tarifi (örn. 'Sıcak ve profesyonel; kısa yanıt ver').",
    impact: "Yalnız GPT yanıtlarının üslubunu etkiler; güvenlik, yazmama ve yetki kuralları her zaman önce gelir.",
  }),
  defineString({
    key: ZEKA_SETTING_KEYS.bannedTopics,
    default: "",
    maxLength: 2000,
    multiline: true,
    category: "ai",
    label: "Zeka yasaklı konular",
    description: "Her satıra bir konu ya da sözcük. Soru bunlardan birini içerirse Zeka (yerel ve GPT) nazikçe yanıt vermez.",
    impact: "Eşleşme Türkçe harf katlamasıyla yapılır (büyük/küçük ve ı/i farkı yok). Çok genel sözcük gereksiz reddettirir.",
  }),
  defineEnum({
    key: ZEKA_SETTING_KEYS.language,
    default: "tr",
    options: ZEKA_LANGUAGE_OPTIONS,
    category: "ai",
    label: "Zeka yanıt dili",
    description: "GPT yanıtlarının dili. Yerel zeka her zaman Türkçe yanıtlar.",
    impact: "Sorunun dilinde seçeneği yabancı ziyaretçiye kendi dilinde yanıt verir; ürün terimleri Türkçe kalır.",
  }),
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

export const ZEKA_SETTING_DEFS: AnySettingDef[] = ZEKA_DEFS_RAW.map((d) => {
  const tab = zekaSettingTab(d.key);
  return { ...d, home: { href: tab === "baglanti" ? "/admin/zeka" : `/admin/zeka?sekme=${tab}`, label: "Yapay zeka merkezi" } };
});
