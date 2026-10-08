/**
 * TV panosu saf mantığı (sunucu bağımlılığı YOK; istemci de kullanır).
 *
 * TV herkese açık odada görünür: müşteri telefonu/e-postası ASLA, ad soyad yalnız
 * "A. Yılmaz" biçiminde (baş harf + soyad) gösterilir.
 */

/* -------------------------------------------------------------------------- */
/* İsim kısaltma                                                               */
/* -------------------------------------------------------------------------- */

/** "Ayşe Nur Yılmaz" → "A. Yılmaz"; tek sözcük → baş harf + "."; boş → "Müşteri". */
export function shortName(full: string | null | undefined): string {
  const parts = String(full ?? "")
    .trim()
    .split(/\s+/)
    .filter(Boolean);
  if (parts.length === 0) return "Müşteri";
  const initial = (w: string) => w.charAt(0).toLocaleUpperCase("tr-TR");
  if (parts.length === 1) return `${initial(parts[0])}.`;
  const last = parts[parts.length - 1];
  return `${initial(parts[0])}. ${last.charAt(0).toLocaleUpperCase("tr-TR")}${last.slice(1).toLocaleLowerCase("tr-TR")}`;
}

/* -------------------------------------------------------------------------- */
/* Rotasyon (sayfalama)                                                        */
/* -------------------------------------------------------------------------- */

export const ROTATION_SECONDS = 12;
/** Ayarlanabilir rotasyon süreleri (sn): uzaktan okunacak kısa/uzun bekleme seçenekleri. */
export const ROTATION_OPTIONS = [8, 12, 20, 30] as const;

/** Saklanan rotasyon süresi güvenli aralığa iner (yalnız izinli değerler; aksi halde varsayılan). */
export function parseRotationSeconds(v: unknown): number {
  const n = Number(v);
  return (ROTATION_OPTIONS as readonly number[]).includes(n) ? n : ROTATION_SECONDS;
}

export function pageCount(total: number, perPage: number): number {
  if (!Number.isFinite(total) || total <= 0 || perPage <= 0) return 1;
  return Math.max(1, Math.ceil(total / perPage));
}

/** Sayfa dizini her zaman [0, pageCount) aralığında döner (taşma sarılır). */
export function pageAt<T>(items: readonly T[], perPage: number, tick: number): { page: number; pages: number; slice: T[] } {
  const pages = pageCount(items.length, perPage);
  const page = ((Math.floor(tick) % pages) + pages) % pages;
  return { page, pages, slice: items.slice(page * perPage, page * perPage + perPage) };
}

/* -------------------------------------------------------------------------- */
/* Bölümler, şablonlar, ayarlar                                                */
/* -------------------------------------------------------------------------- */

export const TV_SECTIONS = ["appointments", "goal", "league", "properties", "stats", "leads", "alerts", "events", "ticker"] as const;
export type TvSection = (typeof TV_SECTIONS)[number];

export const TV_SECTION_LABELS: Record<TvSection, string> = {
  appointments: "Bugünün randevuları",
  goal: "Aylık hedef",
  league: "Danışman ligi",
  properties: "Yeni portföyler",
  stats: "Talep ve müşteri",
  leads: "Yeni talepler",
  alerts: "Geciken / riskli",
  events: "Canlı akış",
  ticker: "Duyuru şeridi",
};

export type TvTemplate = "genel" | "satis" | "randevu";
export const TV_TEMPLATES: readonly { value: TvTemplate; label: string }[] = [
  { value: "genel", label: "Genel" },
  { value: "satis", label: "Satış odaklı" },
  { value: "randevu", label: "Randevu odaklı" },
];

export type TvTheme = "auto" | "light" | "dark";

export type TvSettings = {
  template: TvTemplate;
  /** Danışman gelirleri / ofis komisyonu. Varsayılan KAPALI; ayrıca sunucuda earnings_all şarttır. */
  showRevenue: boolean;
  ticker: boolean;
  theme: TvTheme;
  /** Kapalı bölümler. */
  hidden: TvSection[];
  /** Liste sayfaları ve dönen kartlar arası bekleme (sn). */
  rotationSec: number;
  /** Rotasyon duraklatıldı mı (yalnız oturum içi; saklanmaz). */
  paused?: boolean;
};

export const DEFAULT_TV_SETTINGS: TvSettings = {
  template: "genel",
  showRevenue: false,
  ticker: true,
  theme: "auto",
  hidden: [],
  rotationSec: ROTATION_SECONDS,
};

/** Saklanan (güvenilmeyen) değeri güvenli ayara çevirir. */
export function parseTvSettings(raw: unknown): TvSettings {
  let obj: unknown = raw;
  if (typeof raw === "string") {
    try {
      obj = JSON.parse(raw);
    } catch {
      return { ...DEFAULT_TV_SETTINGS };
    }
  }
  if (!obj || typeof obj !== "object") return { ...DEFAULT_TV_SETTINGS };
  const o = obj as Record<string, unknown>;
  const template = TV_TEMPLATES.some((t) => t.value === o.template) ? (o.template as TvTemplate) : "genel";
  const theme: TvTheme = o.theme === "light" || o.theme === "dark" ? o.theme : "auto";
  const hidden = Array.isArray(o.hidden)
    ? [...new Set(o.hidden.filter((s): s is TvSection => (TV_SECTIONS as readonly string[]).includes(String(s))))]
    : [];
  return {
    template,
    showRevenue: o.showRevenue === true,
    ticker: o.ticker !== false,
    theme,
    hidden,
    rotationSec: parseRotationSeconds(o.rotationSec),
  };
}

/** Şablona göre varsayılan bölüm kümesi (kullanıcı kapatmalarından ÖNCE). */
export function templateSections(template: TvTemplate): TvSection[] {
  switch (template) {
    case "satis":
      return ["goal", "league", "properties", "stats", "leads", "alerts", "events", "ticker"];
    case "randevu":
      return ["appointments", "stats", "leads", "alerts", "events", "properties", "ticker"];
    default:
      return [...TV_SECTIONS];
  }
}

/** Bölüm görünür mü: şablonda var, kullanıcı kapatmamış; duyuru şeridi ayrıca `ticker` anahtarına bağlı. */
export function isSectionVisible(settings: TvSettings, section: TvSection): boolean {
  if (!templateSections(settings.template).includes(section)) return false;
  if (settings.hidden.includes(section)) return false;
  if (section === "ticker" && !settings.ticker) return false;
  return true;
}

/** Gelir ancak ayar açık VE sunucu izin verdiyse gösterilir (çift kapı). */
export function canShowRevenue(settings: TvSettings, serverAllows: boolean): boolean {
  return settings.showRevenue && serverAllows;
}

/** Tema çözümü: "auto" → sistem tercihi. */
export function resolveTvDark(theme: TvTheme, systemDark: boolean): boolean {
  return theme === "dark" || (theme === "auto" && systemDark);
}

/* -------------------------------------------------------------------------- */
/* Olay akışı (kişisel veri YOK)                                               */
/* -------------------------------------------------------------------------- */

export type TvEventKind = "customer" | "appointment" | "deal" | "property" | "badge";

export const TV_EVENT_LABELS: Record<TvEventKind, string> = {
  customer: "Yeni müşteri eklendi",
  appointment: "Randevu tamamlandı",
  deal: "Teklif kabul edildi",
  property: "Yeni portföy eklendi",
  // Lig 2.0 kutlaması: kişi adı yok (TV ziyaretçiye açık ekrandır), yalnız olay.
  badge: "Yeni rozet kazanıldı",
};

export type TvEvent = { id: string; kind: TvEventKind; label: string; at: string };

/** Ham (id, tür, zaman) kayıtlarından en yeni N olayı üretir; etiket sabit metindir, kayıt içeriği taşımaz. */
export function buildTvEvents(
  raw: readonly { id: string; kind: TvEventKind; at: string | null | undefined }[],
  limit = 10,
): TvEvent[] {
  return raw
    .filter((r): r is { id: string; kind: TvEventKind; at: string } => Boolean(r.at) && Number.isFinite(Date.parse(String(r.at))))
    .sort((a, b) => Date.parse(b.at) - Date.parse(a.at))
    .slice(0, limit)
    .map((r) => ({ id: `${r.kind}:${r.id}`, kind: r.kind, label: TV_EVENT_LABELS[r.kind], at: r.at }));
}

/* -------------------------------------------------------------------------- */
/* Yeni talepler (kişisel veri YOK: yalnız kısa ad + kaynak etiketi + zaman)   */
/* -------------------------------------------------------------------------- */

const LEAD_SOURCE_LABELS: Record<string, string> = {
  web: "Web sitesi",
  web_sitesi: "Web sitesi",
  referral: "Referans",
  tavsiye: "Referans",
  phone: "Telefon",
  telefon: "Telefon",
  walk_in: "Ofis ziyareti",
  ofis_ziyareti: "Ofis ziyareti",
  social: "Sosyal medya",
  sosyal_medya: "Sosyal medya",
  portal: "Portal",
  portal_sahibinden: "Portal",
  portal_hepsiemlak: "Portal",
  portal_zingat: "Portal",
  portal_emlakjet: "Portal",
};

/** Müşteri kaynağı → TV etiketi; bilinmeyen/boş kaynak null (satırda gösterilmez). */
export function leadSourceLabel(source: string | null | undefined): string | null {
  const key = String(source ?? "").trim().toLowerCase();
  return key ? (LEAD_SOURCE_LABELS[key] ?? null) : null;
}

/* -------------------------------------------------------------------------- */
/* Kutlama ve yeni öğe tespiti                                                 */
/* -------------------------------------------------------------------------- */

/** İki yoklama arasında kazanılan anlaşma sayısı arttıysa kutla (ilk yüklemede `prev` null → kutlama yok). */
export function shouldCelebrate(prevWon: number | null, nextWon: number): boolean {
  return prevWon !== null && nextWon > prevWon;
}

/** Önceki listede olmayan kimlikler (yeni öğe vurgusu için). */
export function newIds(prev: ReadonlySet<string> | null, next: readonly string[]): Set<string> {
  const out = new Set<string>();
  if (!prev) return out;
  for (const id of next) if (!prev.has(id)) out.add(id);
  return out;
}

/* -------------------------------------------------------------------------- */
/* Veri kapsamı                                                                */
/* -------------------------------------------------------------------------- */

/** TV yalnız ofis geneli kapsam rolleri içindir (owner, gm, branch_manager). */
/** Ofis Panosu'nu (TV) görebilen roller (ofis geneli kapsam). */
export const TV_VIEW_ROLES = ["owner", "gm", "branch_manager"] as const;

export function canViewTv(role: string | null | undefined): boolean {
  return (TV_VIEW_ROLES as readonly string[]).includes(role ?? "");
}

/** Burn-in önleme: çok yavaş ±2px kayma (dakikada bir adım), saf fonksiyon. */
export function burnInOffset(minuteTick: number): { x: number; y: number } {
  const steps = [
    [0, 0],
    [1, 0],
    [2, 1],
    [1, 2],
    [0, 1],
    [-1, 2],
    [-2, 1],
    [-1, 0],
    [-2, -1],
    [-1, -2],
    [0, -1],
    [1, -2],
    [2, -1],
    [1, 0],
  ] as const;
  const i = ((Math.floor(minuteTick) % steps.length) + steps.length) % steps.length;
  return { x: steps[i][0], y: steps[i][1] };
}
