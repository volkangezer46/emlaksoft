/**
 * Ana ekran ROL YERLEŞİMİ — saf fonksiyon (React/DB yok; vitest kapsamında).
 *
 * Tek karar noktası: hangi rol hangi odak bloğunu, hangi metrik şeridini ve hangi alt blokları görür.
 * `page.tsx` yalnız bu tarifi okuyup bloklara çevirir; rol dallanması başka yerde YOKTUR.
 *
 *  - management  (owner/gm/branch_manager): Brifing odağı + karar bekleyenler + metrik şeridi + ekip tablosu + huni/hedef.
 *  - advisor     (advisor, readonly): "Sıradaki eylem" odağı + "Bugün ara" (nedenli) + program/görev/kişisel hedef.
 *  - team_lead   : danışman yerleşimi + ekip satırı (ekip tablosu; yetki kapsamı metrik kütüphanesinde).
 *  - accounting  : odak = Tahsilat durumu; satış/müşteri blokları YOK.
 *  - call_center : yalnız arama ve yanıt süresi odaklı sade yerleşim.
 *
 * Karar notu (marka sahibi onaylamadı): /app ana ekranında gece-şehri (CityNight) hero'su KALDIRILDI;
 * yerini ince başlık satırı + metrik şeridi aldı. CityNight yalnız /admin hero'larında kalır.
 */

export type HomeVariant = "management" | "advisor" | "team_lead" | "accounting" | "call_center";

export type HomeFocus = "briefing" | "next-action" | "collections" | "calls";

export type MetricKey =
  | "ciro"
  | "aktif-anlasma"
  | "yeni-talep"
  | "teyit"
  | "komisyon-bu-ay"
  | "yeni-musteri"
  | "arama"
  | "gorev"
  | "bekleyen-komisyon"
  | "geciken-kira"
  | "tahsil-edilen"
  | "yanit-suresi";

export type BottomBlock = "program" | "gorevler" | "risk" | "kisisel-hedef" | "gider-ozeti";
export type MoreBlock =
  | "kuyruk"
  | "canli-akis"
  | "portal-sagligi"
  | "kaynak-dagilimi"
  | "yetki"
  | "portfoy"
  | "kiralama"
  | "hizli";

export type HomeLayout = {
  variant: HomeVariant;
  focus: HomeFocus;
  /** Üst satırda "Ofis | Ben" anahtarı (yalnız ofis geneli veri kapsamı olan roller). */
  scopeSwitch: boolean;
  periodToggle: boolean;
  /** Durum çubuğu (örnek veri, kontör, kurulum, duyuru…). */
  statusBar: boolean;
  /** Sağ kolonda "Karar bekleyenler" (metrik şeridi bunun altındadır). */
  decisions: boolean;
  /** Bağlamlı metrik şeridi; her metrik ekranda YALNIZ BİR KEZ. */
  metrics: MetricKey[];
  /** Ekip performansı tablosu. */
  team: boolean;
  /** Huni + ofis hedefi bloğu: yalnız yönetimde "office" (kişisel hedef `bottom: kisisel-hedef` ile gelir). */
  funnelTarget: "office" | null;
  /** "Bugün ara" nedenli arama tablosu. */
  callList: boolean;
  bottom: BottomBlock[];
  more: MoreBlock[];
};

const MANAGEMENT_ROLES = ["owner", "gm", "branch_manager"];

export function homeVariantOf(role: string | null | undefined): HomeVariant {
  if (role && MANAGEMENT_ROLES.includes(role)) return "management";
  if (role === "team_lead") return "team_lead";
  if (role === "accounting") return "accounting";
  if (role === "call_center") return "call_center";
  return "advisor";
}

const MANAGEMENT: HomeLayout = {
  variant: "management",
  focus: "briefing",
  scopeSwitch: true,
  periodToggle: true,
  statusBar: true,
  decisions: true,
  metrics: ["ciro", "aktif-anlasma", "yeni-talep", "teyit"],
  team: true,
  funnelTarget: "office",
  callList: false,
  bottom: ["program", "gorevler", "risk"],
  // "yetki" yok: yetkisi dolan portföy sayısı zaten Karar bekleyenler'de (aynı sayı iki kez gösterilmez).
  more: ["kuyruk", "portfoy", "kiralama", "canli-akis", "portal-sagligi", "kaynak-dagilimi", "hizli"],
};

const ADVISOR: HomeLayout = {
  variant: "advisor",
  focus: "next-action",
  scopeSwitch: false,
  periodToggle: true,
  statusBar: true,
  decisions: false,
  metrics: ["komisyon-bu-ay", "yeni-musteri", "arama", "teyit"],
  team: false,
  // Kişisel hedef alt sıradaki "kisisel-hedef" bloğudur; ofis hunisi danışmanda çizilmez (ofis geneli veri).
  funnelTarget: null,
  callList: true,
  bottom: ["program", "gorevler", "kisisel-hedef"],
  more: ["kuyruk", "yetki", "portfoy", "kiralama", "canli-akis", "hizli"],
};

const LAYOUTS: Record<HomeVariant, HomeLayout> = {
  management: MANAGEMENT,
  advisor: ADVISOR,
  team_lead: { ...ADVISOR, variant: "team_lead", team: true },
  accounting: {
    variant: "accounting",
    focus: "collections",
    scopeSwitch: false,
    periodToggle: false,
    statusBar: true,
    decisions: false,
    // Bekleyen komisyon odak bloğunda (Tahsilat) büyük gösterilir; şeritte tekrarlanmaz.
    metrics: ["tahsil-edilen", "geciken-kira"],
    team: false,
    funnelTarget: null,
    callList: false,
    bottom: ["gider-ozeti"],
    more: [],
  },
  call_center: {
    variant: "call_center",
    focus: "calls",
    scopeSwitch: false,
    periodToggle: false,
    statusBar: false,
    decisions: false,
    metrics: ["arama", "yanit-suresi", "gorev"],
    team: false,
    funnelTarget: null,
    callList: true,
    bottom: ["gorevler"],
    more: [],
  },
};

export function homeLayoutFor(role: string | null | undefined): HomeLayout {
  const l = LAYOUTS[homeVariantOf(role)];
  return { ...l, metrics: [...l.metrics], bottom: [...l.bottom], more: [...l.more] };
}

/**
 * "Bir metrik ekranda bir kez": teyit sayısı metrik şeridindeyse risk bloğu aynı sayıyı tekrar basmaz
 * (yalnız "kaçan komisyon" satırlarını gösterir).
 */
export function riskShowsTeyit(layout: HomeLayout): boolean {
  return !layout.metrics.includes("teyit");
}

/** Satış/müşteri blokları (muhasebe ve arama merkezinde çizilmez). */
export function showsSalesBlocks(layout: HomeLayout): boolean {
  return layout.variant !== "accounting" && layout.variant !== "call_center";
}
