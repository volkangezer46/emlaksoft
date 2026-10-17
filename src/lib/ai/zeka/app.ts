import "server-only";
import { now } from "@/lib/clock";
import { canAutoCallAi } from "@/lib/ai/auto-call-gate";
import { loadNlProvincesAndDistricts } from "@/lib/nl-search/geo-source";
import { log } from "@/lib/log";
import { externalErrorMetadata } from "@/lib/external-fetch";
import { getKnowledgeBase } from "./knowledge/store";
import { answerLocalApp } from "./local-engine";
import { createSupabaseZekaPort } from "./port-supabase";
import { canView, earningsAll, officeWide, type ZekaAppScope } from "./scope";
import { chooseEngine, readZekaConfig, zekaApiKey, type ZekaConfig } from "./settings";
import { buildCarry, historyPromptLine, isFollowUp, stripFollowParticles, type TurnCarry } from "./context";
import { bannedResult, bannedTopicHit, composeSystemPrompt } from "./policy";
import { zekaDailyAllowed } from "./limits";
import { classifyIntent } from "./intent";
import { extractSlots } from "./slots";
import { runAppTool, ZEKA_APP_TOOL_DEFS, type ToolEnv, type ToolOutput } from "./tools";
import { runGptWithTools, ZEKA_RULES } from "./gpt";
import { embedQuery } from "./embeddings";
import { logZekaQuery } from "./log";
import { roleLabel } from "@/lib/role-labels";
import type { ZekaAction, ZekaCard, ZekaIntent, ZekaResult } from "./types";
import type { ZekaStreamSink } from "./stream-protocol";

/**
 * Uygulama yüzeyi orkestrasyonu (sunucu): ayar → motor seçimi → yanıt → (GPT hatasında) yerel motora düşüş → günlük.
 * Öneri kipi (`suggest`) her zaman yerel ve hafiftir (sayım yok, günlük yok).
 */

export type AppAnswerOptions = {
  mode: "suggest" | "answer";
  signal?: AbortSignal;
  /** Aynı konuşmanın önceki soruları (eskiden yeniye, temizlenmiş; `sanitizeHistory`). */
  history?: readonly string[];
  /** Kullanıcının bulunduğu sayfa (`sanitizePage`; yalnız GPT bağlamı). */
  page?: string | null;
  /** Akış çıkışı (yalnız `stream: true` isteği): motor, GPT metin parçaları, akış ortası düşüşte sıfırlama. */
  sink?: ZekaStreamSink;
};

/** Günlük soru sınırı doldu (uç nokta 429 döner). */
export class ZekaLimitError extends Error {
  constructor() {
    super("zeka_daily_limit");
    this.name = "ZekaLimitError";
  }
}

export async function buildAppEnv(scope: ZekaAppScope, withVector?: { apiKey: string; model: string; query: string } | null): Promise<ToolEnv> {
  const [kb, geo] = await Promise.all([getKnowledgeBase("app"), loadNlProvincesAndDistricts().catch(() => undefined)]);
  let queryVector: number[] | null = null;
  if (withVector && kb.hasVectors) {
    queryVector = await embedQuery({ apiKey: withVector.apiKey, model: withVector.model, text: withVector.query, audit: { tenantId: scope.tenantId, actorId: scope.userId } }).catch(() => null);
  }
  return { scope, port: createSupabaseZekaPort(scope), kb, nowMs: now(), geo, queryVector };
}

/** Takip sorusuysa önceki turun bağlamı (değilse null): yuvalar yalnız gerçekten devam eden soruda taşınır. */
function carryFor(query: string, history: readonly string[], env: ToolEnv): TurnCarry | null {
  if (history.length === 0) return null;
  const opts = { nowMs: env.nowMs, geo: env.geo };
  const carry = buildCarry(history, opts);
  if (!carry) return null;
  return isFollowUp(query, extractSlots(stripFollowParticles(query), opts)) ? carry : null;
}

export async function answerApp(query: string, scope: ZekaAppScope, opts: AppAnswerOptions): Promise<ZekaResult> {
  const cfg = await readZekaConfig("app");
  if (!cfg.enabled) {
    return { surface: "app", engine: "local", intent: "unknown", answer: "Zeka bu platformda şu an kapalı.", cards: [], actions: [], followUps: [], confidence: 0, answered: false };
  }
  const history = opts.history ?? [];
  if (opts.mode === "suggest") {
    const env = await buildAppEnv(scope);
    return answerLocalApp(query, { ...env, carry: carryFor(query, history, env) }, { lite: true });
  }
  if (!(await zekaDailyAllowed("app", cfg, { user: scope.userId, office: scope.tenantId }))) throw new ZekaLimitError();
  if (bannedTopicHit(query, cfg.banned)) {
    const result = bannedResult("app");
    const logId = await logZekaQuery({ surface: "app", query, result });
    return logId ? { ...result, logId } : result;
  }

  const key = cfg.mode === "local" ? null : await zekaApiKey();
  const quotaOpen = key ? await canAutoCallAi(scope.tenantId) : false;
  const choice = chooseEngine(cfg.mode, Boolean(key), quotaOpen);
  let result: ZekaResult;
  const sink = opts.sink;
  if (choice.engine === "gpt" && key) {
    sink?.engine("gpt");
    const base = await buildAppEnv(scope, cfg.embeddings ? { apiKey: key, model: cfg.embeddingModel, query } : null);
    const env = { ...base, carry: carryFor(query, history, base) };
    let streamed = false;
    try {
      result = await answerGptApp(query, env, {
        apiKey: key,
        model: cfg.model,
        maxTokens: cfg.maxTokens,
        signal: opts.signal,
        policy: cfg,
        history,
        page: opts.page ?? null,
        ...(sink
          ? {
              onDelta: (t: string) => {
                streamed = true;
                sink.delta(t);
              },
              onDiscard: () => sink.reset(),
            }
          : {}),
      });
    } catch (e) {
      // Kullanıcı durdurdu / pencereyi kapattı: yerel motora düşme, günlük yazma.
      if (opts.signal?.aborted) throw e;
      log.warn("zeka_gpt_fallback", { surface: "app", ...externalErrorMetadata(e) });
      if (streamed) sink?.reset();
      sink?.engine("local");
      result = { ...(await answerLocalApp(query, env)), fallbackReason: "hata" };
    }
  } else {
    sink?.engine("local");
    const base = await buildAppEnv(scope);
    const env = { ...base, carry: carryFor(query, history, base) };
    result = await answerLocalApp(query, env);
    if (choice.reason) result.fallbackReason = choice.reason;
  }
  const slots = extractSlots(query, { nowMs: now() });
  const logId = await logZekaQuery({ surface: "app", query, result, names: slots.personName ? [slots.personName] : [] });
  return logId ? { ...result, logId } : result;
}

const TOOL_INTENT: Record<string, ZekaIntent> = {
  search_records: "search",
  count_metric: "data",
  prepare_create: "create",
  navigate: "navigate",
  help_lookup: "howto",
};

/** GPT motoru (uygulama): aynı araç seti fonksiyon çağrısıyla. Araç çağrısı ya da içerik yoksa HATA (çağıran yerel motora düşer). */
export async function answerGptApp(
  query: string,
  env: ToolEnv,
  cfg: {
    apiKey: string;
    model: string;
    maxTokens: number;
    signal?: AbortSignal;
    /** Yönetici davranış politikası (kişilik, yüzey eki, yasaklı konular, dil). */
    policy?: Pick<ZekaConfig, "persona" | "surfacePrompt" | "banned" | "language">;
    history?: readonly string[];
    page?: string | null;
    onDelta?: (text: string) => void;
    onDiscard?: () => void;
  },
): Promise<ZekaResult> {
  const slots = extractSlots(query, { nowMs: env.nowMs, geo: env.geo });
  const decision = classifyIntent(query, slots);
  const context = env.kb
    .search(query, { surface: "app", canView: (m) => canView(env.scope, m) }, { limit: 4, queryVector: env.queryVector })
    .map((h) => `- ${h.chunk.title}: ${h.chunk.body.slice(0, 400)}${h.chunk.href ? ` (sayfa: ${h.chunk.href})` : ""}`)
    .join("\n");
  const roleLine = `Kullanıcının rolü: ${roleLabel(env.scope.role)}. Ofis geneli veri kapsamı: ${officeWide(env.scope) ? "evet" : "hayır (yalnız kendi kayıtları)"}. Ofis geneli tutarları görebilir: ${earningsAll(env.scope) ? "evet" : "hayır"}. Bugün: ${new Date(env.nowMs).toISOString().slice(0, 10)}.`;
  const base = [ZEKA_RULES, roleLine, context ? `İLGİLİ ÜRÜN BİLGİSİ (yalnız gerekiyorsa kullan):\n${context}` : ""].filter(Boolean).join("\n\n");
  const system = cfg.policy
    ? composeSystemPrompt(base, cfg.policy, { history: cfg.history, page: cfg.page })
    : [base, historyPromptLine(cfg.history ?? [])].filter(Boolean).join("\n\n");

  const run = await runGptWithTools<ToolOutput>({
    apiKey: cfg.apiKey,
    model: cfg.model,
    maxTokens: cfg.maxTokens,
    purpose: "zeka_app",
    audit: { tenantId: env.scope.tenantId, actorId: env.scope.userId },
    system,
    user: query,
    tools: ZEKA_APP_TOOL_DEFS,
    signal: cfg.signal,
    onDelta: cfg.onDelta,
    onDiscard: cfg.onDiscard,
    runTool: async (name, args) => {
      const out = await runAppTool(env, name, args);
      return out ? { result: out, summary: out.summary } : null;
    },
  });
  if (!run.content && run.calls.length === 0) throw new Error("zeka_gpt_empty");

  const cards: ZekaCard[] = [];
  const actions: ZekaAction[] = [];
  const followUps: string[] = [];
  const seen = new Set<string>();
  for (const c of run.calls) {
    for (const card of c.result.cards) {
      const k = `${card.kind}:${"href" in card ? card.href : ""}:${"title" in card ? card.title : "label" in card ? card.label : ""}`;
      if (!seen.has(k)) {
        seen.add(k);
        cards.push(card);
      }
    }
    for (const a of c.result.actions) {
      if (seen.has(`a:${a.href}`)) continue;
      seen.add(`a:${a.href}`);
      actions.push(a);
    }
    followUps.push(...c.result.followUps);
  }
  const first = run.calls[0];
  const answered = run.calls.some((c) => c.result.answered) || (run.calls.length === 0 && Boolean(run.content));
  const toolConf = run.calls.length ? Math.max(...run.calls.map((c) => c.result.confidence)) : 0.6;
  return {
    surface: "app",
    engine: "gpt",
    intent: first ? (TOOL_INTENT[first.name] ?? decision.intent) : decision.intent,
    answer: run.content ?? first?.result.answer ?? "",
    cards: cards.slice(0, 8),
    actions: actions.slice(0, 4),
    followUps: [...new Set(followUps)].slice(0, 4),
    confidence: Math.round(Math.min(0.97, Math.max(toolConf, decision.confidence * 0.9)) * 100) / 100,
    answered,
  };
}
