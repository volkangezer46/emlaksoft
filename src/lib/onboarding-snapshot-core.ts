import type { SupabaseClient } from "@supabase/supabase-js";
import {
  buildFirstTasks,
  buildOnboarding,
  type FirstTask,
  type OnboardingFacts,
  type OnboardingState,
} from "@/lib/onboarding-checklist";
import type { parseSkipped } from "@/lib/setup-skip";
import type { ProfileSnapshot } from "@/lib/profile-completion-data";
import { isOfficeLocationDone } from "@/lib/profile-completion";
import { PORTAL_MEMBERSHIP_EDITOR_ROLES } from "@/lib/portals/membership";
import { resolveChecklistDefs, type OnboardingContent } from "@/lib/onboarding-content";
import { recordRpcOutcome, rpcKnownMissing } from "@/lib/supabase/rpc-probe";

/**
 * Kurulum durumu çekirdeği (KQ5): olguların okunması (tek RPC ya da eski ayrı sorgular) ile anlık görüntünün
 * kurulması ayrıdır. İki okuma yolu AYNI ham olgu nesnesini (`OnboardingRaw`) üretir; `composeOnboardingSnapshot`
 * tek yerden snapshot kurar. Birim testi iki yolun aynı veride eşit snapshot verdiğini doğrular.
 */

export type OnboardingSnapshot = {
  state: OnboardingState;
  /** "İlk işler" kontrol listesi (sihirbaz adımı değil; ana ekran Başlangıç kartında durur). */
  firstTasks: FirstTask[];
  skipped: ReturnType<typeof parseSkipped>;
  tenant: {
    name: string;
    slug: string | null;
    sample_seeded_at: string | null;
  } | null;
  /** Ofis profili (konum/adres maddeleri "Ofis" adımının tamamlanmasını belirler). */
  profile: ProfileSnapshot;
  counts: { customers: number; properties: number; sampleCustomers: number };
};

/**
 * Ham kurulum olguları. Yalnız `customers`, `properties`, `sampleCustomers` tam sayıdır (ekranda gösterilir);
 * diğer sayılar yalnız eşik (> 0, members > 1) için kullanılır ve RPC yolunda EXISTS / üst sınırlı sayımdır.
 */
export type OnboardingRaw = {
  tenant: { name: string; slug: string | null; sample_seeded_at: string | null; plan: string | null } | null;
  poolEnabled: boolean;
  customers: number;
  properties: number;
  sampleCustomers: number;
  members: number;
  customDefinitions: number;
  publishedProperties: number;
  demands: number;
  appointments: number;
  activeIntegrations: number;
  viewerTitle: string;
  viewerRole: string | null;
  /** Görüntüleyenin uzmanlık + bölge kaydı (yalnız > 0 önemli). */
  viewerExpertise: number;
  poolAdvisorRecords: number;
  planPaid: boolean;
  officeCash: boolean;
  rentalsAnswered: boolean;
  /** null = olgu okunamadı (eski kural uygulanır). */
  portalDeclared: boolean | null;
  eidsReceived: boolean;
};

export function composeOnboardingSnapshot(
  raw: OnboardingRaw,
  ctx: { profile: ProfileSnapshot; content: OnboardingContent; skipped: ReturnType<typeof parseSkipped> },
): OnboardingSnapshot {
  const { profile, content, skipped } = ctx;
  // EKSTRA OLGULAR: başka modüllerin sihirbaza eklediği adımlar (bkz. onboarding-steps.ts) olgularını burada doldurur.
  const extra: Record<string, boolean> = {
    "giderler-kasa": raw.officeCash,
    // "Ne iş yapıyorsunuz?": hazır düzen kaydı kira takibi sorusunu da cevaplar (rentals modül satırı).
    "ofis-tipi": raw.rentalsAnswered,
    // "Verilerinizi taşıyın": ofiste örnek olmayan en az bir müşteri ya da portföy var.
    veri: raw.customers > 0 || raw.properties > 0,
    "yetki-belgesi": Boolean(profile.facts.licenseNo?.trim()),
    "eids-eposta": raw.eidsReceived,
  };
  // Üyelik kartını yalnız owner/gm kaydedebilir: diğer roller (settings:edit olsa da) bu beyanı yapamaz, adım onlara açık kalmaz.
  if (raw.portalDeclared !== null) {
    extra["portal-uyelik"] = raw.portalDeclared || (raw.viewerRole !== null && !PORTAL_MEMBERSHIP_EDITOR_ROLES.has(raw.viewerRole));
  }
  const facts: OnboardingFacts = {
    officeLocationDone: isOfficeLocationDone(profile.completion),
    youDone: raw.viewerTitle.length > 0 && raw.viewerExpertise > 0,
    members: raw.members,
    poolEnabled: raw.poolEnabled,
    poolAdvisorRecords: raw.poolAdvisorRecords,
    publishedProperties: raw.publishedProperties,
    activeIntegrations: raw.activeIntegrations,
    planPaid: raw.planPaid,
    extra,
  };
  // Rol/paket hedefi: kullanıcının rolü ve ofisin paketi (bilinmiyorsa o hedef uygulanmaz).
  const defs = resolveChecklistDefs(content, { role: raw.viewerRole, plan: raw.tenant?.plan ?? null });
  const state = buildOnboarding(facts, skipped, defs);
  const firstTasks = buildFirstTasks({
    customers: raw.customers,
    properties: raw.properties,
    demands: raw.demands,
    appointments: raw.appointments,
    customDefinitions: raw.customDefinitions,
  });
  const tenant: OnboardingSnapshot["tenant"] = raw.tenant
    ? { name: raw.tenant.name, slug: raw.tenant.slug, sample_seeded_at: raw.tenant.sample_seeded_at }
    : null;
  return {
    state,
    firstTasks,
    skipped,
    tenant,
    profile,
    counts: { customers: raw.customers, properties: raw.properties, sampleCustomers: raw.sampleCustomers },
  };
}

/* -------------------------------------------------------------------------- */
/* Tek tur: onboarding_snapshot RPC'si (20261015021000)                        */
/* -------------------------------------------------------------------------- */

export const ONBOARDING_SNAPSHOT_RPC = "onboarding_snapshot";

const isObj = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);
const int = (v: unknown): number | null => {
  const n = typeof v === "number" ? v : typeof v === "string" && v.trim() !== "" ? Number(v) : Number.NaN;
  return Number.isFinite(n) && n >= 0 ? Math.trunc(n) : null;
};
const bool = (v: unknown): boolean | null => (typeof v === "boolean" ? v : null);
const strOrNull = (v: unknown): string | null => (typeof v === "string" ? v : null);

/** RPC jsonb çıktısı → ham olgular. Beklenmeyen biçimde null (çağıran eski yola düşer; sahte ilerleme yok). */
export function parseOnboardingRpc(data: unknown): OnboardingRaw | null {
  if (!isObj(data)) return null;
  const counts = {
    customers: int(data.customers),
    properties: int(data.properties),
    sampleCustomers: int(data.sample_customers),
    members: int(data.members),
  };
  if (Object.values(counts).some((v) => v === null)) return null;
  const flags = {
    customDefinitions: bool(data.custom_definitions),
    publishedProperties: bool(data.published_properties),
    demands: bool(data.demands),
    appointments: bool(data.appointments),
    activeIntegrations: bool(data.active_integrations),
    viewerExpertise: bool(data.viewer_expertise),
    poolAdvisorRecords: bool(data.pool_advisor_records),
    planPaid: bool(data.sub_active),
    officeCash: bool(data.office_cash),
    rentalsAnswered: bool(data.rentals_answered),
    portalDeclared: bool(data.portal_declared),
    eidsReceived: bool(data.eids_received),
  };
  if (Object.values(flags).some((v) => v === null)) return null;
  const f = flags as { [K in keyof typeof flags]: boolean };
  const tenantRaw = data.tenant;
  if (tenantRaw !== null && tenantRaw !== undefined && !isObj(tenantRaw)) return null;
  const tenant = isObj(tenantRaw)
    ? {
        name: String(tenantRaw.name ?? ""),
        slug: strOrNull(tenantRaw.slug),
        sample_seeded_at: strOrNull(tenantRaw.sample_seeded_at),
        plan: strOrNull(tenantRaw.plan),
      }
    : null;
  const viewer = isObj(data.viewer) ? data.viewer : null;
  return {
    tenant,
    poolEnabled: isObj(tenantRaw) && tenantRaw.listing_pool_enabled === true,
    customers: counts.customers!,
    properties: counts.properties!,
    sampleCustomers: counts.sampleCustomers!,
    members: counts.members!,
    customDefinitions: f.customDefinitions ? 1 : 0,
    publishedProperties: f.publishedProperties ? 1 : 0,
    demands: f.demands ? 1 : 0,
    appointments: f.appointments ? 1 : 0,
    activeIntegrations: f.activeIntegrations ? 1 : 0,
    viewerTitle: String(viewer?.title ?? "").trim(),
    viewerRole: strOrNull(viewer?.role) ?? null,
    viewerExpertise: f.viewerExpertise ? 1 : 0,
    poolAdvisorRecords: f.poolAdvisorRecords ? 1 : 0,
    planPaid: f.planPaid,
    officeCash: f.officeCash,
    rentalsAnswered: f.rentalsAnswered,
    portalDeclared: f.portalDeclared,
    eidsReceived: f.eidsReceived,
  };
}

type RpcClient = Pick<SupabaseClient, "rpc">;

/** Tek RPC turu. RPC yoksa (migration uygulanmadı) / hata / bozuk yanıt → null. */
export async function loadOnboardingRawRpc(supabase: RpcClient, tenantId: string): Promise<OnboardingRaw | null> {
  if (rpcKnownMissing(ONBOARDING_SNAPSHOT_RPC)) return null;
  try {
    const res = await supabase.rpc(ONBOARDING_SNAPSHOT_RPC, { p_tenant_id: tenantId });
    recordRpcOutcome(ONBOARDING_SNAPSHOT_RPC, res.error);
    if (res.error || res.data == null) return null;
    return parseOnboardingRpc(res.data);
  } catch {
    return null;
  }
}

/* -------------------------------------------------------------------------- */
/* Eski yol: ayrı sorgular (RPC yokken)                                        */
/* -------------------------------------------------------------------------- */

/**
 * RPC yokken (migration uygulanmadı) eski ayrı sayımlar. Çekirdek sorgulardan biri hata verirse null döner
 * (sahte ilerleme gösterilmez); isteğe bağlı olgu sorguları (uzmanlık, havuz, abonelik) hata verirse yalnız o olgu "yok" sayılır.
 */
export async function loadOnboardingRawLegacy(
  supabase: SupabaseClient,
  tenantId: string,
  userId: string | null,
): Promise<OnboardingRaw | null> {
  const [optional, ...results] = await Promise.all([
    Promise.all([
      userId ? supabase.from("profiles").select("title, role").eq("id", userId).maybeSingle() : Promise.resolve({ data: null, error: null }),
      userId
        ? supabase.from("advisor_specialties").select("id", { count: "exact", head: true }).eq("profile_id", userId)
        : Promise.resolve({ count: 0, error: null }),
      userId
        ? supabase.from("advisor_regions").select("id", { count: "exact", head: true }).eq("profile_id", userId)
        : Promise.resolve({ count: 0, error: null }),
      supabase.from("tenants").select("listing_pool_enabled").eq("id", tenantId).maybeSingle(),
      supabase.from("subscriptions").select("status").eq("tenant_id", tenantId).maybeSingle(),
      // Giderler ve kasa adımı (Finans Paket B): ofis hesabı ya da düzenli ödeme var mı (RLS: yetkisiz kullanıcıda 0).
      supabase.from("finance_accounts").select("id", { count: "exact", head: true }).eq("owner_scope", "office").is("archived_at", null),
      supabase.from("recurring_rules").select("id", { count: "exact", head: true }).eq("scope", "office"),
      // Havuz adımı: ofiste gerçek (örnek olmayan) danışman uzmanlık/bölge kaydı var mı (RLS kiracı sınırı).
      supabase.from("advisor_specialties").select("id", { count: "exact", head: true }).eq("is_sample", false),
      supabase.from("advisor_regions").select("id", { count: "exact", head: true }).eq("is_sample", false),
      // Mülk yönetimi sorusu: rentals modül satırı varsa cevaplanmıştır (RLS kiracı sınırı).
      supabase.from("tenant_modules").select("module_key", { count: "exact", head: true }).eq("tenant_id", tenantId).eq("module_key", "rentals"),
      // Portal üyelikleri (EP1): sahip/genel müdür kartı en az bir kez kaydetti mi ('unknown' satırı sayılmaz).
      supabase.from("tenant_portal_accounts").select("portal", { count: "exact", head: true }).eq("tenant_id", tenantId).eq("source", "owner_declared"),
      // Bakanlık (EİDS) e-postaları adımı: etkin alma adresine en az bir e-posta ulaştı mı.
      supabase
        .from("eids_inbound_addresses")
        .select("tenant_id", { count: "exact", head: true })
        .eq("tenant_id", tenantId)
        .is("revoked_at", null)
        .not("last_received_at", "is", null),
    ]),
    supabase.from("tenants").select("name, slug, sample_seeded_at, plan").eq("id", tenantId).maybeSingle(),
    supabase.from("customers").select("id", { count: "exact", head: true }).eq("is_sample", false),
    supabase.from("properties").select("id", { count: "exact", head: true }).eq("is_sample", false),
    supabase.from("profiles").select("id", { count: "exact", head: true }).eq("tenant_id", tenantId),
    supabase
      .from("tenant_integrations")
      .select("id", { count: "exact", head: true })
      .eq("is_active", true)
      .in("provider", ["netgsm", "whatsapp"]),
    supabase.from("definitions").select("id", { count: "exact", head: true }).eq("tenant_id", tenantId),
    supabase.from("properties").select("id", { count: "exact", head: true }).eq("is_sample", false).not("published_at", "is", null),
    supabase.from("customers").select("id", { count: "exact", head: true }).eq("is_sample", true),
    supabase.from("customer_demands").select("id", { count: "exact", head: true }).eq("is_sample", false),
    supabase.from("appointments").select("id", { count: "exact", head: true }).eq("is_sample", false),
  ]);
  if (results.some((r) => r.error)) return null;

  const tenantRow = results[0].data as { name: string; slug: string | null; sample_seeded_at: string | null; plan?: string | null } | null;
  const [titleRes, specRes, regionRes, poolRes, subRes, cashAccRes, ruleRes, poolSpecRes, poolRegionRes, rentalsModRes, portalAccRes, eidsMailRes] = optional;
  const viewer = titleRes.error ? null : (titleRes.data as { title?: string | null; role?: string | null } | null);
  const cnt = (r: { count?: number | null; error: unknown }) => (r.error ? 0 : (r.count ?? 0));
  return {
    tenant: tenantRow
      ? { name: tenantRow.name, slug: tenantRow.slug, sample_seeded_at: tenantRow.sample_seeded_at, plan: tenantRow.plan ?? null }
      : null,
    poolEnabled: poolRes.error ? false : (poolRes.data as { listing_pool_enabled?: boolean } | null)?.listing_pool_enabled === true,
    customers: results[1].count ?? 0,
    properties: results[2].count ?? 0,
    sampleCustomers: results[7].count ?? 0,
    members: results[3].count ?? 0,
    customDefinitions: results[5].count ?? 0,
    publishedProperties: results[6].count ?? 0,
    demands: results[8].count ?? 0,
    appointments: results[9].count ?? 0,
    activeIntegrations: results[4].count ?? 0,
    viewerTitle: String(viewer?.title ?? "").trim(),
    viewerRole: viewer?.role ?? null,
    viewerExpertise: cnt(specRes) + cnt(regionRes),
    poolAdvisorRecords: cnt(poolSpecRes) + cnt(poolRegionRes),
    planPaid: subRes.error ? false : (subRes.data as { status?: string } | null)?.status === "active",
    officeCash: cnt(cashAccRes) > 0 || cnt(ruleRes) > 0,
    rentalsAnswered: cnt(rentalsModRes) > 0,
    portalDeclared: portalAccRes.error ? null : (portalAccRes.count ?? 0) > 0,
    eidsReceived: cnt(eidsMailRes) > 0,
  };
}
