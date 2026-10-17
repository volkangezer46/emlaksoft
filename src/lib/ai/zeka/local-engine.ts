import { classifyIntent } from "./intent";
import { cleanQuery, foldQuery } from "./normalize";
import { inheritIntent, stripFollowParticles } from "./context";
import {
  toolCountMetric,
  toolHelpLookup,
  toolNavigate,
  toolPrepareCreate,
  toolSearchRecords,
  slotsFor,
  type ToolEnv,
  type ToolOutput,
} from "./tools";
import { ZEKA_LOW_CONFIDENCE, type ZekaEngine, type ZekaIntent, type ZekaResult } from "./types";

/**
 * YEREL ZEKA (uygulama yüzeyi): harici API YOK, her zaman çalışır. Akış: normalleştir → yuvalar → niyet → ARAÇ
 * (gerçek veri, RLS + yetki) → yapılandırılmış sonuç. GPT motoru aynı araçları fonksiyon çağrısıyla kullanır.
 * Emin olunamayan yanıt "emin değilim" der ve en yakın seçenekleri (sayfa + yardım) sunar; uydurma yoktur.
 */

export type LocalOptions = { /** Canlı öneri kipi: veri sayımı yapılmaz, yalnız hızlı araçlar. */ lite?: boolean };

export function createLocalAppEngine(opts: LocalOptions = {}): ZekaEngine<ToolEnv> {
  return {
    id: "local",
    async answer(query: string, env: ToolEnv): Promise<ZekaResult> {
      return answerLocalApp(query, env, opts);
    },
  };
}

export async function answerLocalApp(raw: string, env: ToolEnv, opts: LocalOptions = {}): Promise<ZekaResult> {
  const query = env.carry ? stripFollowParticles(raw) : cleanQuery(raw);
  // Takip sorusunda (env.carry dolu) eksik yuvalar önceki turdan gelir ve belirsiz niyet önceki turun niyetini sürdürür.
  const slots = slotsFor(env, query);
  const decision = env.carry ? inheritIntent(classifyIntent(query, slots), env.carry, query) : classifyIntent(query, slots);
  let intent: ZekaIntent = decision.intent;
  let out: ToolOutput;

  switch (intent) {
    case "howto": {
      out = toolHelpLookup(env, { question: query });
      // "Yetkiler nerede?" bir yer sorusudur: sayfa eşleşmesi daha güçlüyse gezinme yanıtı verilir.
      if (/\b(nerede|nereden|hangi sayfa|hangi ekran|nasil (acilir|giderim|bulurum|ulasirim))\b/.test(foldQuery(query))) {
        const nav = toolNavigate(env, { query });
        if (nav.answered && nav.confidence >= out.confidence) {
          intent = "navigate";
          out = nav;
        }
      }
      break;
    }
    case "data":
      out = opts.lite ? previewData(env, query) : await toolCountMetric(env, { query });
      if (!out.answered && !opts.lite) {
        // Sayı çıkmadıysa kayıt aramasına düş (ör. "Ahmet'in talepleri").
        const alt = await toolSearchRecords(env, { query });
        if (alt.answered) {
          intent = "search";
          out = alt;
        }
      }
      break;
    case "create":
      out = await toolPrepareCreate(env, { query });
      break;
    case "navigate":
    case "report":
      out = toolNavigate(env, { query: intent === "report" && !/rapor/i.test(query) ? `${query} rapor` : query });
      break;
    case "search":
      out = opts.lite && Object.keys(slots.propertyParams).length > 0 ? toolNavigate(env, { query }) : await toolSearchRecords(env, { query });
      if (!out.answered) {
        const nav = toolNavigate(env, { query });
        const help = toolHelpLookup(env, { question: query });
        const best = nav.confidence >= help.confidence ? nav : help;
        if (best.answered && best.confidence >= ZEKA_LOW_CONFIDENCE) {
          intent = best === nav ? "navigate" : "howto";
          out = best;
        }
      }
      break;
    default:
      out = toolNavigate(env, { query });
  }

  return finalize(out, intent, Math.min(decision.confidence, 1), slots);
}

/** Öneri kipi için veri sorusunun ÖNİZLEMESİ (sorgusuz): "Enter ile sayıyı getir" satırı. */
function previewData(env: ToolEnv, query: string): ToolOutput {
  const nav = toolNavigate(env, { query });
  return { ...nav, answer: "Enter'a basın, gerçek sayıyı getireyim.", answered: false };
}

function finalize(out: ToolOutput, intent: ZekaIntent, intentConfidence: number, slots: ReturnType<typeof slotsFor>): ZekaResult {
  // Güven = niyet güveni × araç güveni (ikisi de yüksekse yüksek).
  const confidence = Math.round(Math.min(intentConfidence, 1) * (out.answered ? Math.max(out.confidence, 0.5) : out.confidence) * 100) / 100;
  let answer = out.answer;
  if (!out.answered && out.cards.length === 0 && out.actions.length === 0) {
    answer = `${answer} Ne demek istediğinizi tam anlayamadım; şunları deneyebilirsiniz:`;
  }
  return {
    surface: "app",
    engine: "local",
    intent,
    answer,
    cards: out.cards,
    actions: out.actions,
    followUps: out.followUps.length > 0 ? out.followUps.slice(0, 4) : defaultFollowUps(intent),
    confidence,
    answered: out.answered,
    slots: {
      entity: slots.entity,
      status: slots.status,
      rooms: slots.rooms,
      priceMin: slots.priceMin,
      priceMax: slots.priceMax,
      placeLabel: slots.placeLabel,
      date: slots.date,
      time: slots.time,
      period: slots.period,
    },
  };
}

function defaultFollowUps(intent: ZekaIntent): string[] {
  if (intent === "howto") return ["Müşteri nasıl eklenir?", "Portföy nasıl yayına alınır?"];
  return ["Bugün kaç randevum var?", "Geciken görevler", "Bu ay kaç satış yaptık?"];
}
