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

  const [profile, optional, ...results] = await Promise.all([
    loadProfileSnapshot(tenantId),
    Promise.all([
      userId ? supabase.from("profiles").select("title").eq("id", userId).maybeSingle() : Promise.resolve({ data: null, error: null }),
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
    ]),
    supabase
      .from("tenants")
      .select("name, slug, sample_seeded_at")
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

  const tenant = results[0].data as OnboardingSnapshot["tenant"];
  const customers = results[1].count ?? 0;
  const properties = results[2].count ?? 0;
  const demands = results[8].count ?? 0;
  const appointments = results[9].count ?? 0;
  const customDefinitions = results[5].count ?? 0;

  const [titleRes, specRes, regionRes, poolRes, subRes, cashAccRes, ruleRes] = optional;
  const title = String((titleRes.error ? null : (titleRes.data as { title?: string | null } | null)?.title) ?? "").trim();
  const specCount = specRes.error ? 0 : (specRes.count ?? 0);
  const regionCount = regionRes.error ? 0 : (regionRes.count ?? 0);

  // EKSTRA OLGULAR: başka modüllerin sihirbaza eklediği adımlar (bkz. onboarding-steps.ts) olgularını burada doldurur.
  const extra: Record<string, boolean> = {
    "giderler-kasa": (!cashAccRes.error && (cashAccRes.count ?? 0) > 0) || (!ruleRes.error && (ruleRes.count ?? 0) > 0),
  };

  const facts: OnboardingFacts = {
    officeLocationDone: isOfficeLocationDone(profile.completion),
    youDone: title.length > 0 && specCount + regionCount > 0,
    members: results[3].count ?? 0,
    poolEnabled: poolRes.error ? false : (poolRes.data as { listing_pool_enabled?: boolean } | null)?.listing_pool_enabled === true,
    publishedProperties: results[6].count ?? 0,
    activeIntegrations: results[4].count ?? 0,
    planPaid: subRes.error ? false : (subRes.data as { status?: string } | null)?.status === "active",
    extra,
  };
  const state = buildOnboarding(facts, skipped);
  const firstTasks = buildFirstTasks({ customers, properties, demands, appointments, customDefinitions });
  return { state, firstTasks, skipped, tenant, profile, counts: { customers, properties, sampleCustomers: results[7].count ?? 0 } };
});
