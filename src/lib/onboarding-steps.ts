/**
 * Kurulum sihirbazı ADIM KAYDI — sihirbazın adım listesinin TEK kaynağı (SAF; I/O yok).
 *
 * Kayıt dört soruluktur (ad, cep, e-posta, şifre); ofisin geri kalanı üye olduktan sonra `/app/baslangic` sihirbazında
 * tamamlanır. Her adım atlanabilir, ilerleme gerçek veriden hesaplanır (sahte ilerleme yok), "sonra yaparım" tercihi
 * kullanıcı çerezindedir (`setup-skip.ts`). Ana ekran Başlangıç kartı, Ayarlar dizini, Yardım ve sihirbaz AYNI listeyi okur.
 *
 * YENİ ADIM EKLEMEK (ör. "Giderler ve kasa"):
 *  1) Aşağıdaki `ONBOARDING_STEP_DEFS` dizisine, istenen sıraya bir kayıt ekle (`id`, `short`, `title`, `description`, `isDone`).
 *     `isDone` yalnız `OnboardingFacts` okur; yeni bir veri gerekiyorsa `facts.extra["<id>"]` anahtarını kullan.
 *  2) `src/lib/onboarding-state.ts` içindeki "EKSTRA OLGULAR" bölümüne o anahtarı dolduran sorguyu ekle (hata = false).
 *  3) Gövde: ya kayda `href` ver (sihirbaz "Aç" düğmesiyle o sayfaya götürür — kod gerekmez) ya da
 *     `src/app/app/baslangic/step-bodies.tsx` içindeki `STEP_BODIES` kaydına `<id>: Bileşen` ekle.
 *  Başka dosya değişmez: bilet kimliği (`OnboardingStepId`), atla çerezi, ilerleme halkası, komşu adımlar türetilir.
 */

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
};

export const ONBOARDING_STEP_DEFS = [
  {
    id: "office",
    short: "Ofis",
    title: "Ofis bilgilerin",
    description: "Ofis adı, şehir ve ilçe, adres; logo isteğe bağlı. Sözleşme, portal ve vitrinde görünür.",
    isDone: (f) => f.officeLocationDone,
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
    short: "Ekip",
    title: "Ekibini davet et",
    description: "Danışmanlarını e-posta ya da telefonla davet et; görev ve müşteri paylaşımı başlasın.",
    isDone: (f) => f.members > 1,
  },
  {
    id: "pool",
    short: "Havuz",
    title: "İlan havuzu ve atama",
    description: "Havuz açıkken gelen ilanlar uzmanlığa göre danışmanlara önerilir ve atanır.",
    isDone: (f) => f.poolEnabled,
  },
  {
    id: "portals",
    short: "Portallar",
    title: "Vitrin ve portallar",
    description: "İlanların vitrininde ve portallarda yayınlansın, talepler sana düşsün.",
    isDone: (f) => f.publishedProperties > 0 || f.activeIntegrations > 0,
  },
  {
    id: "plan",
    short: "Paket",
    title: "Paketini seç (isteğe bağlı)",
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

/** Eski bağlantılar: kaldırılan/birleşen adım kimlikleri yeni adıma eşlenir (kırık `?adim=` yok). */
const LEGACY_STEP_ALIASES: Record<string, WizardStepKey> = {
  data: FINISH_STEP,
  property: FINISH_STEP,
  demand: FINISH_STEP,
  appointment: FINISH_STEP,
  defs: FINISH_STEP,
  // profil-tamamla adımları
  konum: "office",
  iletisim: "office",
  fatura: "office",
  marka: "office",
  odak: "you",
  ekip: "team",
};

export function resolveLegacyStep(v: string | null | undefined): WizardStepKey | null {
  if (!v) return null;
  if (isWizardStepKey(v)) return v;
  return LEGACY_STEP_ALIASES[v] ?? null;
}
