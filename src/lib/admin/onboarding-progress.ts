import type { SupabaseClient } from "@supabase/supabase-js";
import { buildOnboarding, type OnboardingFacts, type OnboardingState } from "@/lib/onboarding-checklist";
import { resolveChecklistDefs, type OnboardingContent } from "@/lib/onboarding-content";
import { loadOnboardingContent } from "@/lib/onboarding-content-read";
import { computeProfileCompletion, isOfficeLocationDone } from "@/lib/profile-completion";
import { createAdminClient } from "@/lib/supabase/admin";

/**
 * OFİS BAZINDA KURULUM İLERLEMESİ (SN5) — admin toplu listesi (Ofisler > Kurulum), Ofis 360 (Kullanım sekmesi) ve sağlık
 * skoru (AD5) girdisi. Olgular tek RPC turunda gelir (`platform_tenant_onboarding_facts`, service_role); "tamamlandı"
 * kuralları ofisin kendi sihirbazıyla AYNI kod (`onboarding-steps.ts` isDone + adminden düzenlenen sıra/açık-kapalı).
 *
 * Ofis düzeyi farkları (bilerek): kişisel "Sen ve uzmanlığın" adımı ofis sahiplerinden birinin unvan + uzmanlık/bölge kaydıyla
 * sayılır; portal üyeliği yalnız sahip beyanıyla; adım rol hedefi uygulanmaz (ofisin tamamı), paket hedefi ofisin paketiyle.
 * "Sonra yaparım" tercihi kullanıcı çerezindedir, burada görünmez: takılan adım = sıradaki tamamlanmamış adım.
 * RPC yoksa (migration bekliyor) `ready: false` döner; sahte ilerleme gösterilmez.
 */

export type OnboardingFactsRow = {
  tenant_id: string;
  tenant_name: string;
  status: string;
  plan: string | null;
  created_at: string;
  province_id: string | null;
  district_id: string | null;
  address_line: string | null;
  license_no: string | null;
  owner_you_done: boolean;
  members: number;
  pool_enabled: boolean;
  pool_advisor_records: number;
  published_properties: number;
  active_integrations: number;
  sub_status: string | null;
  office_finance: number;
  office_recurring: number;
  rentals_answered: boolean;
  portal_declared: number;
  eids_received: boolean;
};

export type OfficeProgressStep = { id: string; short: string; title: string; done: boolean };

export type OfficeProgress = {
  tenantId: string;
  name: string;
  status: string;
  plan: string | null;
  createdAt: string;
  doneCount: number;
  total: number;
  percent: number;
  /** Takılan adım: sıradaki tamamlanmamış adım (hepsi tamamsa null). */
  stuckId: string | null;
  stuckLabel: string | null;
  steps: OfficeProgressStep[];
};

const n = (v: unknown) => (Number.isFinite(Number(v)) ? Number(v) : 0);

/** RPC satırı → sihirbazın olgu özeti (SAF). */
export function officeOnboardingFacts(r: OnboardingFactsRow): OnboardingFacts {
  const completion = computeProfileCompletion({
    provinceId: r.province_id,
    districtId: r.district_id,
    addressLine: r.address_line,
    phone: null,
    licenseNo: r.license_no,
    taxNumber: null,
    logoUrl: null,
    brandColor: null,
    extAvailable: false,
    officeType: null,
    focusSegments: null,
    workDistrictIds: null,
    memberCount: Math.max(1, n(r.members)),
  });
  return {
    officeLocationDone: isOfficeLocationDone(completion),
    youDone: r.owner_you_done === true,
    members: n(r.members),
    poolEnabled: r.pool_enabled === true,
    poolAdvisorRecords: n(r.pool_advisor_records),
    publishedProperties: n(r.published_properties),
    activeIntegrations: n(r.active_integrations),
    planPaid: r.sub_status === "active",
    extra: {
      "yetki-belgesi": Boolean(r.license_no?.trim()),
      "giderler-kasa": n(r.office_finance) > 0 || n(r.office_recurring) > 0,
      "mulk-yonetimi": r.rentals_answered === true,
      "portal-uyelik": n(r.portal_declared) > 0,
      "eids-eposta": r.eids_received === true,
    },
  };
}

/** Tek ofisin ilerlemesi (SAF): adminden düzenlenen adım listesi ofisin paketiyle süzülür. */
export function buildOfficeProgress(r: OnboardingFactsRow, content: OnboardingContent): OfficeProgress {
  const defs = resolveChecklistDefs(content, { plan: r.plan ?? null });
  const state: OnboardingState = buildOnboarding(officeOnboardingFacts(r), [], defs);
  const stuck = state.steps.find((s) => !s.done) ?? null;
  return {
    tenantId: r.tenant_id,
    name: r.tenant_name,
    status: r.status,
    plan: r.plan,
    createdAt: r.created_at,
    doneCount: state.doneCount,
    total: state.total,
    percent: state.percent,
    stuckId: stuck?.id ?? null,
    stuckLabel: stuck?.short ?? null,
    steps: state.steps.map((s) => ({ id: s.id, short: s.short, title: s.title, done: s.done })),
  };
}

/** Takılan adım süzgeci (URL `adim=`): `tamam` = tümü bitmiş, adım kimliği = o adımda takılan. Bilinmeyen değer = süzgeç yok. */
export const PROGRESS_DONE_FILTER = "tamam";

export function filterProgress(rows: readonly OfficeProgress[], adim: string | null | undefined): OfficeProgress[] {
  if (!adim) return [...rows];
  if (adim === PROGRESS_DONE_FILTER) return rows.filter((r) => r.stuckId === null);
  return rows.filter((r) => r.stuckId === adim);
}

/** Adım başına takılan ofis sayısı (süzgeç çipleri; sırası adım sırası) + tamamlayan sayısı. */
export function stuckSummary(rows: readonly OfficeProgress[]): { steps: { id: string; label: string; count: number }[]; done: number } {
  const order = new Map<string, { id: string; label: string; count: number }>();
  for (const r of rows) for (const s of r.steps) if (!order.has(s.id)) order.set(s.id, { id: s.id, label: s.short, count: 0 });
  let done = 0;
  for (const r of rows) {
    if (r.stuckId === null) done += 1;
    else {
      const e = order.get(r.stuckId);
      if (e) e.count += 1;
    }
  }
  return { steps: [...order.values()].filter((s) => s.count > 0), done };
}

export function isOnboardingFactsMissing(err: { code?: string; message?: string } | null | undefined): boolean {
  if (!err) return false;
  return err.code === "PGRST202" || err.code === "42883" || /platform_tenant_onboarding_facts/.test(err.message ?? "");
}

/**
 * Platform personeli ekranlarının okuyucusu (Ofisler > Kurulum, Ofis 360): olgular + adminden düzenlenen içerik → ilerleme.
 * KAPI ÇAĞIRANDA: `requirePlatformModule("tenants")`. Ofislerin müşteri verisi okunmaz; yalnız kurulum olguları (sayı/bayrak).
 */
export async function loadOfficeProgress(tenantId?: string): Promise<{ ready: boolean; rows: OfficeProgress[]; error: string | null }> {
  const admin = createAdminClient();
  const [{ data, error }, content] = await Promise.all([
    admin.rpc("platform_tenant_onboarding_facts", { p_tenant_id: tenantId ?? null }),
    loadOnboardingContent(),
  ]);
  if (error) return { ready: !isOnboardingFactsMissing(error), rows: [], error: isOnboardingFactsMissing(error) ? null : error.message };
  return { ready: true, rows: ((data ?? []) as OnboardingFactsRow[]).map((r) => buildOfficeProgress(r, content)), error: null };
}

/** RPC okuması (çağıranın service_role istemcisiyle; kapı çağıranda). `tenantId` verilirse yalnız o ofis. */
export async function loadOnboardingFactsRows(
  admin: SupabaseClient,
  tenantId?: string,
): Promise<{ ready: boolean; rows: OnboardingFactsRow[]; error: string | null }> {
  const { data, error } = await admin.rpc("platform_tenant_onboarding_facts", { p_tenant_id: tenantId ?? null });
  if (error) return { ready: !isOnboardingFactsMissing(error), rows: [], error: isOnboardingFactsMissing(error) ? null : error.message };
  return { ready: true, rows: (data ?? []) as OnboardingFactsRow[], error: null };
}
