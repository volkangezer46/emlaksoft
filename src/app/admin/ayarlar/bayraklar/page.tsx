import Link from "@/components/ui/smart-link";
import { Flag } from "lucide-react";
import { AdminPageHeader } from "@/components/admin/admin-page-header";
import { Table, TableFrame, TBody, TD, TH, THead, TR } from "@/components/ui/table";
import { requirePlatformModule } from "@/lib/platform";
import { getFeatureFlagStates } from "@/lib/feature-flags/server";
import { tenantNamesFor } from "@/lib/feature-flags/rules";
import { describeFlagRule, FLAG_RULE_PLANS } from "@/lib/feature-flags/targeting";
import { planLabel } from "@/lib/billing/plans";
import { getSettingDef } from "@/lib/settings/registry";
import { getPlatformSettingsMany } from "@/lib/platform-settings";
import { MAINTENANCE_SCOPE_SETTING_KEY, parseMaintenanceScope } from "@/lib/platform-security/maintenance-scope";
import { PLATFORM_SETTING_KEYS } from "@/lib/platform-setting-keys";
import { toTrLocalInput } from "@/lib/clock";
import { CopyLine } from "@/app/admin/personel/guvenlik/security-forms";
import { FlagSwitch, MaintenanceCard } from "./flag-controls";
import { FlagTargetingForm } from "./flag-targeting-form";

export const metadata = { title: "Özellik bayrakları" };

const SOURCE_LABEL = { setting: "Platform ayarı", platform: "Platform ayarı (kendi ekranı)", env: "Sunucu ortamı" } as const;
const ENV_FILE = "/root/emlaksoft/.env.production";

/**
 * Özellik bayrakları: dağınık açma/kapama bayraklarının TEK listesi (envanter `src/lib/feature-flags/registry.ts`,
 * okuyucu `isFeatureEnabled`). Her satır gerçek durumu, açıklamayı ve etkiyi gösterir. Ayar kaynaklı bayraklarda
 * süper admin için satır içi anahtar (onay + gerekçe; mevcut ayar yazım yolu, geçmiş `settings_history`); ortam
 * bayrakları buradan değiştirilemez: TAVAN olarak gösterilir ve açma komutu kopyalanabilir.
 * Hedefleme (DG8): `targetable` bayraklar için ofis listesi / plan / yüzde / zaman penceresi kuralı (`feature_flag_rules`).
 */
export default async function FeatureFlagsPage() {
  const staff = await requirePlatformModule("sistem");
  const isSuper = staff.role === "super_admin";
  const [states, raw] = await Promise.all([
    getFeatureFlagStates(),
    getPlatformSettingsMany([MAINTENANCE_SCOPE_SETTING_KEY, PLATFORM_SETTING_KEYS.maintenanceMessage]),
  ]);
  const on = states.filter((s) => s.enabled).length;
  const targetable = states.filter((s) => s.def.targetable);
  const names = await tenantNamesFor(targetable.flatMap((s) => s.rule?.tenantIds ?? []));
  const fmtDate = (iso: string) => new Intl.DateTimeFormat("tr-TR", { dateStyle: "medium", timeStyle: "short", timeZone: "Europe/Istanbul" }).format(new Date(iso));
  const planOptions = FLAG_RULE_PLANS.map((p) => ({ value: p, label: planLabel(p) }));
  const scope = parseMaintenanceScope(raw[MAINTENANCE_SCOPE_SETTING_KEY]);
  const maintenanceOn = states.find((s) => s.def.key === "maintenance_mode")?.enabled ?? false;

  return (
    <div className="space-y-6">
      <AdminPageHeader
        art="gear"
        eyebrow="Ayarlar"
        icon={Flag}
        title="Özellik bayrakları"
        description={`${states.length} bayrak, ${on} tanesi şu an açık. Ayar bayrakları buradan veya kendi bölümünden değiştirilir ve geçmişe yazılır; ortam bayrakları sunucu ortamında (.env.production + yeniden yayın) değiştirilir.`}
      />
      <MaintenanceCard
        maintenanceOn={maintenanceOn}
        scope={scope.scope}
        startsAt={scope.startsAt ? toTrLocalInput(scope.startsAt) : ""}
        endsAt={scope.endsAt ? toTrLocalInput(scope.endsAt) : ""}
        message={raw[PLATFORM_SETTING_KEYS.maintenanceMessage] ?? ""}
        canEdit={isSuper}
      />
      <TableFrame minWidth={860}>
        <Table>
          <caption className="sr-only">Özellik bayrakları, durumları ve etkileri</caption>
          <THead>
            <TR>
              <TH>Bayrak</TH>
              <TH>Durum</TH>
              <TH>Etkisi</TH>
              <TH>Kaynak</TH>
              <TH align="right">Düzenleme</TH>
            </TR>
          </THead>
          <TBody>
            {states.map(({ def, raw: rawOn, enabled, rule }) => {
              const inline = isSuper && def.source === "setting" && def.settingKey && getSettingDef(def.settingKey)?.editMode === "center";
              const vars = def.envVars ?? (def.envVar ? [def.envVar] : []);
              return (
                <TR key={def.key}>
                  <TD>
                    <span className="block font-semibold text-ink-950">{def.label}</span>
                    <span className="block text-xs text-text-muted">{def.description}</span>
                  </TD>
                  <TD>
                    <span
                      className={`inline-flex items-center gap-1.5 rounded-full px-2 py-0.5 text-xs font-bold ${
                        enabled ? "bg-mint-500/15 text-mint-700" : "bg-ink-950/6 text-text-muted"
                      }`}
                    >
                      <span className={`h-1.5 w-1.5 rounded-full ${enabled ? "bg-mint-500" : "bg-text-faint"}`} aria-hidden />
                      {enabled ? (rule ? "Hedefli açık" : "Açık") : rawOn && def.requires ? "Açık ama bağlı bayrak kapalı" : "Kapalı"}
                    </span>
                    {rule ? (
                      <a href={`#hedef-${def.key}`} className="mt-1 block text-xs text-brand-600 hover:underline">
                        {describeFlagRule(rule, fmtDate)}
                      </a>
                    ) : null}
                  </TD>
                  <TD className="max-w-xs text-xs text-text-muted">{def.impact}</TD>
                  <TD className="text-xs text-text-muted">
                    <span className="inline-flex items-center gap-1.5">
                      {SOURCE_LABEL[def.source]}
                      {def.source === "env" ? (
                        <span className="rounded-full bg-amber-400/15 px-1.5 py-0.5 text-xs font-bold text-amber-700" title="Yönetimden aşılamaz üst sınır">
                          tavan
                        </span>
                      ) : null}
                    </span>
                    {vars.map((v) => (
                      <code key={v} className="mt-0.5 block text-text-faint">
                        {v}
                      </code>
                    ))}
                  </TD>
                  <TD align="right">
                    <div className="flex flex-col items-end gap-1.5">
                      {inline ? <FlagSwitch flagKey={def.key} label={def.label} on={rawOn} /> : null}
                      {def.editHref ? (
                        <Link href={def.editHref} className="text-xs font-semibold text-brand-600 hover:underline">
                          {inline ? "Ayrıntı →" : "Düzenle →"}
                        </Link>
                      ) : null}
                      {def.source === "env" && def.envOn ? (
                        <div className="w-64 max-w-full text-left">
                          <CopyLine text={`${ENV_FILE} içine: ${def.envOn} · sonra yeniden yayın`} />
                        </div>
                      ) : null}
                      {!inline && !def.editHref && !(def.source === "env" && def.envOn) ? (
                        <span className="text-xs text-text-faint">Sunucu ortamında</span>
                      ) : null}
                    </div>
                  </TD>
                </TR>
              );
            })}
          </TBody>
        </Table>
      </TableFrame>
      {targetable.length ? (
        <section aria-labelledby="hedefleme" className="space-y-3">
          <div>
            <h2 id="hedefleme" className="font-display font-bold text-ink-950">Hedefleme (ofis, plan, yüzde, zaman)</h2>
            <p className="text-xs text-text-muted">
              Pilot yayın için: genel anahtar açıkken yalnız kurala uyan ofislerde açılır. Yüzde, bayrak ve ofis kimliğinden hesaplanır; aynı ofis hep aynı
              sonucu alır, yüzde büyütülünce açık ofisler açık kalır. Değişiklik en geç 30 saniyede tüm sunuculara yansır.
            </p>
          </div>
          <div className="grid gap-4 xl:grid-cols-2">
            {targetable.map(({ def, enabled, rule }) => (
              <FlagTargetingForm
                key={`${def.key}:${rule?.updatedAt ?? "yok"}`}
                flagKey={def.key}
                label={def.label}
                globalOn={enabled}
                planOptions={planOptions}
                canEdit={isSuper}
                init={
                  rule
                    ? {
                        tenants: rule.tenantIds.map((id) => ({ id, name: names.get(id) ?? "Silinmiş ofis" })),
                        plans: [...rule.plans],
                        percentage: rule.percentage,
                        startsLocal: rule.startsAt ? toTrLocalInput(rule.startsAt) : "",
                        endsLocal: rule.endsAt ? toTrLocalInput(rule.endsAt) : "",
                        note: rule.note ?? "",
                      }
                    : null
                }
              />
            ))}
          </div>
        </section>
      ) : null}
    </div>
  );
}
