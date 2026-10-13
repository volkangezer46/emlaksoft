/**
 * Ofis kurulum sihirbazı — saf mantık. Gerçek veri özetinden (`OnboardingFacts`) adım listesi ve ilerleme
 * yüzdesi üretir; veritabanı/IO yok (`onboarding-state.ts` verileri toplar, burası yorumlar).
 *
 * Adım listesinin TEK kaynağı `onboarding-steps.ts` kaydıdır. "Tamamlandı" bilgisi gerçek veriden çıkar; yalnız
 * "sonra yaparım" tercihi kullanıcı çerezinde tutulur (bkz. setup-skip.ts).
 *
 * "İlk işler" (veri getir, ilk portföy, talep, randevu, tanımlar) sihirbaz adımı DEĞİLDİR: ana ekrandaki Başlangıç
 * kartında kontrol listesi olarak durur (`buildFirstTasks`).
 */
import {
  FINISH_STEP,
  ONBOARDING_STEP_DEFS,
  ONBOARDING_STEP_IDS,
  isOnboardingStepId,
  isWizardStepKey,
  type OnboardingFacts,
  type OnboardingStepId,
  type Permission,
  type WizardStepKey,
} from "@/lib/onboarding-steps";
import type { EffectivePermissions } from "@/lib/permissions-effective";

export { FINISH_STEP, ONBOARDING_STEP_IDS, isOnboardingStepId, isWizardStepKey };
export type { OnboardingFacts, OnboardingStepId, WizardStepKey };

export type OnboardingStep = {
  id: OnboardingStepId;
  title: string;
  description: string;
  /** Adımın kısa adı (ilerleme çubuğu etiketi). */
  short: string;
  /** Özel gövdesi olmayan adımın götürdüğü sayfa. */
  href?: string;
  /** Adımı yapabilmek için gereken yetki; yoksa kişisel adım (bkz. `OnboardingStepDef.requires`). */
  requires?: Permission;
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

export function buildOnboarding(facts: OnboardingFacts, skipped: readonly OnboardingStepId[] = []): OnboardingState {
  const steps: OnboardingStep[] = ONBOARDING_STEP_DEFS.map((d) => ({
    id: d.id,
    short: d.short,
    title: d.title,
    description: d.description,
    ...("href" in d && typeof d.href === "string" ? { href: d.href } : {}),
    ...("requires" in d && d.requires ? { requires: d.requires } : {}),
    done: d.isDone(facts),
  }));
  return summarize(steps, skipped);
}

function summarize(steps: OnboardingStep[], skipped: readonly OnboardingStepId[]): OnboardingState {
  const total = steps.length;
  const doneCount = steps.filter((s) => s.done).length;
  const next = steps.find((s) => !s.done && !skipped.includes(s.id)) ?? null;
  return {
    steps,
    doneCount,
    total,
    percent: total === 0 ? 100 : Math.round((doneCount / total) * 100),
    nextId: next?.id ?? null,
    settled: next === null,
    complete: doneCount === total,
  };
}

function permitted(perms: EffectivePermissions, req: Permission | undefined): boolean {
  return !req || (perms[req.module] ?? []).includes(req.action);
}

/**
 * Ana ekran Başlangıç kartı için durumu kullanıcının YAPABİLDİĞİ adımlara daraltır: yetkisi olmayan adım (ofis bilgileri,
 * giderler, havuz, paket…) listeden çıkar, yüzde/sıradaki/`settled` yalnız kalanlardan hesaplanır. Danışmanda yalnız
 * kişisel adımlar ("Sen ve uzmanlığın") kalır; hepsi tamamsa `settled` olur ve kart gizlenir.
 */
export function scopeOnboardingToPermissions(
  state: OnboardingState,
  perms: EffectivePermissions,
  skipped: readonly OnboardingStepId[] = [],
): OnboardingState {
  return summarize(
    state.steps.filter((s) => permitted(perms, s.requires)),
    skipped,
  );
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

/* ------------------------------- İlk işler ------------------------------- */

export type FirstTaskCounts = {
  /** Örnek (is_sample) olmayan müşteri sayısı. */
  customers: number;
  /** Örnek olmayan portföy sayısı. */
  properties: number;
  /** Örnek olmayan müşteri talebi sayısı. */
  demands: number;
  /** Örnek olmayan randevu sayısı. */
  appointments: number;
  /** Ofise özel (tenant_id dolu) tanım sayısı: kayıp nedeni, kaynak vb. */
  customDefinitions: number;
};

export type FirstTask = {
  id: "data" | "property" | "demand" | "appointment" | "defs";
  title: string;
  description: string;
  href: string;
  done: boolean;
  /** Görevi yapabilmek için gereken yetki (bkz. `visibleFirstTasks`). */
  requires?: Permission;
};

/** Ana ekrandaki Başlangıç kartının "ilk işler" kontrol listesi (sihirbaz adımı değil). */
export function buildFirstTasks(c: FirstTaskCounts): FirstTask[] {
  return [
    { id: "data", title: "Verilerini getir", description: "Müşteri listeni içe aktar ya da ilk müşterini ekle.", href: "/app/ice-aktarma", done: c.customers > 0 },
    { id: "property", title: "İlk portföyünü gir", description: "Başlık, fiyat ve konum yeterli.", href: "/app/portfoyler/yeni", done: c.properties > 0 },
    { id: "demand", title: "İlk talebi kaydet", description: "Bütçe ve bölgeyi gir; uygun portföyler eşleşir.", href: "/app/talepler/yeni", done: c.demands > 0 },
    { id: "appointment", title: "İlk randevuyu planla", description: "Yer gösterme ya da görüşmeyi takvime yaz.", href: "/app/randevular/yeni", done: c.appointments > 0 },
    { id: "defs", title: "Tanımlarını gözden geçir", description: "Kayıp nedenleri ve aşama adları ofisinin diline uysun.", href: "/app/ayarlar/tanimlar", done: c.customDefinitions > 0, requires: { module: "settings", action: "edit" } },
  ];
}

/** Kullanıcının yapabildiği ilk işler ("Tanımlarını gözden geçir" düzenleme yetkisi olmayana gösterilmez). */
export function visibleFirstTasks(tasks: readonly FirstTask[], perms: EffectivePermissions): FirstTask[] {
  return tasks.filter((t) => permitted(perms, t.requires));
}
