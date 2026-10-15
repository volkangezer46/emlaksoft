import { BellRing, ListChecks, Map as MapIcon } from "lucide-react";
import { PageHeader } from "@/components/ui/page-header";
import { PageTabs } from "@/components/app/page-tabs";
import { parsePage } from "@/app/admin/_components/pagination";
import { requirePlatformModule } from "@/lib/platform";
import { platformModuleMode } from "@/lib/platform-access";
import { filterProgress, loadOfficeProgress } from "@/lib/admin/onboarding-progress";
import { isEmptyOnboardingContent, materializeOnboardingContent, EMPTY_ONBOARDING_CONTENT, ONBOARDING_TOUR_IDS } from "@/lib/onboarding-content";
import { loadOnboardingContent } from "@/lib/onboarding-content-read";
import { TOUR_ROLES } from "@/lib/product-tour-roles";
import { ROLE_LABELS } from "@/lib/role-labels";
import { getPlanDefinitions } from "@/lib/billing/plan-definitions";
import { planLabelIn } from "@/lib/billing/plans";
import { NotReadyNotice, OfficeProgressList, PROGRESS_BASE } from "./office-progress";
import { OnboardingContentEditor } from "./content-editor";
import { NudgeHistory } from "./nudge-history";

export const metadata = { title: "Kurulum ve ürün turu" };

const TABS = [
  { id: "ilerleme", label: "İlerleme", icon: ListChecks },
  { id: "icerik", label: "İçerik", icon: MapIcon },
  { id: "hatirlatma", label: "Hatırlatmalar", icon: BellRing },
] as const;

/**
 * Ofisler > Kurulum (SN5): (1) İlerleme — ofis bazında kurulum sihirbazı ilerlemesi, takılan adıma göre süzgeç (`adim=`),
 * her satır Ofis 360'a; (2) İçerik — ürün turu adımları ve kurulum kontrol listesi düzenleyicisi (metin, hedef, sıra,
 * açık/kapalı, rol/paket hedefleme). Varsayılanlar kodda; kayıt ayar defterinde (`onboarding.content`, geçmişli).
 */
export default async function OnboardingAdminPage({ searchParams }: { searchParams: Promise<{ sekme?: string; adim?: string; sayfa?: string; anahtar?: string }> }) {
  const staff = await requirePlatformModule("tenants");
  const sp = await searchParams;
  const active = sp.sekme === "icerik" ? "icerik" : sp.sekme === "hatirlatma" ? "hatirlatma" : "ilerleme";

  const header = (
    <>
      <PageHeader
        eyebrow="Ofisler"
        title="Kurulum ve ürün turu"
        description="Ofislerin kurulum sihirbazında nerede takıldığını görün; ofis panelindeki tanıtım turlarını ve kurulum adımlarını koda dokunmadan düzenleyin."
      />
      <PageTabs base={PROGRESS_BASE} label="Kurulum sekmeleri" tabs={TABS} active={active} />
    </>
  );

  if (active === "hatirlatma") {
    return (
      <div className="space-y-6">
        {header}
        <NudgeHistory anahtar={typeof sp.anahtar === "string" ? sp.anahtar : null} />
      </div>
    );
  }

  if (active === "icerik") {
    const [content, catalog] = await Promise.all([loadOnboardingContent(), getPlanDefinitions().catch(() => [])]);
    const canEdit = (staff.role === "super_admin" || staff.role === "ops") && platformModuleMode(staff, "tenants") === "write";
    const roleOptions = Object.entries(ROLE_LABELS).map(([value, label]) => ({ value, label }));
    const tourRoles = Object.fromEntries(
      ONBOARDING_TOUR_IDS.map((id) => [id, TOUR_ROLES[id].map((r) => ({ value: r, label: ROLE_LABELS[r] ?? r }))]),
    ) as Record<(typeof ONBOARDING_TOUR_IDS)[number], { value: string; label: string }[]>;
    const planOptions = catalog.filter((p) => !p.archived).map((p) => ({ value: p.id, label: p.name }));
    return (
      <div className="space-y-6">
        {header}
        <OnboardingContentEditor
          initial={materializeOnboardingContent(content)}
          defaults={materializeOnboardingContent(EMPTY_ONBOARDING_CONTENT)}
          tourOrder={ONBOARDING_TOUR_IDS}
          tourRoles={tourRoles}
          roleOptions={roleOptions}
          planOptions={planOptions}
          canEdit={canEdit}
          customized={!isEmptyOnboardingContent(content)}
        />
      </div>
    );
  }

  const [facts, catalog] = await Promise.all([loadOfficeProgress(), getPlanDefinitions().catch(() => undefined)]);
  const all = facts.rows;
  const adim = typeof sp.adim === "string" && sp.adim ? sp.adim.slice(0, 60) : null;
  const rows = filterProgress(all, adim);

  return (
    <div className="space-y-6">
      {header}
      {!facts.ready ? (
        <NotReadyNotice />
      ) : facts.error ? (
        <p className="rounded-[var(--radius-panel)] border border-danger-400/30 bg-danger-500/8 px-5 py-6 text-sm text-danger-600">
          Kurulum ilerlemesi okunamadı. Sayfayı yenileyip tekrar deneyin.
        </p>
      ) : (
        <OfficeProgressList all={all} rows={rows} adim={adim} page={parsePage(sp.sayfa)} planLabel={(id) => (id ? planLabelIn(id, catalog) : "Paket yok")} />
      )}
    </div>
  );
}
