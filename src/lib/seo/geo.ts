import { AI_BOTS, type AiBotId } from "./schema-core";
import type { SeoGlobal, SeoRobotsSettings } from "./schema";

/**
 * YAPAY ZEKÂ ARAMA HAZIRLIĞI (GEO) — SAF. ChatGPT arama, Perplexity, Claude, Gemini/AI Overviews gibi yanıt
 * motorlarında görünmenin denetlenebilir koşulları: tarayıcı erişimi (yanıt botları engelli değil), makine okunur site
 * özeti (llms.txt), varlık tutarlılığı (Organization: ad, logo, sameAs, iletişim), soru-cevap yapısı (görünen SSS =
 * FAQPage) ve hatasız yapılandırılmış veri. Eğitim botlarını engellemek bir TERCİHTİR ve puan düşürmez.
 */

/** Kullanıcı sorusuna canlı yanıt üreten (arama/getirme) botlar: engellenirse yanıtlarda kaynak olarak çıkılmaz. */
export const AI_ANSWER_BOTS: readonly AiBotId[] = ["OAI-SearchBot", "ChatGPT-User", "Claude-SearchBot", "PerplexityBot"];
/** Model eğitimi için tarayan botlar: engellemek yanıt görünürlüğünü doğrudan etkilemez. */
export const AI_TRAINING_BOTS: readonly AiBotId[] = AI_BOTS.map((b) => b.id).filter((id) => !AI_ANSWER_BOTS.includes(id));

export type GeoCheck = { id: string; label: string; ok: boolean; partial?: boolean; detail: string; fix: string; weight: number };

export type GeoInput = {
  global: SeoGlobal;
  robots: SeoRobotsSettings;
  /** Robotun taradığı indekslenebilir sayfa sayısı ve bunlardan FAQPage taşıyan / JSON-LD hatası olmayan sayısı. */
  indexablePages: number;
  faqPages: number;
  ldCleanPages: number;
  /** Yayındaki indekslenebilir rehber yazısı sayısı. */
  guides: number;
};

export function geoReadiness(i: GeoInput): { score: number; checks: GeoCheck[] } {
  const blocked = new Set(i.robots.blockedAiBots);
  const answerBlocked = AI_ANSWER_BOTS.filter((b) => blocked.has(b));
  const org = i.global.organization;
  const sameAs = org.sameAs.filter(Boolean).length;
  const faqShare = i.indexablePages > 0 ? i.faqPages / i.indexablePages : 0;
  const ldShare = i.indexablePages > 0 ? i.ldCleanPages / i.indexablePages : 0;
  const checks: GeoCheck[] = [
    {
      id: "answer-bots",
      label: "Yapay zekâ yanıt botları siteye erişebiliyor",
      ok: answerBlocked.length === 0,
      detail: answerBlocked.length === 0 ? "ChatGPT arama, Perplexity ve Claude arama botları açık" : `Engelli: ${answerBlocked.join(", ")}`,
      fix: "Yanıt botlarını engellemek, yapay zekâ yanıtlarında kaynak olarak görünmeyi engeller; yalnız eğitim botlarını engelleyin.",
      weight: 3,
    },
    {
      id: "llms",
      label: "llms.txt ve llms-full.txt yayında",
      ok: i.robots.llmsTxtEnabled,
      detail: i.robots.llmsTxtEnabled ? "/llms.txt ve /llms-full.txt açık" : "Kapalı (404)",
      fix: "Ayarlar'dan llms.txt'i açın: site özeti ve rehber metinleri yapay zekâ araçlarına düz metin olarak sunulur.",
      weight: 1,
    },
    {
      id: "org-identity",
      label: "Kuruluş kimliği (ad, resmî unvan, logo)",
      ok: Boolean(org.name && org.legalName && org.logo),
      partial: Boolean(org.name && (org.legalName || org.logo)),
      detail: [org.name ? "ad" : null, org.legalName ? "unvan" : null, org.logo ? "logo" : null].filter(Boolean).join(", ") || "eksik",
      fix: "Genel ayarlarda kuruluş unvanını ve logo adresini girin: yanıt motorları markayı tek bir varlık olarak tanır.",
      weight: 2,
    },
    {
      id: "org-sameas",
      label: "Resmî profiller (sameAs)",
      ok: sameAs >= 2,
      partial: sameAs === 1,
      detail: `${sameAs} profil`,
      fix: "LinkedIn, Instagram, YouTube gibi resmî profilleri Genel ayarlara ekleyin (varlık tutarlılığı).",
      weight: 2,
    },
    {
      id: "org-contact",
      label: "İletişim bilgisi (e-posta ya da telefon)",
      ok: Boolean(org.email || org.phone),
      detail: org.email || org.phone ? "Var" : "Yok",
      fix: "Kuruluş e-postası ya da telefonunu girin.",
      weight: 1,
    },
    {
      id: "faq",
      label: "Soru-cevap yapısı (görünen SSS + FAQPage)",
      ok: faqShare >= 0.3 || i.faqPages >= 5,
      partial: i.faqPages > 0,
      detail: i.indexablePages > 0 ? `${i.faqPages}/${i.indexablePages} sayfada` : "Robot verisi yok",
      fix: "Sık sorulan soruları sayfada görünür biçimde yanıtlayın (rehber SSS bloğu, bölge sayfaları otomatik ekler).",
      weight: 2,
    },
    {
      id: "ld-clean",
      label: "Yapılandırılmış veri hatasız",
      ok: ldShare >= 0.95,
      partial: ldShare >= 0.7,
      detail: i.indexablePages > 0 ? `${i.ldCleanPages}/${i.indexablePages} sayfa` : "Robot verisi yok",
      fix: "Teknik tarama > Yapılandırılmış veri bölümündeki hataları giderin.",
      weight: 2,
    },
    {
      id: "guides",
      label: "Uzman içerik (rehber yazıları)",
      ok: i.guides >= 10,
      partial: i.guides > 0,
      detail: `${i.guides} yayında yazı`,
      fix: "Ofislerin sorduğu sorulara cevap veren rehber yazıları yayınlayın (yanıt motorları kaynak olarak alıntılar).",
      weight: 1,
    },
  ];
  const w = checks.reduce((s, c) => s + c.weight, 0);
  const score = Math.round((100 * checks.reduce((s, c) => s + c.weight * (c.ok ? 1 : c.partial ? 0.5 : 0), 0)) / w);
  return { score, checks };
}
