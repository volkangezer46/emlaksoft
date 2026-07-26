import "server-only";

/**
 * Belge OCR (C8) — portföy medyasındaki görsel belgeden (tapu senedi /
 * yetki belgesi) alan çıkarma.
 *
 * content.ts'teki OpenAI desenini izler: anahtar `OPENAI_API_KEY`'den okunur,
 * anahtar yoksa çağrı yapılmadan hata döner (UI Türkçe mesajı gösterir).
 * Vision çağrısı için görsel ya doğrudan URL ile ya da base64 (data URL)
 * olarak gönderilir — auth'lu medya route'ları için server tarafında
 * storage'dan indirilen base64 kullanılmalıdır.
 *
 * HALÜSİNASYON GÜVENLİĞİ: Prompt, modelde bulunamayan/okunamayan her alan
 * için `null` döndürmeyi ZORUNLU kılar; temperature 0 ve JSON modu ile
 * uydurma değer riski en aza indirilir. Yine de sonuç her zaman kullanıcı
 * onayından geçmelidir (UI'da düzenlenebilir alanlar).
 */

export type PropertyDocFields = {
  /** Ada numarası (tapudaki "Ada No"). */
  ada: string | null;
  /** Parsel numarası (tapudaki "Parsel No"). */
  parsel: string | null;
  /** Bağımsız bölüm numarası. */
  bagimsiz_bolum: string | null;
  /** İl adı. */
  il: string | null;
  /** İlçe adı. */
  ilce: string | null;
  /** Mahalle / köy adı. */
  mahalle: string | null;
  /** Yüzölçümü, m² cinsinden sayı. */
  yuzolcumu_m2: number | null;
  /** Malik ad soyad (birden fazlaysa virgülle ayrılmış). */
  malik_ad_soyad: string | null;
  /** Tapu / belge tarihi — belgede yazdığı biçimde (örn. 12.05.2019). */
  tapu_tarihi: string | null;
};

export type DocOcrExtraction = {
  fields: PropertyDocFields;
  /** Modelin okuma kalitesine dair öz değerlendirmesi. */
  guven: "yüksek" | "orta" | "düşük";
  /** Okumayla ilgili serbest not (bulanıklık, kesik alan vb.) */
  not: string | null;
};

export type DocOcrResult = { ok: true; extraction: DocOcrExtraction } | { ok: false; error: string };

export function isDocOcrConfigured() {
  return Boolean(process.env.OPENAI_API_KEY);
}

const SYSTEM_PROMPT =
  "Sen Türk tapu senetleri ve emlak yetki belgeleri konusunda uzman bir belge okuma (OCR) asistanısın. " +
  "SADECE görselde açıkça okunabilen bilgiyi çıkarırsın. " +
  "KESİN KURAL: Bir alanı görselde bulamıyorsan, okuyamıyorsan veya emin değilsen o alan için MUTLAKA null döndür. " +
  "ASLA tahmin etme, tamamlama veya uydurma — yanlış tapu bilgisi hukuki sonuç doğurur. Yalnızca geçerli JSON döndür.";

const USER_PROMPT = `Bu görsel bir Türk tapu senedi veya emlak yetki belgesi olabilir. Aşağıdaki alanları çıkar ve TAM OLARAK şu JSON şemasıyla yanıtla (başka metin ekleme):

{
  "ada": string | null,            // Ada numarası
  "parsel": string | null,         // Parsel numarası
  "bagimsiz_bolum": string | null, // Bağımsız bölüm no
  "il": string | null,             // İl adı
  "ilce": string | null,           // İlçe adı
  "mahalle": string | null,        // Mahalle/köy adı
  "yuzolcumu_m2": number | null,   // Yüzölçümü, m² cinsinden SAYI (birim yazma)
  "malik_ad_soyad": string | null, // Malik(ler) ad soyad, birden fazlaysa virgülle
  "tapu_tarihi": string | null,    // Tapu/belge tarihi, belgede yazdığı biçimde
  "guven": "yüksek" | "orta" | "düşük", // Okumanın genel güven düzeyi
  "not": string | null             // Okumayı etkileyen durum (bulanık, kesik, belge tapu değil vb.)
}

Kurallar:
- Görselde bulamadığın veya net okuyamadığın HER alan için null döndür; asla tahmin etme.
- Görsel bir tapu/yetki belgesi değilse tüm alanları null yap, "not" alanında belirt.
- Sayıları rakam olarak yaz; yuzolcumu_m2 için ondalık ayracı nokta kullan.`;

function toStr(v: unknown): string | null {
  if (v == null) return null;
  const s = String(v).trim();
  if (!s || s.toLowerCase() === "null") return null;
  return s.slice(0, 300);
}

function toNum(v: unknown): number | null {
  if (v == null) return null;
  if (typeof v === "number") return Number.isFinite(v) && v > 0 ? v : null;
  let s = String(v).replace(/m²|m2/gi, "").trim();
  // Türkçe biçim: "1.250,50" → "1250.50" (virgül varsa noktalar binlik ayracıdır)
  if (s.includes(",")) s = s.replace(/\./g, "").replace(",", ".");
  const n = Number(s);
  return Number.isFinite(n) && n > 0 ? n : null;
}

function toGuven(v: unknown): "yüksek" | "orta" | "düşük" {
  const s = String(v ?? "").toLowerCase();
  if (s.includes("yüksek") || s.includes("yuksek") || s === "high") return "yüksek";
  if (s.includes("orta") || s === "medium") return "orta";
  return "düşük";
}

/**
 * Görsel belgeden tapu alanlarını çıkarır.
 *
 * @param input.imageUrl   Herkese açık erişilebilir görsel URL'i
 * @param input.imageBase64 Base64 kodlu görsel içeriği (auth'lu storage için)
 * @param input.mimeType   Base64 kullanılıyorsa MIME türü (varsayılan image/jpeg)
 */
export async function extractPropertyDocFields(input: {
  imageUrl?: string;
  imageBase64?: string;
  mimeType?: string | null;
}): Promise<DocOcrResult> {
  const key = process.env.OPENAI_API_KEY;
  if (!key) return { ok: false, error: "AI anahtarı tanımlı değil" };

  const url = input.imageBase64
    ? `data:${input.mimeType || "image/jpeg"};base64,${input.imageBase64}`
    : input.imageUrl;
  if (!url) return { ok: false, error: "Okunacak görsel bulunamadı." };

  // Vision gerektirir — content.ts ile aynı varsayılan (gpt-4o-mini vision destekler).
  const model = process.env.OPENAI_VISION_MODEL || process.env.OPENAI_MODEL || "gpt-4o-mini";

  try {
    const res = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${key}` },
      body: JSON.stringify({
        model,
        temperature: 0,
        response_format: { type: "json_object" },
        messages: [
          { role: "system", content: SYSTEM_PROMPT },
          {
            role: "user",
            content: [
              { type: "text", text: USER_PROMPT },
              { type: "image_url", image_url: { url, detail: "high" } },
            ],
          },
        ],
      }),
    });
    if (!res.ok) {
      console.error("extractPropertyDocFields http", res.status, await res.text().catch(() => ""));
      return { ok: false, error: "AI servisine ulaşılamadı. Lütfen tekrar deneyin." };
    }
    const json = (await res.json()) as { choices?: { message?: { content?: string } }[] };
    const raw = json.choices?.[0]?.message?.content?.trim() || "";
    // JSON modu dışına düşen modeller için kod bloğu temizliği
    const cleaned = raw.replace(/^```(?:json)?/i, "").replace(/```$/, "").trim();
    const parsed = JSON.parse(cleaned) as Record<string, unknown>;

    return {
      ok: true,
      extraction: {
        fields: {
          ada: toStr(parsed.ada),
          parsel: toStr(parsed.parsel),
          bagimsiz_bolum: toStr(parsed.bagimsiz_bolum),
          il: toStr(parsed.il),
          ilce: toStr(parsed.ilce),
          mahalle: toStr(parsed.mahalle),
          yuzolcumu_m2: toNum(parsed.yuzolcumu_m2),
          malik_ad_soyad: toStr(parsed.malik_ad_soyad),
          tapu_tarihi: toStr(parsed.tapu_tarihi),
        },
        guven: toGuven(parsed.guven),
        not: toStr(parsed.not),
      },
    };
  } catch (e) {
    console.error("extractPropertyDocFields", e);
    return { ok: false, error: "Belge okunamadı. Görselin net olduğundan emin olup tekrar deneyin." };
  }
}
