import Link from "@/components/ui/smart-link";
import { ArrowRight } from "lucide-react";
import { createClient } from "@/lib/supabase/server";
import { requireModulePage } from "@/lib/require-module-page";
import { getPlanName } from "@/lib/billing/plan-definitions";
import { loadOnboardingSnapshot } from "@/lib/onboarding-state";
import { PageHeader } from "@/components/ui/page-header";
import { SegmentTabs } from "@/components/ui/segment-tabs";
import { SETTINGS_TABS, parseSettingsTab, settingsTabHref } from "./_sekmeler/tabs";
import { EMPTY_SETTINGS_TENANT, SETTINGS_TENANT_COLUMNS, type SettingsTenant } from "./_sekmeler/types";
import { KimlikTab } from "./_sekmeler/kimlik-tab";
import { EslestirmeTab } from "./_sekmeler/eslestirme-tab";

export async function generateMetadata({ searchParams }: { searchParams?: Promise<{ sekme?: string }> }) {
  const tab = parseSettingsTab((await searchParams)?.sekme);
  return { title: `${SETTINGS_TABS.find((t) => t.id === tab)?.label ?? "Ayarlar"} · Ayarlar` };
}

/**
 * /app/ayarlar — gövde yalnız iki sekmedir (`?sekme=kimlik|eslestirme`, varsayılan kimlik); diğer ayar sayfaları üstteki
 * TEK Ayarlar şeridindedir (`nav-roles.ts` AYARLAR). Kurulum ilerlemesi tek bağlantıdır: sihirbaz (/app/baslangic) ile
 * aynı kaynak (`onboarding-state`).
 */
export default async function SettingsPage({ searchParams }: { searchParams?: Promise<{ sekme?: string }> }) {
  const { tenantId, perms } = await requireModulePage("settings");
  const sp = (await searchParams) ?? {};
  const tab = parseSettingsTab(sp.sekme);
  const canEditSettings = (perms.settings ?? []).includes("edit");
  const supabase = await createClient();
  const [snap, { data: tenantRow }] = await Promise.all([
    tenantId ? loadOnboardingSnapshot(tenantId) : Promise.resolve(null),
    supabase.from("tenants").select(SETTINGS_TENANT_COLUMNS).limit(1).maybeSingle(),
  ]);
  const tenant: SettingsTenant = { ...EMPTY_SETTINGS_TENANT, ...((tenantRow as Partial<SettingsTenant> | null) ?? {}) };
  // Adminden eklenen pakette ad katalogdan (taban kimlikte katalog okunmaz).
  const planName = await getPlanName(tenant.plan);
  const percent = snap?.state.percent ?? null;

  return (
    <div className="space-y-6">
      <PageHeader
        title={tenant.name || "Ayarlar"}
        eyebrow="Ofis yapılandırması"
        description={`${planName} planı · ofis kimliği, ekip, uyum ve entegrasyonlar.`}
        actions={
          percent !== null && percent < 100 ? (
            <Link
              href="/app/baslangic"
              className="focus-ring press inline-flex min-h-11 items-center gap-1.5 rounded-[var(--radius-control)] border border-line bg-surface px-3.5 py-2 text-sm font-semibold text-brand-600 transition hover:border-brand-300"
            >
              %{percent} kurulum, devam et <ArrowRight className="h-4 w-4" aria-hidden />
            </Link>
          ) : null
        }
      />

      <SegmentTabs label="Ayarlar sekmeleri" active={tab} items={SETTINGS_TABS.map((t) => ({ id: t.id, label: t.label, href: settingsTabHref(t.id) }))} />

      {tab === "kimlik" ? <KimlikTab tenant={tenant} tenantId={tenantId} canEdit={canEditSettings} /> : null}
      {tab === "eslestirme" ? <EslestirmeTab canEdit={canEditSettings} /> : null}
    </div>
  );
}
