import "server-only";
import { z } from "zod";
import { getOpenAiKey } from "@/lib/ai-advisor";
import { getOpenAiChatModel, openAiChat } from "@/lib/ai/openai-client";
import { takePlatformAiQuota } from "@/lib/ai/platform-quota";
import { outputNumbersAreGrounded } from "@/lib/ai/narrative-guard";
import { Redactor } from "@/lib/ai/redact";
import { riskyWordsIn } from "@/lib/site-content/schema";
import { DESC_MAX, TITLE_MAX } from "./rules";
import { canAutoOptimize, normalizePath } from "./scope";
import { readSeoAi } from "./store";

/**
 * SEO AI ÖNERİSİ (başlık, açıklama, paylaşım başlığı). Varsayılan KAPALI (`seo.ai = {enabled:false, monthlyLimit:300}`).
 * Kapılar (sırayla; ilk red ağ çağrısı YAPMADAN döner):
 *   1) ayar kapalı  2) çağıran super_admin değil (M4)  3) sayfa otomatik iyileştirme kapsamında değil (/kayit, /giris...)
 *   4) OpenAI anahtarı yok  5) platform AI kotası (atomik RPC; tablo yoksa "kota kurulmadı", fail-closed).
 * Girdi: sayfanın görünür metni, `redact.ts` ile maskelenmiş ve en çok 4 KB. GSC sorgu girdisi bu turda YOK.
 * Çıktı zod ile doğrulanır (TITLE_MAX / DESC_MAX); girdide olmayan sayı ve riskli vaat kelimeleri İŞARETLENİR (yayın
 * kararı insandadır: öneri yalnız taslağa yazılabilir). Çağrı kiracı kredisi kullanmaz; platform denetimine yazılır.
 */

export const SEO_AI_PURPOSE = "seo.ai.suggest";
export const SEO_AI_QUOTA_KEY = "seo.ai";
export const SEO_AI_INPUT_MAX_BYTES = 4 * 1024;

export type SeoAiSuggestion = {
  title: string;
  description: string;
  ogTitle: string | null;
  flags: { ungroundedNumbers: boolean; riskyWords: string[] };
};

export type SeoAiFailCode = "kapali" | "yetki" | "kapsam" | "anahtar" | "kota" | "girdi" | "hata";
export type SeoAiResult = { ok: true; suggestion: SeoAiSuggestion } | { ok: false; code: SeoAiFailCode; error: string };

export const SeoAiOutputSchema = z.object({
  title: z.string().trim().min(5).max(TITLE_MAX),
  description: z.string().trim().min(40).max(DESC_MAX),
  ogTitle: z.string().trim().max(TITLE_MAX).optional().nullable(),
});

/** Girdi hazırlığı (SAF): kişisel veri maskelenir, boşluklar sadeleşir, UTF-8 olarak en çok 4 KB'a kırpılır. */
export function prepareAiInput(visibleText: string): string {
  const masked = new Redactor().redactText(visibleText.replace(/\s+/g, " ").trim());
  const enc = new TextEncoder();
  if (enc.encode(masked).length <= SEO_AI_INPUT_MAX_BYTES) return masked;
  let lo = 0;
  let hi = masked.length;
  while (lo < hi) {
    const mid = Math.ceil((lo + hi) / 2);
    if (enc.encode(masked.slice(0, mid)).length <= SEO_AI_INPUT_MAX_BYTES) lo = mid;
    else hi = mid - 1;
  }
  return masked.slice(0, lo);
}

/** Model çıktısını doğrular ve işaretler (SAF). Geçersizse null. */
export function acceptAiOutput(raw: string | null, input: string): SeoAiSuggestion | null {
  if (!raw) return null;
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return null;
  }
  const r = SeoAiOutputSchema.safeParse(parsed);
  if (!r.success) return null;
  const { title, description } = r.data;
  const ogTitle = r.data.ogTitle?.trim() || null;
  const all = [title, description, ogTitle ?? ""].join(" ");
  return { title, description, ogTitle, flags: { ungroundedNumbers: !outputNumbersAreGrounded(all, input), riskyWords: riskyWordsIn(all) } };
}

const SYSTEM = `Sen bir SEO editörüsün. Verilen Türkçe sayfa metnine sadık kalarak arama sonucu için öneri üret.
Kurallar: yalnız metindeki bilgileri kullan, metinde olmayan sayı/fiyat/oran YAZMA, "en iyi", "garanti", "ücretsiz" gibi
abartılı vaat ekleme. Başlık en çok ${TITLE_MAX}, açıklama en çok ${DESC_MAX} karakter. Marka adını başlığa ekleme (şablon ekler).
Yanıtı YALNIZ şu JSON biçiminde ver: {"title":"...","description":"...","ogTitle":"..."}`;

export async function suggestSeoWithAi(input: {
  path: string;
  visibleText: string;
  actor: { id: string; role: string };
}): Promise<SeoAiResult> {
  const settings = await readSeoAi();
  if (!settings.enabled) return { ok: false, code: "kapali", error: "AI önerisi kapalı (SEO Genel > AI önerisi)." };
  if (input.actor.role !== "super_admin") return { ok: false, code: "yetki", error: "AI önerisini yalnız süper admin isteyebilir." };
  const path = normalizePath(input.path);
  if (!canAutoOptimize(path)) return { ok: false, code: "kapsam", error: "Bu sayfa otomatik öneri kapsamında değil (üyelik/oturum ya da ofis sayfası)." };
  const text = prepareAiInput(input.visibleText);
  if (text.length < 40) return { ok: false, code: "girdi", error: "Sayfada öneri üretecek kadar görünür metin yok." };
  const apiKey = await getOpenAiKey();
  if (!apiKey) return { ok: false, code: "anahtar", error: "OpenAI anahtarı tanımlı değil." };
  const quota = await takePlatformAiQuota(SEO_AI_QUOTA_KEY, settings.monthlyLimit);
  if (!quota.ok) return { ok: false, code: "kota", error: quota.message };

  try {
    const { content } = await openAiChat({
      apiKey,
      purpose: SEO_AI_PURPOSE,
      body: {
        model: getOpenAiChatModel(),
        temperature: 0.3,
        max_tokens: 400,
        response_format: { type: "json_object" },
        messages: [
          { role: "system", content: SYSTEM },
          { role: "user", content: `Sayfa yolu: ${path}\nSayfa metni:\n${text}` },
        ],
      },
      timeoutMs: 30_000,
      maxResponseBytes: 256 * 1024,
      audit: { platform: true, purpose: SEO_AI_PURPOSE, actorId: input.actor.id },
    });
    const suggestion = acceptAiOutput(content, text);
    if (!suggestion) return { ok: false, code: "hata", error: "AI yanıtı kurallara uymadı (uzunluk/biçim); tekrar deneyin." };
    return { ok: true, suggestion };
  } catch {
    return { ok: false, code: "hata", error: "AI önerisi alınamadı; daha sonra tekrar deneyin." };
  }
}
