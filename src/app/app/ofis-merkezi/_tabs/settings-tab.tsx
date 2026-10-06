import Link from "next/link";
import { ArrowUpRight } from "lucide-react";
import { officeSettingHistoryAction, resetOfficeSettingAction, revertOfficeSettingAction, saveOfficeSettingAction } from "@/app/actions/office-settings";
import { ModuleShortcuts, type ModuleShortcut } from "@/components/app/office-center/module-shortcuts";
import { SettingField } from "@/components/settings/setting-field";
import { Alert } from "@/components/ui/alert";
import { StatRow } from "@/components/ui/stat-row";
import { getTenantGateContext } from "@/lib/cache/request";
import { canManageModules } from "@/lib/modules/permissions";
import { modulePlanInfo } from "@/lib/modules/plan";
import { MODULES } from "@/lib/modules/registry";
import { getTenantModuleState } from "@/lib/modules/state";
import { tabHref } from "@/lib/office-center/logic";
import { getTenantSettingViews } from "@/lib/settings/read";
import { OFFICE_SETTING_GROUPS } from "@/lib/settings/types";
import { first, type TabContext } from "./context";

const ACTIONS = { save: saveOfficeSettingAction, reset: resetOfficeSettingAction, revert: revertOfficeSettingAction, history: officeSettingHistoryAction };

/**
 * Ayarlar sekmesi: ofis ayar kayıt defteri (değer · geçmiş · etki; geri alma/varsayılana dönüş) + modül kısa yolu.
 * Aynı bileşen ve eylemler /app/ayarlar/merkez ile paylaşılır (kopya ekran değil, aynı kaynak).
 */
export async function SettingsTab({ ctx }: { ctx: TabContext }) {
  const grupParam = first(ctx.sp.grup);
  const grup = OFFICE_SETTING_GROUPS.find((g) => g.id === grupParam)?.id;
  const onlyChanged = first(ctx.sp.ayar) === "degisen";
  const [views, moduleState, planCtx] = await Promise.all([getTenantSettingViews(ctx.tenantId), getTenantModuleState(ctx.tenantId), getTenantGateContext(ctx.tenantId)]);
  const changed = views.filter((v) => !v.isDefault).length;
  const shown = views.filter((v) => (!grup || v.group === grup) && (!onlyChanged || !v.isDefault));
  const groups = OFFICE_SETTING_GROUPS.map((g) => ({ ...g, items: shown.filter((v) => v.group === g.id) })).filter((g) => g.items.length > 0);

  const modules: ModuleShortcut[] = MODULES.map((m) => {
    const info = modulePlanInfo(m.key, planCtx);
    const platformLocked = moduleState.locked.includes(m.key);
    return {
      key: m.key,
      label: m.label,
      desc: m.desc,
      enabled: !moduleState.closed.includes(m.key),
      locked: platformLocked || info.locked,
      lockReason: platformLocked ? "Platform tarafından kilitli." : info.locked ? `Paketinize dahil değil${info.requiredPlan ? ` (${info.requiredPlan})` : ""}.` : null,
      href: m.routes[0] ?? null,
    };
  });
  const canToggle = canManageModules(ctx.role) && moduleState.status === "ok";

  return (
    <div className="space-y-6">
      <StatRow
        label="Ayar özeti"
        items={[
          { label: "Toplam ayar", value: views.length, href: tabHref("ayarlar") },
          { label: "Varsayılandan farklı", value: changed, href: tabHref("ayarlar", { ayar: "degisen" }), attention: changed > 0 },
          ...OFFICE_SETTING_GROUPS.map((g) => ({ label: g.label, value: views.filter((v) => v.group === g.id).length, href: tabHref("ayarlar", { grup: g.id }) })),
          { label: "Kapalı modül", value: moduleState.closed.length, href: "/app/ayarlar/moduller" },
        ]}
      />

      {!ctx.canEditSettings ? (
        <Alert tone="info" title="Görüntüleme modu">
          Ayar değiştirmek için ayar düzenleme yetkisi gerekir (ofis sahibi / genel müdür). Değerleri ve geçmişi görebilirsiniz.
        </Alert>
      ) : null}

      <nav aria-label="Ayar grupları" className="flex flex-wrap gap-2">
        <Link href={tabHref("ayarlar")} aria-current={!grup && !onlyChanged ? "page" : undefined} className={`focus-ring rounded-full border px-3 py-1 text-xs font-semibold ${!grup && !onlyChanged ? "border-ink-950 bg-ink-950 text-white" : "border-line bg-surface text-ink-950 hover:bg-canvas"}`}>
          Tümü ({views.length})
        </Link>
        {OFFICE_SETTING_GROUPS.map((g) => (
          <Link key={g.id} href={tabHref("ayarlar", { grup: g.id })} aria-current={grup === g.id ? "page" : undefined} className={`focus-ring rounded-full border px-3 py-1 text-xs font-semibold ${grup === g.id ? "border-ink-950 bg-ink-950 text-white" : "border-line bg-surface text-ink-950 hover:bg-canvas"}`}>
            {g.label}
          </Link>
        ))}
        <Link href="/app/ayarlar/merkez" className="ml-auto inline-flex items-center gap-0.5 text-xs font-semibold text-brand-600 hover:underline">
          Tanımlar merkezi <ArrowUpRight className="h-3 w-3" aria-hidden="true" />
        </Link>
      </nav>

      {groups.length === 0 ? (
        <p className="rounded-[var(--radius-card)] border border-dashed border-line px-4 py-10 text-center text-sm text-text-muted">{onlyChanged ? "Varsayılandan farklı ayar yok; her şey standart değerlerde." : "Bu grupta ayar yok."}</p>
      ) : (
        groups.map((g) => (
          <section key={g.id} aria-labelledby={`oc-grup-${g.id}`} className="space-y-3">
            <div>
              <h2 id={`oc-grup-${g.id}`} className="text-base font-semibold text-ink-950">
                {g.label}
              </h2>
              <p className="text-xs text-text-muted">{g.description}</p>
            </div>
            <div className="grid gap-3">
              {g.items.map((v) => (
                <SettingField key={v.key} view={v} canEdit={ctx.canEditSettings} actions={ACTIONS} readOnlyNote="Bu ayarı değiştirmek için ayar düzenleme yetkisi gerekir." />
              ))}
            </div>
          </section>
        ))
      )}

      <section aria-labelledby="oc-moduller" className="space-y-3">
        <div className="flex flex-wrap items-end justify-between gap-2">
          <div>
            <h2 id="oc-moduller" className="text-base font-semibold text-ink-950">
              Modüller
            </h2>
            <p className="text-xs text-text-muted">Kullanmadığınız alanı kapatın; menü sadeleşir, veri silinmez. Ön ayarlar ve bekleyen iş dökümü için tam ekran: Ayarlar &gt; Modüller.</p>
          </div>
          <Link href="/app/ayarlar/moduller" className="inline-flex items-center gap-0.5 text-xs font-semibold text-brand-600 hover:underline">
            Modül yönetimi <ArrowUpRight className="h-3 w-3" aria-hidden="true" />
          </Link>
        </div>
        {moduleState.status === "unavailable" ? (
          <Alert tone="warning" title="Modül yönetimi henüz etkin değil">
            Gereken veritabanı güncellemesi uygulanmamış; şimdilik tüm modüller açık.
          </Alert>
        ) : null}
        {!canManageModules(ctx.role) ? <p className="text-xs text-text-muted">Modülleri yalnız ofis sahibi ve genel müdür değiştirebilir.</p> : null}
        <ModuleShortcuts modules={modules} canEdit={canToggle} />
      </section>
    </div>
  );
}
