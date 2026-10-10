import { StaffNoTenantNotice } from "@/components/app/staff-no-tenant-notice";
import { redirect } from "next/navigation";
import { Alert } from "@/components/ui/alert";
import { PageHeader } from "@/components/ui/page-header";
import { getTenantGateContext } from "@/lib/cache/request";
import { canManageModules } from "@/lib/modules/permissions";
import { modulePlanInfo, planLockedKeys } from "@/lib/modules/plan";
import { MODULES, getModuleDef, type FeatureKey } from "@/lib/modules/registry";
import { loadPendingByModule } from "@/lib/modules/pending";
import { getTenantModuleState } from "@/lib/modules/state";
import { createClient } from "@/lib/supabase/server";
import { requireModulePage } from "@/lib/require-module-page";
import { ModulesBoard, type ModuleCardData } from "./modules-board";

export const metadata = { title: "Modüller" };

/**
 * Ayarlar > Modüller: ofisin kullanmadığı alanları kapatma. Menü öğesi DEĞİL, Ayarlar kartıdır.
 * Yalnız ofis sahibi ve genel müdür. Kapatma veriyi silmez; menüde, aramada ve ana ekranda gizler,
 * otomasyon/bildirim üretmez. Tablo henüz yoksa (migration uygulanmadı) hepsi açıktır ve burada açıkça söylenir.
 */
export default async function ModulesPage() {
  const { tenantId, role } = await requireModulePage("settings", "/app/ayarlar/moduller");
  if (!tenantId) return <StaffNoTenantNotice feature="Modül ayarları" />;
  if (!canManageModules(role)) redirect("/app?yetki=yok");

  const [state, planCtx] = await Promise.all([getTenantModuleState(tenantId), getTenantGateContext(tenantId)]);
  const planLocked = planLockedKeys(planCtx);
  const supabase = await createClient();
  const pending = await loadPendingByModule(
    supabase,
    MODULES.map((m) => m.key).filter((k) => !state.closed.includes(k)),
  );

  const cards: ModuleCardData[] = MODULES.map((m) => {
    const info = modulePlanInfo(m.key, planCtx);
    return {
      key: m.key,
      label: m.label,
      desc: m.desc,
      group: m.group,
      enabled: !state.closed.includes(m.key),
      platformLocked: state.locked.includes(m.key),
      planLocked: info.locked,
      requiredPlan: info.requiredPlan,
      upgradeHref: info.upgradeHref,
      dependsOn: m.dependsOn.map((k) => ({ key: k, label: getModuleDef(k as FeatureKey).label })),
      stops: "stops" in m ? m.stops : null,
      href: m.routes[0] ?? null,
    };
  });

  const writable = state.status === "ok";
  const closedCount = state.closed.length;

  return (
    <div className="space-y-6">
      <PageHeader
        eyebrow="Ofis yapılandırması"
        title="Modüller"
        description="Kullanmadığınız alanı kapatın, menü sadeleşsin. Bu ayar tüm ofis içindir; verileriniz silinmez, istediğiniz an yeniden açarsınız. Yalnız kendi menünüzü sadeleştirmek için Hesabım > Görünüm'ü kullanın."
        breadcrumbs={[{ label: "Ana ekran", href: "/app" }, { label: "Ayarlar", href: "/app/ayarlar" }, { label: "Modüller" }]}
      />

      {state.status === "unavailable" ? (
        <Alert tone="warning" title="Modül yönetimi henüz etkin değil">
          Bu özellik için gereken veritabanı güncellemesi henüz uygulanmamış. Şimdilik tüm modüller açıktır; güncelleme
          uygulanınca bu sayfadan açıp kapatabilirsiniz.
        </Alert>
      ) : null}
      {state.status === "error" ? (
        <Alert tone="danger" title="Modül durumu okunamadı">
          {state.message ?? "Tüm modüller açık gösteriliyor."} Sayfayı yenileyin; sorun sürerse destek ekibine bildirin.
        </Alert>
      ) : null}
      {writable ? (
        <p className="text-sm text-text-muted">
          <span className="numeric font-semibold text-ink-950">{MODULES.length - closedCount}</span> modül açık,{" "}
          <span className="numeric font-semibold text-ink-950">{closedCount}</span> modül kapalı.
        </p>
      ) : null}

      <ModulesBoard cards={cards} closed={state.closed} locked={state.locked} planLocked={planLocked} pendingWork={pending} canEdit={writable} />
    </div>
  );
}
