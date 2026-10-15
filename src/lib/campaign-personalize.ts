/**
 * Kampanya mesajı kişiselleştirme — SAF (istemci önizlemesi ve teslimat işçisi aynı fonksiyonu kullanır).
 *
 * Sözdizimi uygulamanın şablon kütüphanesiyle AYNI tek süslü parantezdir (`src/lib/message-templates.ts`):
 *   {ad}           alıcının adı (ad soyadın ilk kelimesi; "Ayşe Yılmaz" → "Ayşe")
 *   {musteri}      alıcının ad soyadı
 *   {danisman}     müşterinin sorumlu danışmanı (yoksa kampanyayı oluşturan kişi)
 *   {ofis}         ofisin ticari adı
 *   {telefon}      ofisin telefonu
 *   {portfoy_link} ofis vitrini (tüm yayındaki portföyler)
 * Değeri olmayan bilinen alan boş bırakılır ve kalan boşluk temizlenir; bilinmeyen `{x}` aynen kalır.
 */

export const CAMPAIGN_VARIABLES = ["ad", "musteri", "danisman", "ofis", "telefon", "portfoy_link"] as const;
export type CampaignVariable = (typeof CAMPAIGN_VARIABLES)[number];
export type CampaignVars = Partial<Record<CampaignVariable, string | null | undefined>>;

export const CAMPAIGN_VARIABLE_HELP: { key: CampaignVariable; token: string; label: string }[] = [
  { key: "ad", token: "{ad}", label: "Ad" },
  { key: "musteri", token: "{musteri}", label: "Ad soyad" },
  { key: "danisman", token: "{danisman}", label: "Danışman" },
  { key: "ofis", token: "{ofis}", label: "Ofis" },
  { key: "telefon", token: "{telefon}", label: "Ofis telefonu" },
  { key: "portfoy_link", token: "{portfoy_link}", label: "Portföy bağlantısı" },
];

const KNOWN = new Set<string>(CAMPAIGN_VARIABLES);
const PLACEHOLDER_RE = /\{([a-z_]+)\}/g;

/** Ad soyaddan hitap adı: ilk kelime ("Dr." gibi kısaltmalar atlanır). */
export function firstName(fullName: string | null | undefined): string {
  const parts = String(fullName ?? "").trim().split(/\s+/).filter(Boolean);
  const first = parts.find((p) => !/\.$/.test(p)) ?? parts[0] ?? "";
  return first;
}

export function hasCampaignPlaceholders(body: string | null | undefined): boolean {
  if (!body) return false;
  for (const m of body.matchAll(PLACEHOLDER_RE)) if (KNOWN.has(m[1])) return true;
  return false;
}

/** Metindeki bilinmeyen yer tutucular (`{isim}` gibi yazım hataları) — formda uyarılır. */
export function unknownPlaceholders(body: string | null | undefined): string[] {
  const out = new Set<string>();
  for (const m of String(body ?? "").matchAll(PLACEHOLDER_RE)) if (!KNOWN.has(m[1])) out.add(m[0]);
  return [...out];
}

function tidy(text: string): string {
  return text
    .replace(/\r\n?/g, "\n")
    .replace(/[^\S\n]{2,}/g, " ")
    .replace(/[^\S\n]+([,.;:!?])/g, "$1")
    .split("\n")
    .map((line) => line.trim())
    .join("\n")
    .trim();
}

/** Yer tutucuları doldurur. Değerler yeniden taranmaz (müşteri adındaki `{...}` işlenmez). */
export function renderCampaignMessage(body: string, vars: CampaignVars): string {
  if (!body) return "";
  if (!hasCampaignPlaceholders(body)) return body;
  const filled = body.replace(PLACEHOLDER_RE, (match, key: string) => {
    if (!KNOWN.has(key)) return match;
    const v = vars[key as CampaignVariable];
    return typeof v === "string" ? v.trim() : "";
  });
  return tidy(filled);
}

/** Alıcı satırından değişken seti. */
export function recipientVars(
  recipient: { fullName: string | null; advisorName?: string | null },
  office: { name?: string | null; phone?: string | null; portfolioUrl?: string | null; fallbackAdvisor?: string | null },
): CampaignVars {
  return {
    ad: firstName(recipient.fullName),
    musteri: recipient.fullName ?? "",
    danisman: recipient.advisorName || office.fallbackAdvisor || "",
    ofis: office.name ?? "",
    telefon: office.phone ?? "",
    portfoy_link: office.portfolioUrl ?? "",
  };
}
