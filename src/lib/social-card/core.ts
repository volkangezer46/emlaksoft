/**
 * Sosyal medya paylaşım kartı (SAF). Ticaret Bakanlığı (14.08.2026, ürün sahibi bildirimi): emlak ilanının sosyal
 * medyada paylaşılmasına izin verilir; HER paylaşımda EİDS'te doğrulanmış ilanın bağlantısı bulunmalıdır.
 *
 * KURAL (kodda zorunlu, testle kilitli):
 *  - EİDS doğrulamalı bağlantı = ofisin bu portföy için kaydettiği YAYINDAKİ portal ilanının (portal_listings, status
 *    'live') https bağlantısı. Vitrin sayfası EİDS'e bağlı bir platform olmadığı için bağlantı sayılmaz.
 *  - Bağlantı yoksa kart ve sosyal metin ÜRETİLMEZ (`SOCIAL_LINK_REQUIRED_MESSAGE`).
 *  - Kartta ve metinde yetki belgesi no ile EİDS taşınmaz no YALNIZ DOLUYSA yazılır (boşsa "eksik" yazılmaz).
 * Bu doğrulama resmî bir EİDS sorgusu DEĞİLDİR: bağlantının gerçekten doğrulanmış ilana gittiğini ofis teyit eder.
 */

export const SOCIAL_CARD_FORMATS = {
  kare: { width: 1080, height: 1080, label: "Gönderi (1080×1080)" },
  hikaye: { width: 1080, height: 1920, label: "Hikâye (1080×1920)" },
} as const;
export type SocialCardFormat = keyof typeof SOCIAL_CARD_FORMATS;

export function isSocialCardFormat(v: unknown): v is SocialCardFormat {
  return v === "kare" || v === "hikaye";
}

export const SOCIAL_LINK_REQUIRED_MESSAGE =
  "Sosyal medya paylaşımında EİDS'te doğrulanmış ilan bağlantısı zorunludur. Önce bu portföyün yayındaki portal ilanını bağlantısıyla kaydedin (Yayın & portallar sekmesi).";

export type PortalListingLink = { id: string; portalName: string | null; status: string | null; portalUrl: string | null };

/** Bağlantı güvenli mi: https + geçerli ana makine + kullanıcı bilgisi yok + makul uzunluk. */
export function isSafeListingUrl(raw: string | null | undefined): boolean {
  const s = String(raw ?? "").trim();
  if (!s || s.length > 500) return false;
  try {
    const u = new URL(s);
    return u.protocol === "https:" && Boolean(u.hostname) && u.hostname.includes(".") && !u.username && !u.password;
  } catch {
    return false;
  }
}

/** Yayındaki ve güvenli bağlantılı portal ilanları (kart için seçilebilir EİDS bağlantıları). */
export function eligibleListingLinks(listings: readonly PortalListingLink[]): PortalListingLink[] {
  return listings.filter((l) => l.status === "live" && isSafeListingUrl(l.portalUrl));
}

/** Seçilen kimlik geçerliyse onu, yoksa ilk uygun bağlantıyı döner; hiç yoksa null (kart üretilmez). */
export function pickListingLink(listings: readonly PortalListingLink[], preferredId?: string | null): PortalListingLink | null {
  const ok = eligibleListingLinks(listings);
  if (ok.length === 0) return null;
  return (preferredId ? ok.find((l) => l.id === preferredId) : null) ?? ok[0];
}

/** Uzun bağlantıyı kartta okunur kısaltır (alan adı + yolun başı). Paylaşım metninde TAM bağlantı kullanılır. */
export function displayUrl(url: string, max = 48): string {
  const s = url.replace(/^https:\/\//, "").replace(/\/$/, "");
  return s.length > max ? `${s.slice(0, max - 1)}…` : s;
}

export type SocialCompliance = { listingUrl: string; eidsNo: string | null; licenseNo: string | null; officeName: string | null };

/** Uyum satırları (kart altı ve metin sonu için ortak; boş alan satır üretmez). */
export function complianceLines(c: SocialCompliance): string[] {
  const lines: string[] = [];
  if (c.officeName?.trim()) lines.push(c.officeName.trim());
  if (c.licenseNo?.trim()) lines.push(`Yetki Belgesi No: ${c.licenseNo.trim()}`);
  if (c.eidsNo?.trim()) lines.push(`EİDS Taşınmaz No: ${c.eidsNo.trim()}`);
  lines.push(`Doğrulanmış ilan: ${c.listingUrl}`);
  return lines;
}

/**
 * Sosyal metnin sonuna zorunlu bağlantıyı ve (doluysa) belge numaralarını ekler. Metinde bağlantı zaten varsa
 * tekrar eklenmez; numaralar yoksa eklenir. İdempotent.
 */
export function ensureSocialCompliance(text: string, c: SocialCompliance): string {
  const body = text.replace(/\s+$/, "");
  const missing = complianceLines(c).filter((line) => {
    if (line.startsWith("Doğrulanmış ilan: ")) return !body.includes(c.listingUrl);
    return !body.includes(line);
  });
  if (missing.length === 0) return body;
  return `${body}\n\n${missing.join("\n")}`;
}
