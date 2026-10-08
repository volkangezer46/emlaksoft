/**
 * Ofis kurulum sihirbazı — saf mantık. Salt sayımlardan adım listesi ve ilerleme
 * yüzdesi üretir; veritabanı/IO yok (sayfa sayıları toplar, burası yorumlar).
 *
 * Tek kaynak: hem /app/baslangic sihirbazı hem ana ekrandaki kurulum şeridi bu modülü
 * kullanır. "Tamamlandı" bilgisi gerçek veriden çıkar (müşteri sayısı > 0 vb.); yeni şema
 * yoktur. Yalnız "sonra yaparım" tercihi kullanıcı çerezinde tutulur (bkz. setup-skip.ts).
 */

export type OnboardingCounts = {
  /** Ofis profili tamam mı? TEK kaynak: `profile-completion` (ekip daveti ayrı "Ekip" adımıdır; bkz. `isOfficeProfileDone`). */
  officeProfileDone: boolean;
  /** Örnek (is_sample) olmayan müşteri sayısı. */
  customers: number;
  /** Örnek olmayan portföy sayısı. */
  properties: number;
  /** Ofisteki toplam kullanıcı (profil) sayısı. */
  members: number;
  /** Aktif mesajlaşma entegrasyonu (netgsm/whatsapp) sayısı. */
  activeIntegrations: number;
  /** Ofise özel (tenant_id dolu) tanım sayısı: kayıp nedeni, kaynak vb. */
  customDefinitions: number;
  /** Yayın tarihi (published_at) dolu, örnek olmayan portföy sayısı. */
  publishedProperties: number;
  /** Örnek (is_sample) olmayan müşteri talebi sayısı. */
  demands: number;
  /** Örnek olmayan randevu sayısı. */
  appointments: number;
};

export type OnboardingStepId = "office" | "team" | "data" | "property" | "demand" | "appointment" | "defs" | "portals";

/** Sihirbazın son (özet) adımı; ilerlemeye sayılmaz. */
export const FINISH_STEP = "bitis" as const;
export type WizardStepKey = OnboardingStepId | typeof FINISH_STEP;

export type OnboardingStep = {
  id: OnboardingStepId;
  title: string;
  description: string;
  /** Adımın kısa adı (ilerleme çubuğu etiketi). */
  short: string;
  done: boolean;
};

export type OnboardingState = {
  steps: OnboardingStep[];
  doneCount: number;
  total: number;
  percent: number;
  /** Atlanmamış ilk tamamlanmamış adım; hepsi bittiyse/atlandıysa null. */
  nextId: OnboardingStepId | null;
  /** Tüm adımlar ya tamamlandı ya "sonra yaparım" denildi. */
  settled: boolean;
  complete: boolean;
};

export const ONBOARDING_STEP_IDS: readonly OnboardingStepId[] = ["office", "team", "data", "property", "demand", "appointment", "defs", "portals"];

export function isOnboardingStepId(v: unknown): v is OnboardingStepId {
  return typeof v === "string" && (ONBOARDING_STEP_IDS as readonly string[]).includes(v);
}

export function isWizardStepKey(v: unknown): v is WizardStepKey {
  return v === FINISH_STEP || isOnboardingStepId(v);
}

export function buildOnboarding(
  counts: OnboardingCounts,
  skipped: readonly OnboardingStepId[] = [],
): OnboardingState {
  const steps: OnboardingStep[] = [
    {
      id: "office",
      short: "Ofis",
      title: "Ofis bilgileriniz",
      description: "Konum, iletişim, vergi ve marka bilgileri sözleşme, portal ve vitrinde görünür.",
      done: counts.officeProfileDone,
    },
    {
      id: "team",
      short: "Ekip",
      title: "Ekibinizi davet edin",
      description: "Danışmanlarınızı ekleyin; görev ve müşteri paylaşımı başlasın.",
      done: counts.members > 1,
    },
    {
      id: "data",
      short: "Veriler",
      title: "Verilerinizi getirin",
      description: "Mevcut müşteri listenizi içe aktarın ya da ilk müşterinizi ekleyin.",
      done: counts.customers > 0,
    },
    {
      id: "property",
      short: "Portföy",
      title: "İlk portföyünüzü girin",
      description: "Portföy eklenince eşleştirme ve vitrin çalışmaya başlar.",
      done: counts.properties > 0,
    },
    {
      id: "demand",
      short: "Talep",
      title: "İlk talebi kaydedin",
      description: "Müşterinin aradığı evi (bütçe, bölge, oda) girin; uygun portföyler kendiliğinden eşleşir.",
      done: counts.demands > 0,
    },
    {
      id: "appointment",
      short: "Randevu",
      title: "İlk randevuyu planlayın",
      description: "Yer gösterme veya görüşmeyi takvime yazın; bugünkü randevular ana ekranda görünür.",
      done: counts.appointments > 0,
    },
    {
      id: "defs",
      short: "Tanımlar",
      title: "Tanımlarınızı gözden geçirin",
      description: "Kayıp nedenleri, aşama adları ve komisyon oranı ofisinizin diline uysun.",
      done: counts.customDefinitions > 0,
    },
    {
      id: "portals",
      short: "Vitrin",
      title: "Vitrin ve portallar",
      description: "İlanlarınız vitrininizde ve portallarda yayınlansın, talepler size düşsün.",
      done: counts.publishedProperties > 0 || counts.activeIntegrations > 0,
    },
  ];

  const total = steps.length;
  const doneCount = steps.filter((s) => s.done).length;
  const next = steps.find((s) => !s.done && !skipped.includes(s.id)) ?? null;
  return {
    steps,
    doneCount,
    total,
    percent: Math.round((doneCount / total) * 100),
    nextId: next?.id ?? null,
    settled: next === null,
    complete: doneCount === total,
  };
}

/** Sihirbazda gösterilecek adım: geçerli istek yoksa sıradaki; hepsi bitmişse özet. */
export function resolveWizardStep(requested: string | undefined, state: OnboardingState): WizardStepKey {
  if (isWizardStepKey(requested)) return requested;
  return state.nextId ?? FINISH_STEP;
}

/** Geri/ileri komşuları (özet adımı dahil). */
export function wizardNeighbors(current: WizardStepKey): { prev: WizardStepKey | null; next: WizardStepKey | null } {
  const order: WizardStepKey[] = [...ONBOARDING_STEP_IDS, FINISH_STEP];
  const i = order.indexOf(current);
  return { prev: i > 0 ? order[i - 1] : null, next: i >= 0 && i < order.length - 1 ? order[i + 1] : null };
}
