/**
 * Onaylı eylemli asistan (SAF): model yalnız ÖNERİ üretir; hiçbir şey kullanıcı "Onayla" demeden yazılmaz.
 * Desteklenen eylemler (kapalı liste, şemayla doğrulanır; model başka bir şey dönerse öneri REDDEDİLİR):
 *  - task           : tek görev (başlık + kaç gün sonra), atanan = kullanıcının kendisi
 *  - followup_plan  : takip planı = en çok 5 adımlık görev dizisi (gün ofsetleriyle)
 *  - message_draft  : bir müşteri listesine gönderilecek mesaj TASLAĞI (gönderilmez; kopyalanır / Kampanyalar'a götürülür)
 * Kişisel veri: istem `openai-client` içinde maskelenir; model telefon/e-posta üretse bile taslakta saklanmaz (yalnız metin).
 */
import { z } from "zod";

export const ASSISTANT_ACTION_TYPES = ["task", "followup_plan", "message_draft"] as const;
export type AssistantActionType = (typeof ASSISTANT_ACTION_TYPES)[number];

const title = z.string().trim().min(3).max(160);

export const AssistantProposalSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("task"), title, dueInDays: z.number().int().min(0).max(30), note: z.string().trim().max(500).optional() }),
  z.object({
    type: z.literal("followup_plan"),
    title,
    steps: z.array(z.object({ dayOffset: z.number().int().min(0).max(60), title })).min(1).max(5),
  }),
  z.object({
    type: z.literal("message_draft"),
    audience: z.string().trim().min(3).max(160),
    channel: z.enum(["sms", "whatsapp"]),
    message: z.string().trim().min(10).max(612),
  }),
]);

export type AssistantProposal = z.infer<typeof AssistantProposalSchema>;

export type ProposalParse = { ok: true; proposal: AssistantProposal } | { ok: false; error: string };

/** Model çıktısını (JSON metni) doğrular; kod bloğu sarmalı tolere edilir. */
export function parseAssistantProposal(raw: string | null | undefined): ProposalParse {
  if (!raw) return { ok: false, error: "Asistan bir öneri üretmedi." };
  const text = raw.trim().replace(/^```(?:json)?\s*/i, "").replace(/```\s*$/, "");
  let json: unknown;
  try {
    json = JSON.parse(text);
  } catch {
    return { ok: false, error: "Öneri okunamadı; isteği daha net yazmayı deneyin." };
  }
  if (json && typeof json === "object" && (json as { type?: unknown }).type === "none") {
    return { ok: false, error: "Bu istek desteklenen eylemlerden biri değil (görev, takip planı, mesaj taslağı)." };
  }
  const parsed = AssistantProposalSchema.safeParse(json);
  if (!parsed.success) return { ok: false, error: "Öneri beklenen biçimde değil; isteği yeniden yazın." };
  // Mesaj taslağında telefon/e-posta/bağlantı yer alamaz (taslak kitleye toplu gider).
  if (parsed.data.type === "message_draft" && /(\+?\d[\d\s]{8,}\d|@[^\s]+\.|https?:\/\/)/.test(parsed.data.message)) {
    return { ok: false, error: "Taslakta telefon, e-posta veya bağlantı olamaz; isteği düzenleyin." };
  }
  return { ok: true, proposal: parsed.data };
}

export const ASSISTANT_ACTION_SYSTEM_PROMPT = [
  "Türk emlak ofisi CRM'inde çalışan bir asistansın. Kullanıcının isteğini aşağıdaki eylemlerden BİRİNE çevir ve YALNIZ JSON döndür:",
  '{"type":"task","title":"...","dueInDays":0-30,"note":"..."}',
  '{"type":"followup_plan","title":"...","steps":[{"dayOffset":0-60,"title":"..."}]} (en çok 5 adım)',
  '{"type":"message_draft","audience":"hedef kitle tarifi","channel":"sms"|"whatsapp","message":"en çok 612 karakter, {ad} değişkeni kullanılabilir"}',
  'İstek bunlardan biri değilse {"type":"none"} döndür.',
  "Kurallar: Türkçe yaz; kişi adı, telefon, e-posta, bağlantı UYDURMA; fiyat veya kesin söz verme; eylemi kullanıcı onaylayacak.",
].join("\n");
