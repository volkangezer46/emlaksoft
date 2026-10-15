/**
 * Kurulum sihirbazı ADIM KAYDI — sihirbazın adım listesinin TEK kaynağı (SAF; I/O yok).
 *
 * Kayıt dört soruluktur (ad, cep, e-posta, şifre); ofisin geri kalanı üye olduktan sonra `/app/baslangic` sihirbazında
 * tamamlanır. Her adım atlanabilir, ilerleme gerçek veriden hesaplanır (sahte ilerleme yok), "sonra yaparım" tercihi
 * kullanıcı profilindedir (`profiles.ui_state`, `setup-skip.ts`; cihazlar arası). Ana ekran Başlangıç kartı, Ayarlar dizini,
 * Yardım ve sihirbaz AYNI listeyi okur. İsteğe bağlı adımlar (`optional`) yüzdeye ve "tamamlandı" kararına katılmaz.
 *
 * YENİ ADIM EKLEMEK (ör. "Giderler ve kasa"):
 *  1) Aşağıdaki `ONBOARDING_STEP_DEFS` dizisine, istenen sıraya bir kayıt ekle (`id`, `short`, `title`, `description`, `isDone`).
 *     `isDone` yalnız `OnboardingFacts` okur; yeni bir veri gerekiyorsa `facts.extra["<id>"]` anahtarını kullan.
 *  2) `src/lib/onboarding-state.ts` içindeki "EKSTRA OLGULAR" bölümüne o anahtarı dolduran sorguyu ekle (hata = false).
 *  3) Gövde: ya kayda `href` ver (sihirbaz "Aç" düğmesiyle o sayfaya götürür — kod gerekmez) ya da
 *     `src/app/app/baslangic/step-bodies.tsx` içindeki `STEP_BODIES` kaydına `<id>: Bileşen` ekle.
 *  Başka dosya değişmez: bilet kimliği (`OnboardingStepId`), atla çerezi, ilerleme halkası, komşu adımlar türetilir.
 */

import type { AppAction, AppModule } from "@/lib/permissions";

/** Adımı yapabilmek için gereken yetki (modül + eylem; `EffectivePermissions` ile denetlenir). */
export type Permission = { module: AppModule; action: AppAction };

/** Sihirbazın adım kararlarını besleyen gerçek veri özeti (sunucu `onboarding-state.ts` doldurur). */
export type OnboardingFacts = {
  /** Ofisin ili/ilçesi ve açık adresi girildi mi (profil tamamlama `konum` maddeleri). */
  officeLocationDone: boolean;
  /** Kullanıcının kendi unvanı + en az bir uzmanlık ya da bölge kaydı var mı. */
  youDone: boolean;
  /** Ofisteki toplam kullanıcı (profil) sayısı. */
  members: number;
  /** İlan havuzu ofiste açık mı (tenants.listing_pool_enabled). */
  poolEnabled: boolean;
  /** Ofisteki gerçek (örnek olmayan) danışman uzmanlık + bölge kayıt sayısı; havuz ancak buna göre atama yapabilir. */
  poolAdvisorRecords: number;
  /** Yayın tarihi dolu, örnek olmayan portföy sayısı. */
  publishedProperties: number;
  /** Aktif mesajlaşma entegrasyonu (netgsm/whatsapp) sayısı. */
  activeIntegrations: number;
  /** Abonelik deneme dışında (ödeme yapılmış/aktif) mi. */
  planPaid: boolean;
  /** Başka modüllerin eklediği adımların olguları (anahtar = adım kimliği). */
  extra: Readonly<Record<string, boolean>>;
};

export type OnboardingStepDef = {
  id: string;
  /** Adımın kısa adı (ilerleme şeridi etiketi). */
  short: string;
  title: string;
  /** Tek cümlelik açıklama. */
  description: string;
  /** Gerçek veriden tamamlanma. */
  isDone: (facts: OnboardingFacts) => boolean;
  /**
   * Özel gövdesi yoksa sihirbazın "Aç" düğmesiyle götüreceği sayfa. Gövde bileşeni varsa (step-bodies.tsx)
   * gövde öncelikli; `href` yedek bağlantı olarak da durur.
   */
  href?: string;
  /**
   * Adımı yapabilmek için gereken yetki. Yoksa adım kişiseldir (herkes yapabilir). Ana ekran Başlangıç kartı, adım listesini ve
   * yüzdeyi yalnız kullanıcının yapabildiği adımlardan hesaplar (`scopeOnboardingToPermissions`); danışmana
   * "Ofis bilgilerin" ya da "Giderler ve kasa" gösterilmez.
   */
  requires?: Permission;
  /**
   * İsteğe bağlı adım: listede ayrı grupta durur, ilerleme yüzdesine, adım sayacına ve "kurulum tamam" kararına KATILMAZ
   * (ör. paket seçimi online ödeme kapalıyken tamamlanamaz; kurulum yine de bitebilmeli).
   */
  optional?: boolean;
};

const SETTINGS_EDIT: Permission = { module: "settings", action: "edit" };

/** Mülk Yönetimi (rentals) modülü sorusu; sihirbaz adımı ve Modüller ekranı aynı metni kullanır. */
export const PROPERTY_MANAGEMENT_QUESTION = "Kiracı ve mülk sahibi adına kira/aidat takibi yapıyor musunuz?";

export const ONBOARDING_STEP_DEFS = [
  {
    id: "office",
    requires: SETTINGS_EDIT,
    short: "Ofis",
    title: "Ofis bilgilerin",
    description: "Ofis adı, şehir ve ilçe, adres; logo isteğe bağlı. Sözleşme, portal ve vitrinde görünür.",
    isDone: (f) => f.officeLocationDone,
  },
  {
    id: "yetki-belgesi",
    requires: SETTINGS_EDIT,
    short: "Yetki belgesi",
    title: "Yetki belgesi no",
    description: "Malikler e-Devlet'te (EİDS) ofisine bu numarayla ilan yetkisi verir; numara ilan ve vitrinde de görünür.",
    isDone: (f) => f.extra["yetki-belgesi"] === true,
  },
  {
    id: "you",
    short: "Sen",
    title: "Sen ve uzmanlığın",
    description: "Unvanın, uzmanlık alanların ve çalıştığın bölgeler; ilanlar ve talepler sana buna göre eşleşir.",
    isDone: (f) => f.youDone,
  },
  {
    id: "team",
    requires: { module: "team", action: "create" },
    short: "Ekip",
    title: "Ekibini davet et",
    description: "Danışmanlarını e-posta ya da telefonla davet et; görev ve müşteri paylaşımı başlasın.",
    isDone: (f) => f.members > 1,
  },
  {
    id: "pool",
    requires: SETTINGS_EDIT,
    short: "Havuz",
    title: "İlan havuzu ve atama",
    description: "Havuz açıkken gelen ilanlar uzmanlığa göre danışmanlara önerilir ve atanır.",
    isDone: (f) => f.poolEnabled && f.poolAdvisorRecords > 0,
  },
  {
    id: "portals",
    requires: SETTINGS_EDIT,
    short: "Portallar",
    title: "Vitrin ve portallar",
    description: "Hangi portallarda ilan verdiğini işaretle; ilanların vitrininde ve portallarda yayınlansın, talepler sana düşsün.",
    // EP1: portal üyelikleri beyan edildiyse tamam. Beyan yoksa (mevcut ofis) adım yeniden açılır ve öneriler onaya gelir;
    // üyelik tablosu henüz yoksa (olgu yok) eski kural geçerli.
    isDone: (f) =>
      f.extra["portal-uyelik"] === true || (f.extra["portal-uyelik"] === undefined && (f.publishedProperties > 0 || f.activeIntegrations > 0)),
  },
  {
    id: "eids-eposta",
    requires: SETTINGS_EDIT,
    short: "Bakanlık e-postaları",
    title: "Bakanlık e-postalarını EmlakSoft'a ilet (isteğe bağlı)",
    optional: true,
    description: "Malik yetki verince ya da iptal edince gelen EİDS e-postası EmlakSoft'a iletilsin; portföy eşleşsin, görev açılsın.",
    // İlk e-posta (ya da Gmail onay kodu) alma adresine ulaşınca tamamlanır (EP3 eids_inbound_addresses.last_received_at).
    isDone: (f) => f.extra["eids-eposta"] === true,
  },
  {
    id: "giderler-kasa",
    requires: { module: "expenses", action: "edit" },
    short: "Giderler",
    title: "Giderler ve kasa",
    description: "Kira, muhasebe, portal üyeliği gibi aylık ödemelerini ve ofis kasanı bir kez tanımla; her ay kendiliğinden işlensin.",
    isDone: (f) => f.extra["giderler-kasa"] === true,
    href: "/app/giderler?sekme=duzenli",
  },
  {
    id: "mulk-yonetimi",
    requires: SETTINGS_EDIT,
    short: "Mülk yönetimi",
    title: "Mülk yönetimi (isteğe bağlı)",
    optional: true,
    description: PROPERTY_MANAGEMENT_QUESTION,
    // Cevap (Evet/Hayır) ofisin rentals modül satırı olarak saklanır; cevap gelene kadar mevcut davranış (modül açık) sürer.
    isDone: (f) => f.extra["mulk-yonetimi"] === true,
  },
  {
    id: "plan",
    requires: { module: "billing", action: "edit" },
    short: "Paket",
    title: "Paketini seç (isteğe bağlı)",
    optional: true,
    description: "Deneme süresince her şey açık; paketi şimdi seçebilir ya da denemeye devam edebilirsin.",
    isDone: (f) => f.planPaid,
  },
] as const satisfies readonly OnboardingStepDef[];

export type OnboardingStepId = (typeof ONBOARDING_STEP_DEFS)[number]["id"];

/** Sihirbazın son (özet) adımı; ilerlemeye sayılmaz. */
export const FINISH_STEP = "bitis" as const;
export type WizardStepKey = OnboardingStepId | typeof FINISH_STEP;

export const ONBOARDING_STEP_IDS: readonly OnboardingStepId[] = ONBOARDING_STEP_DEFS.map((d) => d.id);

export function isOnboardingStepId(v: unknown): v is OnboardingStepId {
  return typeof v === "string" && (ONBOARDING_STEP_IDS as readonly string[]).includes(v);
}

export function isWizardStepKey(v: unknown): v is WizardStepKey {
  return v === FINISH_STEP || isOnboardingStepId(v);
}

export function getOnboardingStepDef(id: string): OnboardingStepDef | null {
  return (ONBOARDING_STEP_DEFS as readonly OnboardingStepDef[]).find((d) => d.id === id) ?? null;
}

