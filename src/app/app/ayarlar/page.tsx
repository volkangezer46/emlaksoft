import Link from "@/components/ui/smart-link";
import { ArrowRight, Settings } from "lucide-react";
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
import { SettingsIndex, type SettingsIndexCategory } from "./_sekmeler/settings-index";
import { visibleSettingsDirectory } from "./_sekmeler/settings-directory";
import { isAdvancedSetting } from "./_sekmeler/advanced";
import { effectiveCanAccessModule } from "@/lib/permissions-effective";
import type { SupabaseClient } from "@supabase/supabase-js";
import { IconChip } from "@/components/ui/icons";

export async function generateMetadata({ searchParams }: { searchParams?: Promise<{ sekme?: string }> }) {
  const tab = parseSettingsTab((await searchParams)?.sekme);
  return { title: `${SETTINGS_TABS.find((t) => t.id === tab)?.label ?? "Ayarlar"} · Ayarlar` };
}

/**
 * Dizin kartlarının gerçek durum rozetleri (sıfır çıkmaz: rozet yalnız gerçek sayıdan doğar). İki sayım, paralel ve
 * yalnız dizin sekmesinde; hata/tablo yoksa rozet çizilmez.
 */
async function loadDirectoryStatus(supabase: SupabaseClient, tenantId: string | null) {
  if (!tenantId) return { rules: 0, sample: 0 };
  const [rules, sample] = await Promise.all([
    supabase.from("tenant_settings").select("key", { count: "exact", head: true }).eq("tenant_id", tenantId),
    supabase.from("customers").select("id", { count: "exact", head: true }).eq("tenant_id", tenantId).eq("is_sample", true),
  ]);
  return { rules: rules.error ? 0 : (rules.count ?? 0), sample: sample.error ? 0 : (sample.count ?? 0) };
}

/**
 * /app/ayarlar — açılış sekmesi kategorili, aranabilir AYAR DİZİNİ (OA13; `?sekme=dizin`, varsayılan). Marka/kimlik formu
 * (`?sekme=kimlik`) ve eşleştirme ağırlıkları (`?sekme=eslestirme`) kendi sekmelerindedir. Kurulum ilerlemesi tek
 * bağlantıdır: sihirbaz (/app/baslangic) ile aynı kaynak (`onboarding-state`).
 */
export default async function SettingsPage({ searchParams }: { searchParams?: Promise<{ sekme?: string }> }) {
  const { tenantId, perms, role } = await requireModulePage("settings");
  const sp = (await searchParams) ?? {};
  const tab = parseSettingsTab(sp.sekme);
  const canEditSettings = (perms.settings ?? []).includes("edit");
  const supabase = await createClient();
  const [snap, { data: tenantRow }, status] = await Promise.all([
    tenantId ? loadOnboardingSnapshot(tenantId) : Promise.resolve(null),
    supabase.from("tenants").select(SETTINGS_TENANT_COLUMNS).limit(1).maybeSingle(),
    tab === "dizin" ? loadDirectoryStatus(supabase, tenantId) : Promise.resolve({ rules: 0, sample: 0 }),
  ]);
  const tenant: SettingsTenant = { ...EMPTY_SETTINGS_TENANT, ...((tenantRow as Partial<SettingsTenant> | null) ?? {}) };
  // Adminden eklenen pakette ad katalogdan (taban kimlikte katalog okunmaz).
  const planName = await getPlanName(tenant.plan);
  const percent = snap?.state.percent ?? null;

  const allDirectory: SettingsIndexCategory[] =
    tab === "dizin"
      ? visibleSettingsDirectory(role, (mod) => effectiveCanAccessModule(perms, mod)).map((c) => ({
          id: c.id,
          label: c.label,
          description: c.description,
          items: c.items.map((i) => ({
            href: i.href,
            label: i.label,
            description: i.description,
            keywords: i.keywords,
            status:
              i.statusKey === "rules" && status.rules > 0
                ? { text: `${status.rules} tanım özelleştirildi`, tone: "brand" as const }
                : i.statusKey === "sample" && status.sample > 0
                  ? { text: "Örnek veri var", tone: "warning" as const }
                  : null,
          })),
        }))
      : [];
  // C26: gelişmiş ekranlar ayrı, katlı bölüme (aramada bulunur); kategoriler yalnız sık kullanılanlarla açılır.
  const advanced = allDirectory.flatMap((c) => c.items.filter((i) => isAdvancedSetting(i.href)));
  const directory = allDirectory.map((c) => ({ ...c, items: c.items.filter((i) => !isAdvancedSetting(i.href)) })).filter((c) => c.items.length > 0);

  return (
    <div className="space-y-6">
      <PageHeader icon={<IconChip icon={Settings} size="lg" />}
        title="Ayarlar"
        eyebrow={tenant.name || "Ofis yapılandırması"}
        description={`${tenant.name ? `${tenant.name} · ` : ""}${planName} planı. Aradığınız ayarı yazın ya da başlıktan seçin.`}
        actions={
          // Kurulum sihirbazı ofis yapılandırmasıdır: düzenleme yetkisi olmayana (danışman, salt okunur) "devam et" çıkmaz.
          canEditSettings && percent !== null && percent < 100 ? (
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

      {tab === "dizin" ? <SettingsIndex categories={directory} advanced={advanced} /> : null}
      {tab === "kimlik" ? <KimlikTab tenant={tenant} tenantId={tenantId} canEdit={canEditSettings} /> : null}
      {tab === "eslestirme" ? <EslestirmeTab canEdit={canEditSettings} /> : null}
    </div>
  );
}
