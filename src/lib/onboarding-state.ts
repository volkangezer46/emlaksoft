import { cache } from "react";
import { cookies } from "next/headers";
import { createClient } from "@/lib/supabase/server";
import { getRequestUser } from "@/lib/supabase/auth-cache";
import {
  buildFirstTasks,
  buildOnboarding,
  type FirstTask,
  type OnboardingFacts,
  type OnboardingState,
} from "@/lib/onboarding-checklist";
import { parseSkipped, setupSkipCookieName } from "@/lib/setup-skip";
import { loadProfileSnapshot, type ProfileSnapshot } from "@/lib/profile-completion-data";
import { isOfficeLocationDone } from "@/lib/profile-completion";
import { PORTAL_MEMBERSHIP_EDITOR_ROLES } from "@/lib/portals/membership";
import { resolveChecklistDefs } from "@/lib/onboarding-content";
import { loadOnboardingContent } from "@/lib/onboarding-content-read";

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
 * Kurulum durumunun TEK kaynağı: /app/baslangic sihirbazı, ana ekran Başlangıç kartı, Ayarlar ve Yardım aynı
 * sayımları kullanır. Tamamlanma gerçek veriden çıkar; yalnız "sonra yaparım" çerezden gelir.
 * Çekirdek sorgulardan biri hata verirse null döner (sahte ilerleme gösterilmez); isteğe bağlı olgu sorguları
 * (uzmanlık, havuz, abonelik) hata verirse yalnız o olgu "yok" sayılır.
 */
export const loadOnboardingSnapshot = cache(async (tenantId: string): Promise<OnboardingSnapshot | null> => {
  const supabase = await createClient();
  const user = await getRequestUser();
  const jar = await cookies();
  const skipped = user ? parseSkipped(jar.get(setupSkipCookieName(user.id))?.value) : [];
  const userId = user?.id ?? null;

  const [profile, content, optional, ...results] = await Promise.all([
    loadProfileSnapshot(tenantId),
    // Adminden düzenlenen adım sırası/metni/açık-kapalı/hedefleme (SN5); okunamazsa koddaki liste.
    loadOnboardingContent(),
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
      // Portal üyelikleri (EP1): sahip/genel müdür kartı en az bir kez kaydetti mi (her portal "Bilmiyorum" olsa da beyan
      // sayılır; eklentinin açtığı 'unknown' satırı sayılmaz). Tablo yoksa hata → olgu yazılmaz, eski kural.
      supabase.from("tenant_portal_accounts").select("portal", { count: "exact", head: true }).eq("tenant_id", tenantId).eq("source", "owner_declared"),
      // Bakanlık (EİDS) e-postaları adımı: etkin alma adresine en az bir e-posta ulaştı mı (EP3 tablosu; yoksa hata = adım bitmedi).
      supabase
        .from("eids_inbound_addresses")
        .select("tenant_id", { count: "exact", head: true })
        .eq("tenant_id", tenantId)
        .is("revoked_at", null)
        .not("last_received_at", "is", null),
    ]),
    supabase
      .from("tenants")
      .select("name, slug, sample_seeded_at, plan")
      .eq("id", tenantId)
      .maybeSingle(),
    supabase.from("customers").select("id", { count: "exact", head: true }).eq("is_sample", false),
    supabase.from("properties").select("id", { count: "exact", head: true }).eq("is_sample", false),
    supabase.from("profiles").select("id", { count: "exact", head: true }).eq("tenant_id", tenantId),
    supabase
      .from("tenant_integrations")
      .select("id", { count: "exact", head: true })
      .eq("is_active", true)
      .in("provider", ["netgsm", "whatsapp"]),
    supabase.from("definitions").select("id", { count: "exact", head: true }).eq("tenant_id", tenantId),
    supabase
      .from("properties")
      .select("id", { count: "exact", head: true })
      .eq("is_sample", false)
      .not("published_at", "is", null),
    supabase.from("customers").select("id", { count: "exact", head: true }).eq("is_sample", true),
    supabase.from("customer_demands").select("id", { count: "exact", head: true }).eq("is_sample", false),
    supabase.from("appointments").select("id", { count: "exact", head: true }).eq("is_sample", false),
  ]);
  if (!profile || results.some((r) => r.error)) return null;

  const tenantRow = results[0].data as (NonNullable<OnboardingSnapshot["tenant"]> & { plan?: string | null }) | null;
  const tenant: OnboardingSnapshot["tenant"] = tenantRow
    ? { name: tenantRow.name, slug: tenantRow.slug, sample_seeded_at: tenantRow.sample_seeded_at }
    : null;
  const customers = results[1].count ?? 0;
  const properties = results[2].count ?? 0;
  const demands = results[8].count ?? 0;
  const appointments = results[9].count ?? 0;
  const customDefinitions = results[5].count ?? 0;

  const [titleRes, specRes, regionRes, poolRes, subRes, cashAccRes, ruleRes, poolSpecRes, poolRegionRes, rentalsModRes, portalAccRes, eidsMailRes] = optional;
  const title = String((titleRes.error ? null : (titleRes.data as { title?: string | null } | null)?.title) ?? "").trim();
  const specCount = specRes.error ? 0 : (specRes.count ?? 0);
  const regionCount = regionRes.error ? 0 : (regionRes.count ?? 0);

  // EKSTRA OLGULAR: başka modüllerin sihirbaza eklediği adımlar (bkz. onboarding-steps.ts) olgularını burada doldurur.
  const extra: Record<string, boolean> = {
    "giderler-kasa": (!cashAccRes.error && (cashAccRes.count ?? 0) > 0) || (!ruleRes.error && (ruleRes.count ?? 0) > 0),
    "mulk-yonetimi": !rentalsModRes.error && (rentalsModRes.count ?? 0) > 0,
    "yetki-belgesi": Boolean(profile.facts.licenseNo?.trim()),
    "eids-eposta": !eidsMailRes.error && (eidsMailRes.count ?? 0) > 0,
  };
  // Üyelik kartını yalnız owner/gm kaydedebilir: diğer roller (settings:edit olsa da) bu beyanı yapamaz, adım onlara açık kalmaz.
  const viewerRole = titleRes.error ? null : ((titleRes.data as { role?: string | null } | null)?.role ?? null);
  if (!portalAccRes.error) extra["portal-uyelik"] = (portalAccRes.count ?? 0) > 0 || (viewerRole !== null && !PORTAL_MEMBERSHIP_EDITOR_ROLES.has(viewerRole));

  const facts: OnboardingFacts = {
    officeLocationDone: isOfficeLocationDone(profile.completion),
    youDone: title.length > 0 && specCount + regionCount > 0,
    members: results[3].count ?? 0,
    poolEnabled: poolRes.error ? false : (poolRes.data as { listing_pool_enabled?: boolean } | null)?.listing_pool_enabled === true,
    poolAdvisorRecords: (poolSpecRes.error ? 0 : (poolSpecRes.count ?? 0)) + (poolRegionRes.error ? 0 : (poolRegionRes.count ?? 0)),
    publishedProperties: results[6].count ?? 0,
    activeIntegrations: results[4].count ?? 0,
    planPaid: subRes.error ? false : (subRes.data as { status?: string } | null)?.status === "active",
    extra,
  };
  // Rol/paket hedefi: kullanıcının rolü ve ofisin paketi (bilinmiyorsa o hedef uygulanmaz).
  const defs = resolveChecklistDefs(content, { role: viewerRole, plan: tenantRow?.plan ?? null });
  const state = buildOnboarding(facts, skipped, defs);
  const firstTasks = buildFirstTasks({ customers, properties, demands, appointments, customDefinitions });
  return { state, firstTasks, skipped, tenant, profile, counts: { customers, properties, sampleCustomers: results[7].count ?? 0 } };
});
