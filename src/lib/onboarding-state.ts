import { cache } from "react";
import { cookies } from "next/headers";
import { createClient } from "@/lib/supabase/server";
import { getRequestUser } from "@/lib/supabase/auth-cache";
import { buildOnboarding, type OnboardingState } from "@/lib/onboarding-checklist";
import { parseSkipped, setupSkipCookieName } from "@/lib/setup-skip";

export type OnboardingSnapshot = {
  state: OnboardingState;
  skipped: ReturnType<typeof parseSkipped>;
  tenant: {
    name: string;
    phone: string | null;
    city: string | null;
    address_line: string | null;
    license_no: string | null;
    logo_url: string | null;
    slug: string | null;
    sample_seeded_at: string | null;
  } | null;
  counts: { customers: number; properties: number; sampleCustomers: number };
};

/**
 * Kurulum durumunun TEK kaynağı: /app/baslangic sihirbazı ve ana ekran kurulum şeridi aynı
 * sayımları kullanır. Tamamlanma gerçek veriden çıkar; yalnız "sonra yaparım" çerezden gelir.
 * Herhangi bir sorgu hata verirse null döner (sahte ilerleme gösterilmez).
 */
export const loadOnboardingSnapshot = cache(async (tenantId: string): Promise<OnboardingSnapshot | null> => {
  const supabase = await createClient();
  const user = await getRequestUser();
  const jar = await cookies();
  const skipped = user ? parseSkipped(jar.get(setupSkipCookieName(user.id))?.value) : [];

  const results = await Promise.all([
    supabase
      .from("tenants")
      .select("name, phone, city, address_line, license_no, logo_url, slug, sample_seeded_at")
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
  ]);
  if (results.some((r) => r.error)) return null;

  const tenant = results[0].data as OnboardingSnapshot["tenant"];
  const customers = results[1].count ?? 0;
  const properties = results[2].count ?? 0;
  const state = buildOnboarding(
    {
      profileFilled: {
        phone: Boolean(tenant?.phone),
        city: Boolean(tenant?.city),
        licenseNo: Boolean(tenant?.license_no),
      },
      customers,
      properties,
      members: results[3].count ?? 0,
      activeIntegrations: results[4].count ?? 0,
      customDefinitions: results[5].count ?? 0,
      publishedProperties: results[6].count ?? 0,
    },
    skipped,
  );
  return { state, skipped, tenant, counts: { customers, properties, sampleCustomers: results[7].count ?? 0 } };
});
