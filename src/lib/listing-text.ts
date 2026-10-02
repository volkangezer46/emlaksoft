/**
 * Portföyden portal ilanı için başlık + açıklama üretir.
 * Yalnız mevcut alanlar kullanılır; eksik alan atlanır, bilgi uydurulmaz.
 */

export type ListingTextInput = {
  title?: string | null;
  transaction_type?: string | null;
  property_type?: string | null;
  list_price?: number | null;
  province?: string | null;
  district?: string | null;
  features?: Record<string, unknown> | null;
};

// DİKKAT: bu sınırlar TAHMİNDİR, portalların resmî kurallarından doğrulanmadı. Uyarı metni bunu belirtir;
// doğrulanınca burası güncellenmelidir.
export const PORTAL_LIMITS = {
  Sahibinden: { title: 60, description: 10000 },
  Hepsiemlak: { title: 70, description: 5000 },
} as const;

export type ListingText = {
  title: string;
  description: string;
  warnings: string[];
};

function str(v: unknown): string | null {
  if (v == null) return null;
  const s = String(v).trim();
  return s ? s : null;
}

function num(v: unknown): number | null {
  if (v == null || v === "") return null;
  const n = Number(v);
  return Number.isFinite(n) && n > 0 ? n : null;
}

const fmt = new Intl.NumberFormat("tr-TR");

export function generateListingText(p: ListingTextInput): ListingText {
  const f = p.features ?? {};
  const rooms = str(f.rooms);
  const sqm = num(f.sqm) ?? num(f.net_sqm) ?? num(f.gross_sqm);
  const floor = str(f.floor);
  const age = str(f.building_age);
  const heating = str(f.heating);
  const facade = str(f.facade);
  const tx = str(p.transaction_type);
  const type = str(p.property_type);
  const district = str(p.district);
  const province = str(p.province);

  const titleParts = [
    district,
    [tx, rooms, type].filter(Boolean).join(" "),
    sqm != null ? `${fmt.format(sqm)} m²` : null,
  ].filter((x): x is string => Boolean(x));
  const title = titleParts.join(" ").replace(/\s+/g, " ").trim() || str(p.title) || "";

  const lines: string[] = [];
  const place = [district, province].filter(Boolean).join(", ");
  const kind = [rooms, type].filter(Boolean).join(" ");
  const intro = [place ? `${place} konumunda` : null, tx ? tx.toLocaleLowerCase("tr") : null, kind || null]
    .filter(Boolean)
    .join(" ");
  if (intro) lines.push(`${intro.charAt(0).toLocaleUpperCase("tr")}${intro.slice(1)}.`);

  const facts: string[] = [];
  if (tx) facts.push(`İşlem: ${tx}`);
  if (type) facts.push(`Tür: ${type}`);
  if (rooms) facts.push(`Oda sayısı: ${rooms}`);
  if (sqm != null) facts.push(`Alan: ${fmt.format(sqm)} m²`);
  if (floor) facts.push(`Bulunduğu kat: ${floor}`);
  if (age) facts.push(`Bina yaşı: ${age}`);
  if (heating) facts.push(`Isıtma: ${heating}`);
  if (facade) facts.push(`Cephe: ${facade}`);
  if (place) facts.push(`Konum: ${place}`);
  if (p.list_price != null && Number(p.list_price) > 0) {
    facts.push(`Fiyat: ${fmt.format(Number(p.list_price))} ₺`);
  }
  if (facts.length) lines.push("", ...facts.map((x) => `• ${x}`));
  if (lines.length) lines.push("", "Detaylı bilgi ve yer görme için bizimle iletişime geçebilirsiniz.");
  const description = lines.join("\n").trim();

  const warnings: string[] = [];
  if (!title) warnings.push("Başlık üretilemedi: tür, oda veya konum bilgisi eksik.");
  for (const [portal, lim] of Object.entries(PORTAL_LIMITS)) {
    if (title.length > lim.title) {
      warnings.push(`${portal} başlık sınırı ${lim.title} karakter; bu başlık ${title.length} karakter, kısaltın (sınır tahmindir, portal kurallarından doğrulayın).`);
    }
    if (description.length > lim.description) {
      warnings.push(`${portal} açıklama sınırı ${lim.description} karakter; bu metin ${description.length} (sınır tahmindir, portal kurallarından doğrulayın).`);
    }
  }
  return { title, description, warnings };
}
