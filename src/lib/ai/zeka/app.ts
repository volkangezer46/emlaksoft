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
import { chooseEngine, readZekaConfig, zekaApiKey } from "./settings";
import { classifyIntent } from "./intent";
import { extractSlots } from "./slots";
import { runAppTool, ZEKA_APP_TOOL_DEFS, type ToolEnv, type ToolOutput } from "./tools";
import { runGptWithTools, ZEKA_RULES } from "./gpt";
import { embedQuery } from "./embeddings";
import { logZekaQuery } from "./log";
import { roleLabel } from "@/lib/role-labels";
import type { ZekaAction, ZekaCard, ZekaIntent, ZekaResult } from "./types";

/**
 * Uygulama yüzeyi orkestrasyonu (sunucu): ayar → motor seçimi → yanıt → (GPT hatasında) yerel motora düşüş → günlük.
 * Öneri kipi (`suggest`) her zaman yerel ve hafiftir (sayım yok, günlük yok).
 */

export type AppAnswerOptions = { mode: "suggest" | "answer"; signal?: AbortSignal };

export async function buildAppEnv(scope: ZekaAppScope, withVector?: { apiKey: string; model: string; query: string } | null): Promise<ToolEnv> {
  const [kb, geo] = await Promise.all([getKnowledgeBase("app"), loadNlProvincesAndDistricts().catch(() => undefined)]);
  let queryVector: number[] | null = null;
  if (withVector && kb.hasVectors) {
    queryVector = await embedQuery({ apiKey: withVector.apiKey, model: withVector.model, text: withVector.query, audit: { tenantId: scope.tenantId, actorId: scope.userId } }).catch(() => null);
  }
  return { scope, port: createSupabaseZekaPort(scope), kb, nowMs: now(), geo, queryVector };
}

export async function answerApp(query: string, scope: ZekaAppScope, opts: AppAnswerOptions): Promise<ZekaResult> {
  const cfg = await readZekaConfig("app");
  if (!cfg.enabled) {
    return { surface: "app", engine: "local", intent: "unknown", answer: "Zeka bu platformda şu an kapalı.", cards: [], actions: [], followUps: [], confidence: 0, answered: false };
  }
  if (opts.mode === "suggest") {
    const env = await buildAppEnv(scope);
    return answerLocalApp(query, env, { lite: true });
  }

  const key = cfg.mode === "local" ? null : await zekaApiKey();
  const quotaOpen = key ? await canAutoCallAi(scope.tenantId) : false;
  const choice = chooseEngine(cfg.mode, Boolean(key), quotaOpen);
  let result: ZekaResult;
  if (choice.engine === "gpt" && key) {
    const env = await buildAppEnv(scope, cfg.embeddings ? { apiKey: key, model: cfg.embeddingModel, query } : null);
    try {
      result = await answerGptApp(query, env, { apiKey: key, model: cfg.model, maxTokens: cfg.maxTokens, signal: opts.signal });
    } catch (e) {
      log.warn("zeka_gpt_fallback", { surface: "app", ...externalErrorMetadata(e) });
      result = { ...(await answerLocalApp(query, env)), fallbackReason: "hata" };
    }
  } else {
    const env = await buildAppEnv(scope);
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
  cfg: { apiKey: string; model: string; maxTokens: number; signal?: AbortSignal },
): Promise<ZekaResult> {
  const slots = extractSlots(query, { nowMs: env.nowMs, geo: env.geo });
  const decision = classifyIntent(query, slots);
  const context = env.kb
    .search(query, { surface: "app", canView: (m) => canView(env.scope, m) }, { limit: 4, queryVector: env.queryVector })
    .map((h) => `- ${h.chunk.title}: ${h.chunk.body.slice(0, 400)}${h.chunk.href ? ` (sayfa: ${h.chunk.href})` : ""}`)
    .join("\n");
  const roleLine = `Kullanıcının rolü: ${roleLabel(env.scope.role)}. Ofis geneli veri kapsamı: ${officeWide(env.scope) ? "evet" : "hayır (yalnız kendi kayıtları)"}. Ofis geneli tutarları görebilir: ${earningsAll(env.scope) ? "evet" : "hayır"}. Bugün: ${new Date(env.nowMs).toISOString().slice(0, 10)}.`;
  const system = [ZEKA_RULES, roleLine, context ? `İLGİLİ ÜRÜN BİLGİSİ (yalnız gerekiyorsa kullan):\n${context}` : ""].filter(Boolean).join("\n\n");

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
