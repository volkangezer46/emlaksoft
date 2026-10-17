import "server-only";
import { getSetting, getSettings } from "@/lib/settings/read";
import { getOpenAiKey } from "@/lib/ai-advisor";
import { getOpenAiChatModel } from "@/lib/ai/openai-client";
import { ZEKA_SETTING_KEYS } from "@/lib/settings/registry/zeka";
import { ZEKA_MODES, type ZekaMode, type ZekaSurface } from "./types";

/**
 * Zeka ayar okuyucusu (sunucu). Ayarlar registry'den (`zeka.*`, 30 sn önbellekli platform anlık görüntüsü); OpenAI
 * anahtarı MEVCUT gizli ayardan (`openai_api_key`, şifreli; yoksa OPENAI_API_KEY ortam değişkeni) — `getOpenAiKey`.
 * Anahtar eklenince kod değişmeden GPT devreye girer (kip "otomatik" ise).
 */

export type ZekaConfig = {
  surface: ZekaSurface;
  enabled: boolean;
  mode: ZekaMode;
  model: string;
  maxTokens: number;
  embeddings: boolean;
  embeddingModel: string;
};

export async function readZekaConfig(surface: ZekaSurface): Promise<ZekaConfig> {
  const keys = [
    ZEKA_SETTING_KEYS.enabled(surface),
    ZEKA_SETTING_KEYS.mode(surface),
    ZEKA_SETTING_KEYS.model,
    ZEKA_SETTING_KEYS.maxTokens,
    ZEKA_SETTING_KEYS.embeddings,
    ZEKA_SETTING_KEYS.embeddingModel,
  ];
  let v: Record<string, unknown> = {};
  try {
    v = await getSettings(keys);
  } catch {
    v = {};
  }
  const mode = String(v[ZEKA_SETTING_KEYS.mode(surface)] ?? "auto");
  const model = String(v[ZEKA_SETTING_KEYS.model] ?? "").trim();
  const maxTokens = Number(v[ZEKA_SETTING_KEYS.maxTokens] ?? 600);
  return {
    surface,
    enabled: v[ZEKA_SETTING_KEYS.enabled(surface)] !== false,
    mode: (ZEKA_MODES as readonly string[]).includes(mode) ? (mode as ZekaMode) : "auto",
    model: model || getOpenAiChatModel(),
    maxTokens: Number.isFinite(maxTokens) ? Math.min(2000, Math.max(100, maxTokens)) : 600,
    embeddings: v[ZEKA_SETTING_KEYS.embeddings] !== false,
    embeddingModel: String(v[ZEKA_SETTING_KEYS.embeddingModel] ?? "").trim() || "text-embedding-3-small",
  };
}

/** Yüzey girişi gösterilsin mi (sunucu bileşenleri; okunamazsa açık). */
export async function zekaSurfaceEnabled(surface: ZekaSurface): Promise<boolean> {
  try {
    return (await getSetting<boolean>(ZEKA_SETTING_KEYS.enabled(surface))) !== false;
  } catch {
    return true;
  }
}

/** Anahtar (gizli; asla loglanmaz, istemciye dönmez). */
export async function zekaApiKey(): Promise<string | null> {
  try {
    return await getOpenAiKey();
  } catch {
    return null;
  }
}

/**
 * Motor seçimi (SAF): yerel kipte hep yerel; otomatik/GPT kipinde anahtar VE kota varsa GPT. GPT seçilemezse nedeni döner.
 */
export function chooseEngine(mode: ZekaMode, hasKey: boolean, quotaOpen: boolean): { engine: "local" | "gpt"; reason?: string } {
  if (mode === "local") return { engine: "local" };
  if (!hasKey) return { engine: "local", reason: mode === "gpt" ? "anahtar_yok" : undefined };
  if (!quotaOpen) return { engine: "local", reason: "kota" };
  return { engine: "gpt" };
}
