/**
 * PORTAL KATALOĞU (SAF, VERİ; I/O yok; eklenti paketine de girer). Projede portal listesinin TEK kaynağı: aktarım
 * (`TRANSFER_PORTALS`), portföy avı (`FSBO_PORTALS`), portal ROI (`PORTAL_KEYS`/`PORTAL_LABEL`), eklenti etiketleri,
 * form seçenekleri ve ofis üyelikleri (`tenant_portal_accounts.portal` CHECK'i) buradan türer. Yeni portal = bu dosyaya bir
 * kayıt + migration'daki CHECK (sözleşme testi `membership.test.ts` ikisini karşılaştırır).
 *
 * `legacy: true` portal (Zingat) yalnız GEÇMİŞ veriyi göstermek içindir: üyelik sorulmaz, aktarım/kontrol yapılmaz;
 * eski gider (`expenses.portal_key`) ve talep kaynağı (`portal_zingat`) kayıtları okunmaya devam eder.
 */

/** Güncel (üyelik sorulan, eklentinin desteklediği) portallar; sıra = arayüz sırası. */
export const CURRENT_PORTALS = ["sahibinden", "hepsiemlak", "emlakjet"] as const;
/** Yalnız geçmiş veri için tutulan portallar. */
export const LEGACY_PORTALS = ["zingat"] as const;
/** Bütün bilinen portallar (güncel + geçmiş). */
export const ALL_PORTALS = [...CURRENT_PORTALS, ...LEGACY_PORTALS] as const;

export type CurrentPortal = (typeof CURRENT_PORTALS)[number];
export type LegacyPortal = (typeof LEGACY_PORTALS)[number];
export type PortalId = (typeof ALL_PORTALS)[number];

export type PortalSpec = {
  id: PortalId;
  /** Kısa Türkçe ad (arayüz). */
  label: string;
  /** Marka adı (gider/rapor satırı; ör. "Sahibinden.com"). */
  brandLabel: string;
  /** Kayıt alanı (bağlantı tanıma, ekstre eşleme). */
  host: string;
  /** Serbest metin eşlemesinde ek anahtar sözcükler (küçük harf, katlanmış). */
  aliases: readonly string[];
  /** Portal EİDS sorgusu yapıyor mu (Bakanlık entegrasyonu). */
  eids_integrated: boolean;
  /** Tarayıcı eklentisi bu portalı okuyabiliyor/doldurabiliyor mu. */
  extension_supported: boolean;
  /** Yalnız geçmiş veri: üyelik/aktarım/kontrol yok. */
  legacy: boolean;
};

export const PORTAL_CATALOG: Readonly<Record<PortalId, PortalSpec>> = {
  sahibinden: {
    id: "sahibinden",
    label: "Sahibinden",
    brandLabel: "Sahibinden.com",
    host: "sahibinden.com",
    aliases: ["sahibinden"],
    eids_integrated: true,
    extension_supported: true,
    legacy: false,
  },
  hepsiemlak: {
    id: "hepsiemlak",
    label: "Hepsiemlak",
    brandLabel: "Hepsiemlak",
    host: "hepsiemlak.com",
    aliases: ["hepsiemlak", "hepsi emlak"],
    eids_integrated: true,
    extension_supported: true,
    legacy: false,
  },
  emlakjet: {
    id: "emlakjet",
    label: "Emlakjet",
    brandLabel: "Emlak Jet",
    host: "emlakjet.com",
    aliases: ["emlakjet", "emlak jet"],
    eids_integrated: true,
    extension_supported: true,
    legacy: false,
  },
  zingat: {
    id: "zingat",
    label: "Zingat",
    brandLabel: "Zingat",
    host: "zingat.com",
    aliases: ["zingat"],
    eids_integrated: false,
    extension_supported: false,
    legacy: true,
  },
};

/** Portal kimliği → kısa ad. */
export const PORTAL_LABELS: Readonly<Record<PortalId, string>> = Object.fromEntries(ALL_PORTALS.map((id) => [id, PORTAL_CATALOG[id].label])) as Record<PortalId, string>;

export function isPortalId(v: unknown): v is PortalId {
  return typeof v === "string" && (ALL_PORTALS as readonly string[]).includes(v);
}

export function isCurrentPortal(v: unknown): v is CurrentPortal {
  return typeof v === "string" && (CURRENT_PORTALS as readonly string[]).includes(v);
}

/** `portal_listings.portal_name` normalleştirmesi (DB'deki `lower(btrim(portal_name))` ile aynı). */
export function normalizePortalName(name: string | null | undefined): string {
  return (name ?? "").trim().toLowerCase();
}

/**
 * Serbest metin portal adı ("Sahibinden.com", " sahibinden", "Emlak Jet") → katalog kimliği. Tanınmazsa null.
 * Türkçe büyük İ/I katlanır; içerme ile eşler (ör. "sahibinden.com").
 */
export function portalIdFromName(name: string | null | undefined): PortalId | null {
  const s = (name ?? "").trim().toLocaleLowerCase("tr-TR").replace(/ı/g, "i");
  if (!s) return null;
  for (const id of ALL_PORTALS) {
    if (PORTAL_CATALOG[id].aliases.some((a) => s.includes(a))) return id;
  }
  return null;
}

/**
 * Görünen ad: katalogdaki portal için kısa ad, ek kanal (ör. "emlaksoft vitrin") için kendi etiketi, diğerleri baş harfi
 * büyük. `portal_listings.portal_name` küçük harf saklandığından ekranlar ham değeri değil bunu basar.
 */
export function portalDisplayName(name: string | null | undefined): string {
  const id = portalIdFromName(name);
  if (id) return PORTAL_CATALOG[id].label;
  const extra = EXTRA_LISTING_CHANNELS.find((c) => c.value === normalizePortalName(name));
  if (extra) return extra.label;
  const raw = (name ?? "").trim();
  return raw ? raw.charAt(0).toLocaleUpperCase("tr-TR") + raw.slice(1) : "Portal";
}

/** İlan bağlama formlarındaki ek (katalog dışı) seçenekler; değerler normalleştirilmiş (küçük harf) saklanır. */
export const EXTRA_LISTING_CHANNELS = [
  { value: "emlaksoft vitrin", label: "EmlakSoft vitrin" },
  { value: "diğer", label: "Diğer" },
] as const;

/** Bağlama formu seçenekleri: güncel portallar + ek kanallar. */
export const LISTING_CHANNEL_OPTIONS: readonly { value: string; label: string }[] = [
  ...CURRENT_PORTALS.map((id) => ({ value: id, label: PORTAL_CATALOG[id].label })),
  ...EXTRA_LISTING_CHANNELS,
];

// ---------------------------------------------------------------- üyelik (tenant_portal_accounts) sözlüğü

export const MEMBERSHIP_STATUSES = ["active", "none", "unknown"] as const;
export type MembershipStatus = (typeof MEMBERSHIP_STATUSES)[number];

export const MEMBERSHIP_SOURCES = ["owner_declared", "inferred_listing", "inferred_expense", "extension_login"] as const;
export type MembershipSource = (typeof MEMBERSHIP_SOURCES)[number];

export const MEMBERSHIP_STATUS_LABEL: Readonly<Record<MembershipStatus, string>> = {
  active: "Üyeyiz",
  none: "Üye değiliz",
  unknown: "Bilmiyorum",
};

/** Üyelik kartının adresi (soluk portal satırlarındaki "Üye değilsiniz, ekle" bağlantısı). */
export const PORTAL_MEMBERSHIP_HREF = "/app/ayarlar?sekme=entegrasyon#portal-uyelikleri";

/** Üst üste bu kadar "giriş istedi" sonucunda ofis sahibine tek seferlik "üyelik bitti mi?" bildirimi gider. */
export const LOGIN_FAIL_NOTIFY_STREAK = 3;
