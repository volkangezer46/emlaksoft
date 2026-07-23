import "server-only";

export type ContentKind = "listing" | "whatsapp" | "social" | "email";

export type PropertyContentInput = {
  title?: string | null;
  transactionType?: string | null;
  propertyType?: string | null;
  listPrice?: number | null;
  rooms?: string | null;
  sqm?: number | null;
  province?: string | null;
  district?: string | null;
  address?: string | null;
  officeName?: string | null;
  agentName?: string | null;
  agentPhone?: string | null;
  features?: Record<string, unknown> | null;
};

export function isOpenAiConfigured() {
  return Boolean(process.env.OPENAI_API_KEY);
}

function money(n?: number | null) {
  if (n == null) return "";
  return new Intl.NumberFormat("tr-TR", { maximumFractionDigits: 0 }).format(n) + " ₺";
}

function txLabel(tx?: string | null) {
  const t = (tx ?? "").toLowerCase();
  if (t.includes("kira") || t === "rent") return "kiralık";
  return "satılık";
}

function loc(input: PropertyContentInput) {
  return [input.district, input.province].filter(Boolean).join(", ");
}

function specLine(input: PropertyContentInput) {
  const parts: string[] = [];
  if (input.rooms) parts.push(input.rooms);
  if (input.sqm) parts.push(`${input.sqm} m²`);
  return parts.join(" · ");
}

/** Anahtar-tabanlı, SEO uyumlu profesyonel Türkçe içerik — API anahtarı gerekmez. */
export function templateContent(kind: ContentKind, input: PropertyContentInput): string {
  const tx = txLabel(input.transactionType);
  const type = input.propertyType || "gayrimenkul";
  const location = loc(input);
  const spec = specLine(input);
  const price = money(input.listPrice);
  const title = input.title || `${location ? location + " " : ""}${tx} ${type}`;

  if (kind === "whatsapp") {
    return [
      `Merhaba 👋`,
      ``,
      `${location ? `${location} bölgesinde ` : ""}${tx} *${type}* portföyümüz hakkında bilgi:`,
      `🏠 ${title}`,
      spec ? `📐 ${spec}` : "",
      price ? `💰 ${price}` : "",
      input.address ? `📍 ${input.address}` : "",
      ``,
      `Yerinde görmek veya detaylı bilgi için dönüş yapabilirim.`,
      input.agentName ? `${input.agentName}${input.officeName ? ` – ${input.officeName}` : ""}` : input.officeName || "",
      input.agentPhone ? `📞 ${input.agentPhone}` : "",
    ]
      .filter(Boolean)
      .join("\n");
  }

  if (kind === "social") {
    const hashtags = [
      "#emlak",
      `#${tx}`,
      input.province ? `#${String(input.province).replace(/\s+/g, "")}` : "",
      input.district ? `#${String(input.district).replace(/\s+/g, "")}` : "",
      type ? `#${String(type).replace(/\s+/g, "")}` : "",
      "#gayrimenkul",
    ].filter(Boolean);
    return [
      `✨ ${title} ✨`,
      ``,
      `${location ? `📍 ${location}` : ""}`,
      spec ? `🔑 ${spec}` : "",
      price ? `💰 ${price}` : "",
      ``,
      `Fırsatı kaçırmayın! Detaylar ve randevu için DM 📩`,
      input.agentPhone ? `📞 ${input.agentPhone}` : "",
      ``,
      hashtags.join(" "),
    ]
      .filter(Boolean)
      .join("\n");
  }

  if (kind === "email") {
    return [
      `Konu: ${title}`,
      ``,
      `Merhaba,`,
      ``,
      `İlgilenebileceğinizi düşündüğümüz ${location ? `${location} bölgesinde ` : ""}${tx} bir ${type} portföyümüzü paylaşmak istedim.`,
      ``,
      `• Başlık: ${title}`,
      spec ? `• Özellikler: ${spec}` : "",
      price ? `• Fiyat: ${price}` : "",
      input.address ? `• Konum: ${input.address}` : "",
      ``,
      `Yerinde inceleme veya ek bilgi için memnuniyetle yardımcı olurum.`,
      ``,
      `Saygılarımla,`,
      input.agentName || "",
      input.officeName || "",
      input.agentPhone || "",
    ]
      .filter(Boolean)
      .join("\n");
  }

  // listing (ilan açıklaması)
  return [
    `${title}`,
    ``,
    `${location ? `${location} konumunda yer alan ` : ""}${tx} ${type}${spec ? `, ${spec} ölçülerinde,` : ""} dikkat çekici bir yatırım ve yaşam fırsatı sunmaktadır.`,
    ``,
    `Öne çıkan özellikler:`,
    spec ? `• ${spec}` : "• Ferah ve kullanışlı yerleşim",
    `• Ulaşım, alışveriş ve sosyal olanaklara yakın konum`,
    `• Bölgenin değer kazanma potansiyeli yüksek`,
    price ? `\nFiyat: ${price}` : "",
    ``,
    `Detaylı bilgi, yerinde inceleme ve randevu için bizimle iletişime geçebilirsiniz.${input.officeName ? ` ${input.officeName} güvencesiyle.` : ""}`,
  ]
    .filter(Boolean)
    .join("\n");
}

const PROMPTS: Record<ContentKind, string> = {
  listing: "Portföy için profesyonel, SEO uyumlu, ikna edici bir Türkçe ilan açıklaması yaz (2-3 paragraf + madde imli özellikler).",
  whatsapp: "Bu portföyü bir müşteriye tanıtmak için kısa, samimi ve profesyonel bir WhatsApp mesajı yaz (emoji kullan, kısa tut).",
  social: "Bu portföy için Instagram/Facebook paylaşımı yaz (dikkat çekici, emoji ve ilgili hashtag'ler ile).",
  email: "Bu portföyü tanıtan resmi ama sıcak bir Türkçe e-posta metni yaz (konu satırı dahil).",
};

async function openAiContent(kind: ContentKind, input: PropertyContentInput): Promise<string | null> {
  const key = process.env.OPENAI_API_KEY;
  if (!key) return null;
  const model = process.env.OPENAI_MODEL || "gpt-4o-mini";

  const facts = JSON.stringify(
    {
      baslik: input.title,
      islem: txLabel(input.transactionType),
      tur: input.propertyType,
      fiyat: input.listPrice,
      oda: input.rooms,
      metrekare: input.sqm,
      il: input.province,
      ilce: input.district,
      adres: input.address,
      ofis: input.officeName,
      danisman: input.agentName,
      telefon: input.agentPhone,
    },
    null,
    0,
  );

  try {
    const res = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${key}` },
      body: JSON.stringify({
        model,
        temperature: 0.7,
        messages: [
          {
            role: "system",
            content:
              "Sen bir Türk emlak pazarlama uzmanısın. Yalnızca verilen gerçeklere dayan, uydurma bilgi ekleme. Türkçe yaz.",
          },
          { role: "user", content: `${PROMPTS[kind]}\n\nPortföy bilgileri (JSON): ${facts}` },
        ],
      }),
    });
    if (!res.ok) return null;
    const json = (await res.json()) as { choices?: { message?: { content?: string } }[] };
    return json.choices?.[0]?.message?.content?.trim() || null;
  } catch (e) {
    console.error("openAiContent", e);
    return null;
  }
}

export async function generateContent(
  kind: ContentKind,
  input: PropertyContentInput,
): Promise<{ text: string; source: "ai" | "template" }> {
  const ai = await openAiContent(kind, input);
  if (ai) return { text: ai, source: "ai" };
  return { text: templateContent(kind, input), source: "template" };
}
