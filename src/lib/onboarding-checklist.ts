/**
 * Ofis kurulum sihirbazı — saf mantık. Salt sayımlardan adım listesi ve ilerleme
 * yüzdesi üretir; veritabanı/IO yok (sayfa sayıları toplar, burası yorumlar).
 */

export type OnboardingCounts = {
  /** Telefon / şehir / ruhsat alanlarından dolu olanlar. */
  profileFilled: { phone: boolean; city: boolean; licenseNo: boolean };
  /** Örnek (is_sample) olmayan müşteri sayısı. */
  customers: number;
  /** Örnek olmayan portföy sayısı. */
  properties: number;
  /** Ofisteki toplam kullanıcı (profil) sayısı. */
  members: number;
  /** Aktif mesajlaşma entegrasyonu (netgsm/whatsapp) sayısı. */
  activeIntegrations: number;
};

export type OnboardingStepId = "profile" | "customer" | "property" | "team" | "channel";

export type OnboardingStep = {
  id: OnboardingStepId;
  title: string;
  description: string;
  href: string;
  cta: string;
  done: boolean;
};

export type OnboardingState = {
  steps: OnboardingStep[];
  doneCount: number;
  total: number;
  percent: number;
  /** Atlanmamış ilk tamamlanmamış adım; hepsi bittiyse null. */
  nextId: OnboardingStepId | null;
  complete: boolean;
};

export const PROFILE_MIN_FIELDS = 2;

export function isProfileComplete(p: OnboardingCounts["profileFilled"]): boolean {
  return [p.phone, p.city, p.licenseNo].filter(Boolean).length >= PROFILE_MIN_FIELDS;
}

export function buildOnboarding(
  counts: OnboardingCounts,
  skipped: readonly OnboardingStepId[] = [],
): OnboardingState {
  const steps: OnboardingStep[] = [
    {
      id: "profile",
      title: "Ofis profilini tamamlayın",
      description: "Telefon, şehir ve ruhsat bilgisi sözleşme, portal ve vitrinde görünür.",
      href: "/app/ayarlar",
      cta: "Ayarlara git",
      done: isProfileComplete(counts.profileFilled),
    },
    {
      id: "customer",
      title: "İlk müşterinizi ekleyin",
      description: "Müşteri kaydı talep, randevu ve anlaşmaların başlangıç noktasıdır.",
      href: "/app/musteriler",
      cta: "Müşteri ekle",
      done: counts.customers > 0,
    },
    {
      id: "property",
      title: "İlk portföyünüzü girin",
      description: "Portföy eklenince eşleştirme ve vitrin çalışmaya başlar.",
      href: "/app/portfoyler",
      cta: "Portföy ekle",
      done: counts.properties > 0,
    },
    {
      id: "team",
      title: "Ekibinizi davet edin",
      description: "Danışmanlarınızı ekleyin; görev ve müşteri paylaşımı başlasın.",
      href: "/app/ekip",
      cta: "Ekibi davet et",
      done: counts.members > 1,
    },
    {
      id: "channel",
      title: "WhatsApp veya SMS bağlayın",
      description: "Portal ve kampanya mesajları kendi hattınızdan gitsin.",
      href: "/app/ayarlar",
      cta: "Bağlantıyı kur",
      done: counts.activeIntegrations > 0,
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
    complete: doneCount === total,
  };
}
