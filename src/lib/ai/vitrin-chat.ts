/**
 * Vitrin AI sohbet asistanı (SAF). Ofis ayarı `office.vitrin.ai_chat_enabled` (varsayılan KAPALI).
 *
 * KURALLAR (kod + istem):
 *  - Yalnız ilanın public alanlarıyla yanıt (bağlam `vitrin_chat_context` RPC'sinden); bilinmeyeni "danışmana sorun" der.
 *  - Fiyat pazarlığı / indirim sözü / kesin taahhüt YOK; hukuki-mali tavsiye YOK; ayrımcı yönlendirme YOK.
 *  - Her yanıt sonunda insan devri: talep formu (danışmana bağlan). WhatsApp/açık uçlu bot değildir, yapılandırılmış ilan asistanıdır.
 *  - Ziyaretçinin yazdığı kişisel veri `openai-client` içinde maskelenir; yanıtta telefon/e-posta/bağlantı varsa yanıt ATILIR.
 */

export type VitrinChatFacts = Record<string, string | number | null>;
export type ChatTurn = { role: "user" | "assistant"; content: string };

export const VITRIN_CHAT_MAX_QUESTION = 500;
export const VITRIN_CHAT_MAX_TURNS = 6;
export const VITRIN_CHAT_HANDOVER = "Daha fazla bilgi ve yer gösterme için aşağıdaki formdan danışmanımıza bağlanabilirsiniz.";

export function sanitizeHistory(raw: unknown): ChatTurn[] {
  if (!Array.isArray(raw)) return [];
  return raw
    .filter((t): t is { role: string; content: string } => !!t && typeof t === "object" && typeof (t as ChatTurn).content === "string")
    .filter((t) => t.role === "user" || t.role === "assistant")
    .slice(-VITRIN_CHAT_MAX_TURNS)
    .map((t) => ({ role: t.role as ChatTurn["role"], content: t.content.slice(0, VITRIN_CHAT_MAX_QUESTION) }));
}

export function buildVitrinChatMessages(office: string, facts: VitrinChatFacts, question: string, history: readonly ChatTurn[]) {
  const known = Object.fromEntries(Object.entries(facts).filter(([, v]) => v !== null && v !== ""));
  const system = [
    `Sen "${office}" emlak ofisinin vitrin sayfasındaki ilan asistanısın. Türkçe, kısa (en çok 4 cümle) ve nazik yanıt ver.`,
    "YALNIZ aşağıdaki ilan bilgilerini kullan. Bilgi yoksa uydurma; 'Bu bilgi ilanda yok, danışmanımız yardımcı olur' de.",
    "Fiyat pazarlığı yapma, indirim veya kesin söz verme; hukuki, vergi veya kredi tavsiyesi verme; kişileri özelliklerine göre yönlendirme.",
    "Telefon numarası, e-posta veya bağlantı yazma. Ziyaretçiden kişisel bilgi isteme; iletişim için sayfadaki formu öner.",
    `İlan bilgileri (JSON): ${JSON.stringify(known)}`,
  ].join("\n");
  return [{ role: "system" as const, content: system }, ...history, { role: "user" as const, content: question.slice(0, VITRIN_CHAT_MAX_QUESTION) }];
}

/** Model yanıtını güvenlik süzgecinden geçirir; uygunsuzsa null (çağıran sabit yönlendirme metni döner). */
export function guardVitrinAnswer(raw: string | null | undefined): string | null {
  const text = String(raw ?? "").trim();
  if (!text) return null;
  if (/(\+?\d[\d\s().-]{8,}\d|[^\s@]+@[^\s@]+\.[a-z]{2,}|https?:\/\/|www\.)/i.test(text)) return null;
  const clipped = text.length > 700 ? `${text.slice(0, 697)}...` : text;
  return `${clipped}\n\n${VITRIN_CHAT_HANDOVER}`;
}
