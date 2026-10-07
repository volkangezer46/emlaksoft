/**
 * Müşteri TEK PORTAL modeli (SAF; vitest). Aynı kişi alıcı + malik + kiracı olabilir (sat-al): tek bağlantı
 * (`/musteri-portali/<token>`) rolüne göre sekme açar. Malik portalı bağlantıları (`/malik-portali/<token>`) geriye dönük
 * çalışır; tek portal yalnız o portföyün aktif malik bağlantısına köprü verir, yeni bağlantı ÜRETMEZ.
 */

export type PortalTab = "alici" | "malik" | "kiraci" | "belgeler";

export const PORTAL_TAB_LABELS: Record<PortalTab, string> = {
  alici: "Arayışım",
  malik: "Mülküm",
  kiraci: "Kiram",
  belgeler: "Belgeler",
};

export type PortalOwnerProperty = {
  id: string;
  label: string;
  listPrice: number | null;
  status: string;
  livePortals: number;
  offers: { amount: number; status: string; at: string | null }[];
  ownerPortalHref: string | null;
};

export type PortalRental = {
  id: string;
  label: string;
  monthlyRent: number;
  dueDay: number;
  startDate: string;
  endDate: string | null;
  charges: { period: string; amount: number; status: string }[];
  maintenance: { title: string; status: string; at: string }[];
};

export type PortalDocuments = {
  pendingSign: { id: string; title: string; href: string }[];
  signed: { id: string; title: string; signedAt: string | null }[];
};

/** Veri olan roller sırayla; hiçbiri yoksa alıcı (boş durum orada anlatılır). */
export function buildPortalTabs(counts: { buyer: number; owner: number; renter: number; documents: number }): PortalTab[] {
  const tabs: PortalTab[] = [];
  if (counts.buyer > 0) tabs.push("alici");
  if (counts.owner > 0) tabs.push("malik");
  if (counts.renter > 0) tabs.push("kiraci");
  if (counts.documents > 0) tabs.push("belgeler");
  return tabs.length ? tabs : ["alici"];
}

export function resolvePortalTab(raw: string | string[] | undefined, tabs: readonly PortalTab[]): PortalTab {
  const v = Array.isArray(raw) ? raw[0] : raw;
  return tabs.includes(v as PortalTab) ? (v as PortalTab) : tabs[0]!;
}

/**
 * İmzacı bu müşteri mi? `contract_signers`'ta müşteri kimliği yok: telefonun son 10 hanesi eşleşmeli (biçim farkı
 * eşleşmeyi bozmaz). Telefonlardan biri yoksa EŞLEŞMEZ (başkasının imza bağlantısı gösterilmez — fail-closed).
 */
export function signerMatchesCustomer(signerPhone: string | null | undefined, customerPhone: string | null | undefined): boolean {
  const a = String(signerPhone ?? "").replace(/\D/g, "").slice(-10);
  const b = String(customerPhone ?? "").replace(/\D/g, "").slice(-10);
  return a.length >= 7 && a === b;
}

export const RENT_CHARGE_LABELS: Record<string, string> = { pending: "Bekliyor", paid: "Ödendi", overdue: "Gecikti" };
export const MAINTENANCE_LABELS: Record<string, string> = { open: "Alındı", in_progress: "İşlemde", done: "Tamamlandı" };
export const OWNER_OFFER_LABELS: Record<string, string> = {
  submitted: "Değerlendiriliyor",
  accepted: "Kabul edildi",
  rejected: "Reddedildi",
  countered: "Karşı teklif yapıldı",
  withdrawn: "Geri çekildi",
};

/** RPC sonuç kodu → kullanıcı mesajı (tek yer). */
export function portalRequestMessage(code: string): { ok: boolean; text: string } {
  switch (code) {
    case "ok":
      return { ok: true, text: "İletildi. Danışmanınız en kısa sürede dönüş yapacak." };
    case "duplicate":
      return { ok: true, text: "Bu isteğiniz az önce iletildi; danışmanınız dönüş yapacak." };
    case "rate_limited":
      return { ok: false, text: "Bugün için istek sınırına ulaştınız. Lütfen danışmanınızı arayın." };
    case "invalid_amount":
      return { ok: false, text: "Geçerli bir teklif tutarı girin." };
    case "invalid_title":
      return { ok: false, text: "Kısa bir başlık yazın (en az 3 karakter)." };
    case "not_found":
      return { ok: false, text: "Kayıt bulunamadı ya da artık işlem yapılamıyor." };
    case "invalid_link":
      return { ok: false, text: "Bağlantı geçersiz veya süresi dolmuş." };
    default:
      return { ok: false, text: "İşlem kaydedilemedi. Lütfen tekrar deneyin." };
  }
}
