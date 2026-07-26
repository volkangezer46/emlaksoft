import "server-only";
import { getOpenAiKey } from "@/lib/ai-advisor";

const OPENAI_MODEL = "gpt-4o-mini";

export type CallSummaryInput = {
  notes: string;
  direction: string;            // inbound | outbound | missed
  disposition: string | null;   // görüşme sonuç kodu
  durationSec: number | null;
  customerName: string | null;
  startedAt: string;            // ISO
};

export type CallSummary = {
  summary: string;   // 2 cümlelik özet
  nextStep: string;  // 1 önerilen sonraki adım
};

const DIR_LABEL: Record<string, string> = { inbound: "Gelen", outbound: "Giden", missed: "Cevapsız" };

/**
 * Çağrı notu + meta → 2 cümlelik Türkçe özet ve 1 önerilen sonraki adım.
 *
 * Desen `lib/ai/briefing-summary.ts` ile aynı: anahtar önce DB ayarından
 * (`getOpenAiKey`), yoksa `OPENAI_API_KEY`. Anahtar yoksa veya çağrı
 * başarısız olursa `null` döner — UI'da buton/sonuç hiç görünmez.
 * Sonuç kaydedilmez; anlık üretilir.
 */
export async function generateCallSummary(input: CallSummaryInput): Promise<CallSummary | null> {
  if (!input.notes.trim()) return null;

  const apiKey = await getOpenAiKey();
  if (!apiKey) return null;

  const dur = input.durationSec
    ? `${Math.floor(input.durationSec / 60)} dk ${input.durationSec % 60} sn`
    : "bilinmiyor";
  const meta = [
    `Yön: ${DIR_LABEL[input.direction] ?? input.direction}`,
    `Müşteri: ${input.customerName ?? "bilinmiyor"}`,
    `Sonuç kodu: ${input.disposition ?? "yok"}`,
    `Süre: ${dur}`,
    `Tarih: ${new Intl.DateTimeFormat("tr-TR", { dateStyle: "medium", timeStyle: "short" }).format(new Date(input.startedAt))}`,
  ].join("\n");

  try {
    const res = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model: OPENAI_MODEL,
        temperature: 0.4,
        max_tokens: 220,
        response_format: { type: "json_object" },
        messages: [
          {
            role: "system",
            content:
              "Sen bir emlak ofisi danışman asistanısın. Sana bir telefon görüşmesinin notu ve meta bilgisi verilecek. " +
              'JSON döndür: {"ozet": "...", "sonraki_adim": "..."}. ' +
              '"ozet" TAM 2 cümlelik Türkçe özet olsun; "sonraki_adim" tek cümlelik somut bir sonraki adım önerisi olsun. ' +
              "Yalnızca verilen bilgiyi kullan; isim, fiyat veya tarih uydurma. Emoji kullanma.",
          },
          {
            role: "user",
            content: `Çağrı bilgisi:\n${meta}\n\nGörüşme notu:\n${input.notes}`,
          },
        ],
      }),
    });
    if (!res.ok) return null;
    const json = (await res.json()) as { choices?: { message?: { content?: string } }[] };
    const raw = json.choices?.[0]?.message?.content?.trim();
    if (!raw) return null;
    const parsed = JSON.parse(raw) as { ozet?: string; sonraki_adim?: string };
    const summary = parsed.ozet?.trim();
    const nextStep = parsed.sonraki_adim?.trim();
    if (!summary || !nextStep) return null;
    return { summary, nextStep };
  } catch (e) {
    console.error("generateCallSummary", e);
    return null;
  }
}
