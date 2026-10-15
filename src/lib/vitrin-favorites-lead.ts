/**
 * Vitrin favorilerinden bilgi talebi — mevcut public aday ucuna (`/api/leads/[token]`, `intakeLead`) giden gövdeyi
 * kurar. Hız sınırı, sunucu honeypot'u ve KVKK açık rıza kaydı o uçta uygulanır; burada yalnız gövde üretilir.
 * Favori ilan kimlikleri `message` alanına (aday notu) yazılır: danışman hangi ilanların sorulduğunu talep kaydında görür.
 * Saf modül (istemci + test); sunucu kodu yok.
 */

/** Notta listelenecek en çok ilan (message alanı ucta 2000 karakterle kırpılır). */
export const FAVORITES_LEAD_MAX_ITEMS = 15;
/** Kaynak raporunda favoriler formundan gelen başvuruyu ayırır. */
export const FAVORITES_LEAD_SOURCE = "vitrin_favoriler";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export type FavoritesLeadItem = { id: string; title: string; href: string };

export type FavoritesLeadForm = {
  fullName: string;
  phone: string;
  kvkk: boolean;
  marketingOptIn: boolean;
  /** Honeypot (gizli alan). */
  website?: string;
};

export function buildFavoritesLeadMessage(items: readonly FavoritesLeadItem[]): string {
  const valid = items.filter((i) => UUID_RE.test(i.id));
  const shown = valid.slice(0, FAVORITES_LEAD_MAX_ITEMS);
  const lines = shown.map((i) => `- ${i.title.trim().slice(0, 80) || "İlan"} (ilan: ${i.id})`);
  const more = valid.length - shown.length;
  return [
    `Vitrin favorileri hakkında bilgi talebi (${valid.length} ilan):`,
    ...lines,
    ...(more > 0 ? [`… ve ${more} ilan daha`] : []),
  ].join("\n").slice(0, 2000);
}

export type FavoritesLeadPayload = {
  full_name: string;
  phone: string;
  kvkk: boolean;
  marketing_opt_in: boolean;
  website: string;
  message: string;
  request_id: string;
  channel: "web_form";
  source: string;
};

export function buildFavoritesLeadPayload(
  form: FavoritesLeadForm,
  items: readonly FavoritesLeadItem[],
  requestId: string,
): FavoritesLeadPayload {
  return {
    full_name: form.fullName.trim().slice(0, 120),
    phone: form.phone.trim(),
    kvkk: form.kvkk === true,
    marketing_opt_in: form.marketingOptIn === true,
    website: (form.website ?? "").trim(),
    message: buildFavoritesLeadMessage(items),
    request_id: requestId,
    channel: "web_form",
    source: FAVORITES_LEAD_SOURCE,
  };
}

/** İstemci ön denetimi (asıl doğrulama sunucuda). Hata yoksa null. */
export function favoritesLeadFormError(form: FavoritesLeadForm, itemCount: number): string | null {
  if (itemCount === 0) return "Bilgi almak için en az bir yayındaki favori ilan gerekli.";
  if (!form.fullName.trim()) return "Ad soyad zorunlu.";
  if (!form.phone.trim()) return "Cep telefonu zorunlu.";
  if (!form.kvkk) return "Devam etmek için KVKK onayı gerekli.";
  return null;
}
