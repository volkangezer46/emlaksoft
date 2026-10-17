import "server-only";
import { openAiChat, type OpenAiCallAudit } from "@/lib/ai/openai-client";

/**
 * GPT araç döngüsü (tüm yüzeyler ortak). Tek OpenAI istemcisi (`openai-client.ts`): maskeleme, denetim kaydı, kredi /
 * platform kotası ölçümü orada. En çok `maxRounds` araç turu; araçlar SUNUCUDA, yerel motorla AYNI işlevlerle çalışır.
 * Model veri UYDURAMAZ: sayı ve kayıt yalnız araç sonucundan gelir (sistem istemi + araç çıktısı); kartlar ve eylemler
 * araç çıktısından kurulur, modelin metni yalnız açıklamadır.
 */

export type GptTool = { type: "function"; function: { name: string; description: string; parameters: Record<string, unknown> } };

type Msg =
  | { role: "system" | "user"; content: string }
  | { role: "assistant"; content: string | null; tool_calls?: { id: string; type: "function"; function: { name: string; arguments: string } }[] }
  | { role: "tool"; tool_call_id: string; content: string };

export type GptRunInput<T> = {
  apiKey: string;
  model: string;
  maxTokens: number;
  purpose: string;
  audit: OpenAiCallAudit;
  system: string;
  user: string;
  tools: readonly GptTool[];
  /** Araç çalıştırıcı: doğrulanmayan çağrı null döner (modele "reddedildi" gider). */
  runTool: (name: string, args: unknown) => Promise<{ result: T; summary: Record<string, unknown> } | null>;
  maxRounds?: number;
  timeoutMs?: number;
  signal?: AbortSignal;
};

export type GptRunOutput<T> = { content: string | null; calls: { name: string; result: T }[] };

export async function runGptWithTools<T>(input: GptRunInput<T>): Promise<GptRunOutput<T>> {
  const messages: Msg[] = [
    { role: "system", content: input.system },
    { role: "user", content: input.user },
  ];
  const calls: { name: string; result: T }[] = [];
  const rounds = input.maxRounds ?? 2;
  for (let round = 0; round <= rounds; round += 1) {
    const allowTools = round < rounds;
    const { content, toolCalls } = await openAiChat({
      apiKey: input.apiKey,
      purpose: input.purpose,
      audit: input.audit,
      timeoutMs: input.timeoutMs ?? 20_000,
      maxResponseBytes: 256 * 1024,
      signal: input.signal,
      retries: 0,
      body: {
        model: input.model,
        temperature: 0.2,
        max_tokens: input.maxTokens,
        messages,
        ...(allowTools ? { tools: input.tools, tool_choice: "auto" } : {}),
      },
    });
    const pending = allowTools ? (toolCalls ?? []) : [];
    if (pending.length === 0) return { content: content?.trim() || null, calls };
    messages.push({ role: "assistant", content: content ?? null, tool_calls: pending.map((c) => ({ id: c.id, type: "function", function: { name: c.name, arguments: c.arguments } })) });
    for (const c of pending.slice(0, 4)) {
      let args: unknown = {};
      try {
        args = JSON.parse(c.arguments || "{}");
      } catch {
        args = null;
      }
      const ran = args === null ? null : await input.runTool(c.name, args);
      if (ran) calls.push({ name: c.name, result: ran.result });
      messages.push({ role: "tool", tool_call_id: c.id, content: JSON.stringify(ran ? ran.summary : { durum: "reddedildi", detay: "Araç ya da parametre doğrulanamadı." }) });
    }
  }
  return { content: null, calls };
}

/** Ortak sistem istemi kuralları (Türkçe, uydurma yok, yazma yok, tam TL). */
export const ZEKA_RULES = [
  "Sen EmlakSoft Zeka'sın: Türk emlak ofisleri için çalışan yazılımın yerleşik asistanı. Türkçe, kısa (en çok 4 cümle), net yanıt ver.",
  "Sayı, kayıt, kişi adı ve tutarı YALNIZ araç sonuçlarından al; araç sonucu yoksa sayı verme ve 'emin değilim' de.",
  "Hiçbir kaydı sen oluşturamaz veya değiştiremezsin; oluşturma isteğinde prepare_create aracıyla form bağlantısı hazırla ve kullanıcının formu açıp kaydedeceğini söyle.",
  "Para tutarlarını tam yaz (₺12.500.000); 'milyon', 'Mn', 'bin' kısaltması kullanma.",
  "Araç 'yetki_yok' dönerse veriyi tahmin etme; kullanıcıya bu bilginin rolüne açık olmadığını söyle.",
  "Terimler: ofisin kaydı 'portföy', portaldaki karşılığı 'ilan', satış süreci 'anlaşma', kişi 'müşteri', aranan ev 'talep'.",
].join("\n");
