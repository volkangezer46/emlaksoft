/**
 * Ana ekran ROL YERLEŞİMİ — saf fonksiyon (React/DB yok; vitest kapsamında).
 *
 * Tek karar noktası: hangi rol hangi odak bloğunu, hangi KPI'ları ve hangi alt blokları görür.
 * `page.tsx` yalnız bu tarifi okuyup bloklara çevirir; rol dallanması başka yerde YOKTUR.
 *
 * Tasarım sistemi v4 (referans: /admin kontrol paneli): her rolde üstte DashboardHero (tarih, rol bazlı selamlama,
 * tek cümle öncelik, tazelik, dönem seçici) + KpiGrid. Altında role göre:
 *  - management  (owner/gm/branch_manager): Dikkat gerektirenler (+ içgörüler) + aylık komisyon eğrisi
 *                → ekip tablosu + satış hunisi/hedef → program/görev/kaçan komisyon.
 *  - advisor     (advisor, readonly): "Sıradaki eylem" odağı + "Bugün ara" (nedenli) + program/görev/kişisel hedef.
 *  - team_lead   : danışman yerleşimi + ekip satırı.
 *  - accounting  : odak = Tahsilat durumu; satış/müşteri blokları YOK.
 *  - call_center : yalnız arama ve yanıt süresi odaklı sade yerleşim.
 *
 * "Bir metrik ekranda bir kez": teyitsiz ilan, yetkisi dolan portföy, bekleyen komisyon ve geciken görev
 * yönetimde YALNIZ Dikkat listesindedir (KPI'da ve risk bloğunda tekrarlanmaz). Danışmana ofis geneli
 * teyit metriği gösterilmez (portal teyidi yönetimin işi).
 */

export type HomeVariant = "management" | "advisor" | "team_lead" | "accounting" | "call_center";

export type HomeFocus = "attention" | "next-action" | "collections" | "calls";

export type MetricKey =
  | "ciro"
  | "aktif-anlasma"
  | "yeni-talep"
  | "komisyon-bu-ay"
  | "yeni-musteri"
  | "arama"
  | "gorev"
  | "bekleyen-komisyon"
  | "geciken-kira"
  | "tahsil-edilen"
  | "yanit-suresi";

export type BottomBlock = "program" | "gorevler" | "risk" | "kisisel-hedef" | "gider-ozeti";
export type MoreBlock = "canli-akis" | "portal-sagligi" | "kaynak-dagilimi" | "yetki" | "portfoy" | "kiralama" | "hizli";

export type HomeLayout = {
  variant: HomeVariant;
  focus: HomeFocus;
  /** Hero'da "Ofis | Ben" anahtarı (yalnız ofis geneli veri kapsamı olan roller). */
  scopeSwitch: boolean;
  periodToggle: boolean;
  /** Durum çubuğu (örnek veri, kontör, kurulum, duyuru…). */
  statusBar: boolean;
  /** "Dikkat gerektirenler" listesi (+ içgörüler); yalnız yönetim. */
  attention: boolean;
  /** Aylık komisyon/ciro alan grafiği (komisyon görme izniyle). */
  revenueChart: boolean;
  /** KPI ızgarası; her metrik ekranda YALNIZ BİR KEZ. */
  metrics: MetricKey[];
  /** Ekip performansı tablosu. */
  team: boolean;
  /** Huni + ofis hedefi bloğu: yalnız yönetimde "office" (kişisel hedef `bottom: kisisel-hedef` ile gelir). */
  funnelTarget: "office" | null;
  /** "Bugün ara" nedenli arama tablosu. */
  callList: boolean;
  /** Canlı akış başlığındaki "Denetim kaydı" bağlantısı (denetim yönetimin işi). */
  auditLink: boolean;
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
  focus: "attention",
  scopeSwitch: true,
  periodToggle: true,
  statusBar: true,
  attention: true,
  revenueChart: true,
  metrics: ["ciro", "aktif-anlasma", "yeni-talep", "yeni-musteri", "arama"],
  team: true,
  funnelTarget: "office",
  callList: false,
  auditLink: true,
  bottom: ["program", "gorevler", "risk"],
  // "yetki" yok: yetkisi dolan portföy Dikkat listesinde (aynı sayı iki kez gösterilmez).
  more: ["portfoy", "kiralama", "canli-akis", "portal-sagligi", "kaynak-dagilimi", "hizli"],
};

const ADVISOR: HomeLayout = {
  variant: "advisor",
  focus: "next-action",
  scopeSwitch: false,
  periodToggle: true,
  statusBar: true,
  attention: false,
  revenueChart: false,
  metrics: ["komisyon-bu-ay", "yeni-musteri", "arama", "gorev"],
  team: false,
  // Kişisel hedef alt sıradaki "kisisel-hedef" bloğudur; ofis hunisi danışmanda çizilmez (ofis geneli veri).
  funnelTarget: null,
  callList: true,
  auditLink: false,
  bottom: ["program", "gorevler", "kisisel-hedef"],
  more: ["yetki", "portfoy", "kiralama", "canli-akis", "hizli"],
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
    attention: false,
    revenueChart: false,
    // Bekleyen komisyon odak bloğunda (Tahsilat) büyük gösterilir; KPI'da tekrarlanmaz.
    metrics: ["tahsil-edilen", "geciken-kira"],
    team: false,
    funnelTarget: null,
    callList: false,
    auditLink: false,
    bottom: ["gider-ozeti"],
    more: [],
  },
  call_center: {
    variant: "call_center",
    focus: "calls",
    scopeSwitch: false,
    periodToggle: false,
    statusBar: false,
    attention: false,
    revenueChart: false,
    metrics: ["arama", "yanit-suresi", "gorev"],
    team: false,
    funnelTarget: null,
    callList: true,
    auditLink: false,
    bottom: ["gorevler"],
    more: [],
  },
};

export function homeLayoutFor(role: string | null | undefined): HomeLayout {
  const l = LAYOUTS[homeVariantOf(role)];
  return { ...l, metrics: [...l.metrics], bottom: [...l.bottom], more: [...l.more] };
}

/** Satış/müşteri blokları (muhasebe ve arama merkezinde çizilmez). */
export function showsSalesBlocks(layout: HomeLayout): boolean {
  return layout.variant !== "accounting" && layout.variant !== "call_center";
}

/** Hero tarih satırının ikinci parçası (rol bazlı bağlam). */
export function heroContextLabel(layout: HomeLayout, officeView: boolean): string {
  switch (layout.variant) {
    case "management":
      return officeView ? "Ofis geneli" : "Benim işlerim";
    case "accounting":
      return "Tahsilat özeti";
    case "call_center":
      return "Arama merkezi";
    default:
      return "Benim günüm";
  }
}
