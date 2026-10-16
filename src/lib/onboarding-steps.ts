import { financePath } from "@/lib/finance/routes";
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
  /**
   * Bu yetkiye SAHİP kullanıcı için adım isteğe bağlıdır; sahip olmayan için zorunlu kalır. Ör. "Siz ve uzmanlığınız":
   * danışmanın tek kurulum adımıdır, ofisi yöneten (ayar düzenleyen) için 4 adımlık akışın dışında isteğe bağlı ayardır.
   * Yetki bağlamı olmayan (ofis düzeyi) hesaplarda isteğe bağlı sayılır.
   */
  optionalFor?: Permission;
};

const SETTINGS_EDIT: Permission = { module: "settings", action: "edit" };

/** Mülk Yönetimi (rentals) modülü sorusu; sihirbaz adımı ve Modüller ekranı aynı metni kullanır. */
export const PROPERTY_MANAGEMENT_QUESTION = "Kiracı ve mülk sahibi adına kira/aidat takibi yapıyor musunuz?";

export const ONBOARDING_STEP_DEFS = [
  // ZORUNLU AKIŞ (ofis sahibi için 4 adım, sadeleştirme planı C27): Ofis · Ne iş yapıyorsunuz · Verileri taşı · Ekibi davet et.
  {
    id: "office",
    requires: SETTINGS_EDIT,
    short: "Ofis",
    title: "Ofisiniz",
    description: "Ofis adı, il, ilçe ve adres. Sözleşmede ve vitrinde görünür; logo isteğe bağlı.",
    isDone: (f) => f.officeLocationDone,
  },
  {
    id: "ofis-tipi",
    requires: SETTINGS_EDIT,
    short: "İş türü",
    title: "Ne iş yapıyorsunuz?",
    description: "Ofisinize uyan hazır düzeni seçin; kullanmadığınız bölümler menüden kalkar, istediğiniz an geri açarsınız.",
    // Hazır düzen kaydedilirken kira takibi sorusu da cevaplanır (rentals modül satırı): cevap varsa adım tamamdır.
    isDone: (f) => f.extra["ofis-tipi"] === true,
  },
  {
    id: "veri",
    requires: SETTINGS_EDIT,
    short: "Veriler",
    title: "Verilerinizi taşıyın",
    description: "Excel ya da telefon rehberinizdeki müşteri ve portföy listelerini birkaç dakikada içeri alın.",
    isDone: (f) => f.extra["veri"] === true,
  },
  {
    id: "team",
    requires: { module: "team", action: "create" },
    short: "Ekip",
    title: "Ekibinizi davet edin",
    description: "Danışmanlarınızı e-posta ya da telefonla davet edin; müşteri ve görev paylaşımı başlasın.",
    isDone: (f) => f.members > 1,
  },
  // KİŞİSEL ADIM: danışmanın tek kurulum adımı; ofisi yöneten (settings:edit) için isteğe bağlıdır (`optionalFor`).
  {
    id: "you",
    short: "Siz",
    title: "Siz ve uzmanlığınız",
    description: "Unvanınız, uzmanlık alanlarınız ve çalıştığınız bölgeler; portföy ve talepler size buna göre eşleşir.",
    isDone: (f) => f.youDone,
    optionalFor: SETTINGS_EDIT,
  },
  // İSTEĞE BAĞLI AYARLAR: sayaca katılmaz, kurulum özetinde "İsteğe bağlı ayarlar" listesinde durur.
  {
    id: "yetki-belgesi",
    requires: SETTINGS_EDIT,
    short: "Yetki belgesi",
    title: "Yetki belgesi numarası",
    optional: true,
    description: "Mal sahipleri e-Devlet'te ofisinize bu numarayla ilan yetkisi verir; numara ilanda ve vitrinde de görünür.",
    isDone: (f) => f.extra["yetki-belgesi"] === true,
  },
  {
    id: "pool",
    requires: SETTINGS_EDIT,
    short: "Portföy dağıtımı",
    title: "Portföy dağıtımı",
    optional: true,
    description: "Açıkken gelen portföyler uzmanlığa göre danışmanlara önerilir ve atanır.",
    isDone: (f) => f.poolEnabled && f.poolAdvisorRecords > 0,
  },
  {
    id: "portals",
    requires: SETTINGS_EDIT,
    short: "İlan siteleri",
    title: "Vitrin ve ilan siteleri",
    optional: true,
    description: "Hangi ilan sitelerinde ilan verdiğinizi işaretleyin; ilanlarınız vitrinde görünsün, gelen talepler size düşsün.",
    // EP1: portal üyelikleri beyan edildiyse tamam. Beyan yoksa (mevcut ofis) adım yeniden açılır ve öneriler onaya gelir;
    // üyelik tablosu henüz yoksa (olgu yok) eski kural geçerli.
    isDone: (f) =>
      f.extra["portal-uyelik"] === true || (f.extra["portal-uyelik"] === undefined && (f.publishedProperties > 0 || f.activeIntegrations > 0)),
  },
  {
    id: "giderler-kasa",
    requires: { module: "expenses", action: "edit" },
    short: "Giderler",
    title: "Giderler ve kasa",
    optional: true,
    description: "Kira, muhasebe, ilan sitesi üyeliği gibi aylık ödemelerinizi ve ofis kasanızı bir kez tanımlayın; her ay kendiliğinden işlensin.",
    isDone: (f) => f.extra["giderler-kasa"] === true,
    href: financePath("tekrarlayan"),
  },
  {
    id: "eids-eposta",
    requires: SETTINGS_EDIT,
    short: "Bakanlık e-postaları",
    title: "Bakanlık e-postalarını EmlakSoft'a iletin",
    optional: true,
    description: "Mal sahibi yetki verince ya da iptal edince gelen Bakanlık e-postası EmlakSoft'a iletilsin; portföy eşleşsin, görev açılsın.",
    // İlk e-posta (ya da Gmail onay kodu) alma adresine ulaşınca tamamlanır (EP3 eids_inbound_addresses.last_received_at).
    isDone: (f) => f.extra["eids-eposta"] === true,
  },
  {
    id: "plan",
    requires: { module: "billing", action: "edit" },
    short: "Paket",
    title: "Paketinizi seçin",
    optional: true,
    description: "Deneme süresince her şey açık; paketi şimdi seçebilir ya da denemeye devam edebilirsiniz.",
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

