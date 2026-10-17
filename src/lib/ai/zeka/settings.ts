import "server-only";
import { getSetting, getSettings } from "@/lib/settings/read";
import { getOpenAiKey } from "@/lib/ai-advisor";
import { getOpenAiChatModel } from "@/lib/ai/openai-client";
import { getPlatformSecret } from "@/lib/settings/read";
import { secretFingerprint } from "@/lib/settings/secrets";
import { ZEKA_KNOWLEDGE_SOURCES, ZEKA_OFFICE_LIMIT_SURFACES, ZEKA_SETTING_KEYS, type ZekaKnowledgeSourceId } from "@/lib/settings/registry/zeka";
import { parseBannedTopics } from "./policy";
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
  /** Yönetici kişilik/ton tarifi ve yüzey istemi eki (yalnız GPT sistem istemine; sunucuda kalır). */
  persona: string;
  surfacePrompt: string;
  /** Yasaklı konular (katlanmış, boşsuz). */
  banned: string[];
  language: "tr" | "auto";
  /** 24 saatlik sınırlar (0 = sınırsız). */
  dailyUser: number;
  dailyOffice: number;
};

const intOr = (v: unknown, d: number, max: number) => {
  const n = Number(v);
  return Number.isFinite(n) && n >= 0 ? Math.min(max, Math.floor(n)) : d;
};

export async function readZekaConfig(surface: ZekaSurface): Promise<ZekaConfig> {
  const keys = [
    ZEKA_SETTING_KEYS.enabled(surface),
    ZEKA_SETTING_KEYS.mode(surface),
    ZEKA_SETTING_KEYS.model,
    ZEKA_SETTING_KEYS.maxTokens,
    ZEKA_SETTING_KEYS.embeddings,
    ZEKA_SETTING_KEYS.embeddingModel,
    ZEKA_SETTING_KEYS.surfaceMaxTokens(surface),
    ZEKA_SETTING_KEYS.dailyUser(surface),
    ...((ZEKA_OFFICE_LIMIT_SURFACES as readonly string[]).includes(surface) ? [ZEKA_SETTING_KEYS.dailyOffice(surface as (typeof ZEKA_OFFICE_LIMIT_SURFACES)[number])] : []),
    ZEKA_SETTING_KEYS.persona,
    ZEKA_SETTING_KEYS.prompt(surface),
    ZEKA_SETTING_KEYS.bannedTopics,
    ZEKA_SETTING_KEYS.language,
  ];
  let v: Record<string, unknown> = {};
  try {
    v = await getSettings(keys);
  } catch {
    v = {};
  }
  const mode = String(v[ZEKA_SETTING_KEYS.mode(surface)] ?? "auto");
  const model = String(v[ZEKA_SETTING_KEYS.model] ?? "").trim();
  const surfaceTokens = intOr(v[ZEKA_SETTING_KEYS.surfaceMaxTokens(surface)], 0, 2000);
  const maxTokens = surfaceTokens >= 100 ? surfaceTokens : Number(v[ZEKA_SETTING_KEYS.maxTokens] ?? 600);
  const officeKey = (ZEKA_OFFICE_LIMIT_SURFACES as readonly string[]).includes(surface) ? ZEKA_SETTING_KEYS.dailyOffice(surface as (typeof ZEKA_OFFICE_LIMIT_SURFACES)[number]) : null;
  return {
    surface,
    enabled: v[ZEKA_SETTING_KEYS.enabled(surface)] !== false,
    mode: (ZEKA_MODES as readonly string[]).includes(mode) ? (mode as ZekaMode) : "auto",
    model: model || getOpenAiChatModel(),
    maxTokens: Number.isFinite(maxTokens) ? Math.min(2000, Math.max(100, maxTokens)) : 600,
    embeddings: v[ZEKA_SETTING_KEYS.embeddings] !== false,
    embeddingModel: String(v[ZEKA_SETTING_KEYS.embeddingModel] ?? "").trim() || "text-embedding-3-small",
    persona: String(v[ZEKA_SETTING_KEYS.persona] ?? "").trim().slice(0, 800),
    surfacePrompt: String(v[ZEKA_SETTING_KEYS.prompt(surface)] ?? "").trim().slice(0, 1500),
    banned: parseBannedTopics(String(v[ZEKA_SETTING_KEYS.bannedTopics] ?? "")),
    language: v[ZEKA_SETTING_KEYS.language] === "auto" ? "auto" : "tr",
    // Ayar okunamazsa sınır uygulanmaz (0); dakikalık hız sınırları yine geçerlidir.
    dailyUser: intOr(v[ZEKA_SETTING_KEYS.dailyUser(surface)], 0, 100000),
    dailyOffice: officeKey ? intOr(v[officeKey], 0, 999999) : 0,
  };
}

/** Kapatılmış bilgi kaynakları (parça `source` değerleri). Okunamazsa hiçbiri kapalı sayılmaz. */
export async function disabledKnowledgeSources(): Promise<Set<string>> {
  const ids = Object.keys(ZEKA_KNOWLEDGE_SOURCES) as ZekaKnowledgeSourceId[];
  let v: Record<string, unknown> = {};
  try {
    v = await getSettings(ids.map((id) => ZEKA_SETTING_KEYS.source(id)));
  } catch {
    v = {};
  }
  const out = new Set<string>();
  for (const id of ids) if (v[ZEKA_SETTING_KEYS.source(id)] === false) for (const src of ZEKA_KNOWLEDGE_SOURCES[id].sources) out.add(src);
  return out;
}

/**
 * Anahtar DURUMU (yönetim ekranı): tanımlı mı, kaynağı (panel/ortam) ve parmak izi. Değerin kendisi ASLA dönmez.
 */
export async function zekaKeyStatus(): Promise<{ configured: boolean; source: "db" | "env" | "none"; fingerprint: string | null }> {
  let db: string | null = null;
  try {
    db = (await getPlatformSecret("openai_api_key"))?.trim() || null;
  } catch {
    db = null;
  }
  const env = process.env.OPENAI_API_KEY?.trim() || null;
  const key = db ?? env;
  return {
    configured: Boolean(key),
    source: db ? "db" : env ? "env" : "none",
    fingerprint: key ? secretFingerprint(db ? "openai_api_key" : "env:OPENAI_API_KEY", key) : null,
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
