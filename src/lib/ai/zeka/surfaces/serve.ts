import "server-only";
import { log } from "@/lib/log";
import { externalErrorMetadata } from "@/lib/external-fetch";
import type { OpenAiCallAudit } from "@/lib/ai/openai-client";
import { runGptWithTools, type GptTool } from "../gpt";
import { logZekaQuery } from "../log";
import { chooseEngine, readZekaConfig, zekaApiKey } from "../settings";
import type { ToolOutput } from "../tools";
import type { ZekaAction, ZekaCard, ZekaIntent, ZekaResult, ZekaSurface } from "../types";

/**
 * Yüzey orkestrasyonu (public / vitrin / yönetim ortak): ayar → motor seçimi (kota kapısı) → GPT (aynı araçlar) →
 * hata/anahtar yok/kota → yerel motor → kişisel verisiz günlük. Uygulama yüzeyi kendi orkestrasyonunu `app.ts`te taşır.
 */

export type SurfaceSpec = {
  surface: ZekaSurface;
  local: () => ZekaResult | Promise<ZekaResult>;
  tools: readonly GptTool[];
  runTool: (name: string, args: unknown) => Promise<ToolOutput | null> | ToolOutput | null;
  rules: string;
  audit: OpenAiCallAudit;
  /** GPT'ye izin var mı (kota, ofis ayarı)? */
  quotaOpen: () => Promise<boolean>;
  /** Günlük için (vitrin: ofis kimliği). */
  tenantId?: string | null;
  defaultIntent: ZekaIntent;
};

const TOOL_INTENT: Record<string, ZekaIntent> = { pricing: "data", product_lookup: "howto", search_listings: "search", platform_summary: "data", navigate: "navigate", help_lookup: "howto" };

export async function serveSurface(query: string, mode: "suggest" | "answer", spec: SurfaceSpec, signal?: AbortSignal): Promise<ZekaResult | { disabled: true }> {
  const cfg = await readZekaConfig(spec.surface);
  if (!cfg.enabled) return { disabled: true };
  if (mode === "suggest") return spec.local();

  const key = cfg.mode === "local" ? null : await zekaApiKey();
  const quota = key ? await spec.quotaOpen().catch(() => false) : false;
  const choice = chooseEngine(cfg.mode, Boolean(key), quota);
  let result: ZekaResult;
  if (choice.engine === "gpt" && key) {
    try {
      const run = await runGptWithTools<ToolOutput>({
        apiKey: key,
        model: cfg.model,
        maxTokens: cfg.maxTokens,
        purpose: `zeka_${spec.surface}`,
        audit: spec.audit,
        system: spec.rules,
        user: query,
        tools: spec.tools,
        signal,
        runTool: async (name, args) => {
          const out = await spec.runTool(name, args);
          return out ? { result: out, summary: out.summary } : null;
        },
      });
      if (!run.content && run.calls.length === 0) throw new Error("zeka_gpt_empty");
      const cards: ZekaCard[] = [];
      const actions: ZekaAction[] = [];
      const seen = new Set<string>();
      for (const c of run.calls) {
        for (const card of c.result.cards) cards.push(card);
        for (const a of c.result.actions) {
          if (seen.has(a.href)) continue;
          seen.add(a.href);
          actions.push(a);
        }
      }
      const base = await spec.local();
      result = {
        ...base,
        engine: "gpt",
        intent: run.calls[0] ? (TOOL_INTENT[run.calls[0].name] ?? base.intent) : base.intent,
        answer: run.content ?? run.calls[0]?.result.answer ?? base.answer,
        cards: cards.length ? cards.slice(0, 8) : base.cards,
        actions: actions.length ? [...actions, ...base.actions.filter((a) => !seen.has(a.href))].slice(0, 4) : base.actions,
        answered: run.calls.some((c) => c.result.answered) || Boolean(run.content),
        confidence: Math.max(base.confidence, run.calls.length ? 0.8 : 0.65),
      };
    } catch (e) {
      log.warn("zeka_gpt_fallback", { surface: spec.surface, ...externalErrorMetadata(e) });
      result = { ...(await spec.local()), fallbackReason: "hata" };
    }
  } else {
    result = await spec.local();
    if (choice.reason) result.fallbackReason = choice.reason;
  }
  const logId = await logZekaQuery({ surface: spec.surface, query, result, tenantId: spec.tenantId });
  return logId ? { ...result, logId } : result;
}
