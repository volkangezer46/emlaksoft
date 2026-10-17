import type { KnowledgeBase } from "../knowledge/base";
import { anyPhrase, cleanQuery, tokens } from "../normalize";
import { clip, helpFromHits, type ToolOutput } from "../tools";
import { ZEKA_LOW_CONFIDENCE, type ZekaAction, type ZekaCard, type ZekaIntent, type ZekaResult } from "../types";

/**
 * PUBLIC (platform sitesi) yüzeyi — SAF yerel motor + GPT araç tanımları. Veri sınırı: YALNIZ herkese açık ürün içeriği
 * (paketler/fiyatlar `getPublicPricing`, site sayfaları SEO envanterinden, ana sayfa SSS, yardım SSS/rehber/sözlük,
 * onaylı public soru-cevap). Kiracı verisi, oturum ya da kişisel veri YOK. Ziyaretçi demo/kayda yönlendirilir.
 */

export type PublicEnv = { kb: KnowledgeBase; queryVector?: readonly number[] | null };

const CTA: ZekaAction[] = [
  { kind: "contact", label: "Ücretsiz dene", href: "/kayit" },
  { kind: "navigate", label: "Fiyatları gör", href: "/fiyatlar" },
];

const PRICE_CUES = ["fiyat", "ucret", "kac para", "kac tl", "ne kadar", "paket", "abonelik", "aylik", "yillik", "pahali", "ucuz", "kdv"];
const TRIAL_CUES = ["deneme", "demo", "ucretsiz", "bedava", "kayit", "uye ol", "hesap ac", "basla"];
const KVKK_CUES = ["kvkk", "kisisel veri", "gizlilik", "cerez", "guvenlik", "veri nerede", "sunucu"];

const filter = { surface: "public" as const };

export function publicTool(env: PublicEnv, name: string, args: unknown): ToolOutput | null {
  const a = (args && typeof args === "object" ? args : {}) as Record<string, unknown>;
  const q = typeof a.question === "string" ? a.question.slice(0, 300) : "";
  if (name === "pricing") return pricingOutput(env);
  if (name === "product_lookup" && q) return helpFromHits(env.kb.search(q, filter, { limit: 4, queryVector: env.queryVector }), q);
  return null;
}

function pricingOutput(env: PublicEnv): ToolOutput {
  const plans = env.kb.chunks.filter((c) => c.source === "plan" && c.id !== "plan:trial");
  const trial = env.kb.chunks.find((c) => c.id === "plan:trial");
  if (plans.length === 0) {
    return { answer: "Güncel paket ve fiyatlar Fiyatlar sayfasında.", cards: [], actions: CTA, followUps: [], answered: true, confidence: 0.6, summary: { durum: "sayfa" } };
  }
  const cards: ZekaCard[] = plans.slice(0, 5).map((p) => {
    const m = /aylık (₺[\d.]+)/.exec(p.body);
    return { kind: "metric", label: p.title, value: m ? `${m[1]}/ay` : "Fiyatlar sayfasında", hint: "KDV hariç", href: "/fiyatlar" };
  });
  return {
    answer: `EmlakSoft'ta ${plans.length} paket var; fiyatlar aylık ve KDV hariçtir.${trial ? ` ${trial.body.split(".")[0]}.` : ""}`,
    cards,
    actions: CTA,
    followUps: ["Paketler arasındaki fark ne?", "Kaç kullanıcı dahil?", "Verilerim güvende mi?"],
    answered: true,
    confidence: 0.9,
    summary: { durum: "bulundu", paketler: plans.map((p) => ({ ad: p.title, metin: clip(p.body, 300) })), deneme: trial?.body },
  };
}

export function answerLocalPublic(raw: string, env: PublicEnv): ZekaResult {
  const q = cleanQuery(raw);
  const toks = tokens(q);
  let intent: ZekaIntent = "howto";
  let out: ToolOutput;
  if (anyPhrase(toks, PRICE_CUES)) {
    intent = "data";
    out = pricingOutput(env);
  } else {
    const hits = env.kb.search(q, filter, { limit: 4, queryVector: env.queryVector, sources: anyPhrase(toks, KVKK_CUES) ? ["site", "faq", "qa", "glossary"] : undefined });
    out = helpFromHits(hits, q);
    if (anyPhrase(toks, TRIAL_CUES)) {
      intent = "navigate";
      out.answer = out.answered ? out.answer : "EmlakSoft'u kredi kartı olmadan ücretsiz deneyebilirsiniz; ofisinizi kayıt sayfasından birkaç dakikada açarsınız.";
      out.answered = true;
      out.confidence = Math.max(out.confidence, 0.75);
    }
    // Public yüzeyde iç panel bağlantısı (/app...) ziyaretçiye gösterilmez.
    out.cards = out.cards.map((c) => (c.kind === "help" && c.href?.startsWith("/app") ? { ...c, href: undefined } : c));
    out.actions = out.actions.filter((a) => !a.href.startsWith("/app"));
  }
  const conf = out.confidence;
  const actions = [...out.actions, ...CTA.filter((c) => !out.actions.some((a) => a.href === c.href))].slice(0, 3);
  return {
    surface: "public",
    engine: "local",
    intent,
    answer: !out.answered && conf < ZEKA_LOW_CONFIDENCE ? "Bu soruya kesin bir yanıtım yok. Fiyatlar ve özellikler sayfalarına bakabilir ya da ücretsiz denemeyle hemen deneyebilirsiniz." : out.answer,
    cards: out.cards,
    actions,
    followUps: out.followUps.length ? out.followUps : ["Fiyatlar ne kadar?", "Ücretsiz deneme var mı?", "Verilerim güvende mi?"],
    confidence: Math.round(conf * 100) / 100,
    answered: out.answered,
  };
}

export const ZEKA_PUBLIC_TOOL_DEFS = [
  {
    type: "function" as const,
    function: {
      name: "product_lookup",
      description: "EmlakSoft ürün bilgisi (özellikler, kullanım, KVKK/güvenlik, site sayfaları, onaylı soru-cevap) içinde arar.",
      parameters: { type: "object", properties: { question: { type: "string" } }, required: ["question"] },
    },
  },
  {
    type: "function" as const,
    function: {
      name: "pricing",
      description: "Güncel paketleri ve aylık fiyatları (KDV hariç, tam TL) ve ücretsiz deneme bilgisini getirir.",
      parameters: { type: "object", properties: {} },
    },
  },
];

export const PUBLIC_RULES = [
  "Sen EmlakSoft'un web sitesindeki asistansın; emlak ofislerine yazılımı tanıtırsın. Türkçe, kısa (en çok 4 cümle), samimi ve doğru yanıt ver.",
  "Fiyat, paket, özellik ve KVKK bilgisini YALNIZ araç sonuçlarından al; bilmediğini uydurma, Fiyatlar sayfasına ya da ücretsiz denemeye yönlendir.",
  "Para tutarlarını tam yaz (₺2.790); kısaltma kullanma. İndirim veya taahhüt sözü verme.",
  "Uygun olduğunda ziyaretçiyi ücretsiz denemeye (kayıt) davet et.",
].join("\n");
