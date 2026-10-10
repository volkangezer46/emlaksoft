import { StaffNoTenantNotice } from "@/components/app/staff-no-tenant-notice";
import Link from "@/components/ui/smart-link";
import { ArrowLeft, ArrowUpRight, Search, SlidersHorizontal } from "lucide-react";
import { ReadOnlyGate } from "../read-only-gate";
import { SettingField } from "@/components/settings/setting-field";
import { PageHeader } from "@/components/ui/page-header";
import { StatRow } from "@/components/ui/stat-row";
import {
  officeSettingHistoryAction,
  resetOfficeSettingAction,
  revertOfficeSettingAction,
  saveOfficeSettingAction,
} from "@/app/actions/office-settings";
import { requireModulePage } from "@/lib/require-module-page";
import { getTenantSettingViews } from "@/lib/settings/read";
import { OFFICE_SETTING_GROUPS, type OfficeSettingGroupId, type SettingView } from "@/lib/settings/types";

export const metadata = { title: "Tanımlar merkezi" };

type Sp = Record<string, string | string[] | undefined>;
const first = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v) ?? "";
const norm = (s: string) => s.toLocaleLowerCase("tr-TR");

const PATH = "/app/ayarlar/merkez";

/** Ayarın etkisini gösterdiği ekran (sıfır çıkmaz: her ayarın gerçek bir hedefi var). */
const USED_IN: Record<string, { label: string; href: string }> = {
  "office.sla.lead_first_response_min": { label: "Aday hızı raporu", href: "/app/raporlar/lead-hizi" },
  "office.alert.deal_stale_days": { label: "Hareketsiz anlaşmalar", href: "/app/anlasmalar?gorunum=liste&bayat=1" },
  "office.alert.demand_aging_days": { label: "Bekleyen talepler", href: "/app/talepler" },
  "office.commission.simulator_rate": { label: "Komisyon hesaplayıcı", href: "/app/komisyon" },
  "office.commission.simulator_advisor_share": { label: "Komisyon hesaplayıcı", href: "/app/komisyon" },
  "office.commission.split_advisor_share": { label: "Anlaşmalar (kapanış bölüşümü)", href: "/app/anlasmalar?gorunum=liste&asama=won" },
  "office.commission.default_rate": { label: "İlan uyarıları (kaçan komisyon tahmini)", href: "/app/ilan-kontrol/anomaliler?tur=potential_lost_deal" },
  "office.insight.customer_quiet_days": { label: "Ana ekran içgörüleri", href: "/app" },
  "office.insight.listing_stale_days": { label: "Ana ekran içgörüleri", href: "/app" },
  "office.insight.dormant_days": { label: "Uykuda müşteriler", href: "/app/musteriler?segment=uykuda" },
  "office.listing_control.report_daily": { label: "İlan Kontrol raporu", href: "/app/ilan-kontrol/rapor" },
  "office.listing_control.report_weekly": { label: "İlan Kontrol raporu", href: "/app/ilan-kontrol/rapor" },
  "office.assign.weight_workload": { label: "İlan Havuzu > Danışmansız ilanlar", href: "/app/ilan-havuzu?atama=bekleyen" },
  "office.assign.weight_specialty": { label: "İlan Havuzu > Danışmansız ilanlar", href: "/app/ilan-havuzu?atama=bekleyen" },
  "office.assign.weight_region": { label: "İlan Havuzu > Danışmansız ilanlar", href: "/app/ilan-havuzu?atama=bekleyen" },
  "office.assign.weight_performance": { label: "İlan Havuzu > Danışmansız ilanlar", href: "/app/ilan-havuzu?atama=bekleyen" },
  "office.assign.weight_availability": { label: "İlan Havuzu > Danışmansız ilanlar", href: "/app/ilan-havuzu?atama=bekleyen" },
  "office.assign.unassigned_sla_hours": { label: "İlan Havuzu > SLA'sı geçen", href: "/app/ilan-havuzu?atama=gecikmis" },
  "office.alert.unassigned_pool_count": { label: "Ofis Merkezi > İstatistikler", href: "/app/ekip?sekme=istatistikler" },
};
const NOTIFY_USED_IN = { label: "Bildirim tercihleri", href: "/app/ayarlar" };

const ACTIONS = {
  save: saveOfficeSettingAction,
  reset: resetOfficeSettingAction,
  revert: revertOfficeSettingAction,
  history: officeSettingHistoryAction,
};

/**
 * Ofis Tanımları Merkezi: ofise özel eşik, SLA, komisyon ve bildirim varsayılanları (Ayar Kayıt Defteri, kapsam=ofis).
 * Her değişiklik doğrulanır, geçmişe yazılır ve geri alınabilir; varsayılana dönülebilir. Düzenleme `settings:edit` ister.
 */
export default async function OfficeSettingsCenterPage({ searchParams }: { searchParams: Promise<Sp> }) {
  const { tenantId, perms } = await requireModulePage("settings");
  if (!tenantId) return <StaffNoTenantNotice feature="Ofis tanımları" />;
  const canEdit = (perms.settings ?? []).includes("edit");
  const sp = await searchParams;
  const q = first(sp.ara).trim();
  const grupParam = first(sp.grup);
  const grup = OFFICE_SETTING_GROUPS.find((g) => g.id === grupParam)?.id as OfficeSettingGroupId | undefined;
  const onlyChanged = first(sp.durum) === "degisen";

  const views = await getTenantSettingViews(tenantId);
  const changedCount = views.filter((v) => !v.isDefault).length;
  const needle = norm(q);
  const shown = views.filter(
    (v) =>
      (!grup || v.group === grup) &&
      (!onlyChanged || !v.isDefault) &&
      (!needle || norm(v.label).includes(needle) || norm(v.description).includes(needle) || norm(v.key).includes(needle)),
  );
  const groups = OFFICE_SETTING_GROUPS.map((g) => ({ ...g, items: shown.filter((v) => v.group === g.id) })).filter((g) => g.items.length > 0);

  const href = (patch: { grup?: string; durum?: string }) => {
    const p = new URLSearchParams();
    const g = patch.grup ?? "";
    const d = patch.durum ?? "";
    if (g) p.set("grup", g);
    if (d) p.set("durum", d);
    if (q) p.set("ara", q);
    const s = p.toString();
    return `${PATH}${s ? `?${s}` : ""}`;
  };

  return (
    <div className="space-y-6">
      <Link href="/app/ayarlar" className="inline-flex items-center gap-1.5 text-sm font-semibold text-text-muted transition hover:text-brand-600">
        <ArrowLeft className="h-4 w-4" /> Ayarlar
      </Link>

      <PageHeader
        eyebrow="Ayarlar"
        icon={<SlidersHorizontal className="h-6 w-6 text-accent" aria-hidden="true" />}
        title="Tanımlar merkezi"
        description="Ofisinize özel SLA süreleri, uyarı eşikleri, komisyon ve bildirim varsayılanları. Değişiklikler doğrulanır, geçmişe yazılır ve istediğiniz an varsayılana döndürülebilir."
      />

      <StatRow
        label="Tanım özeti"
        items={[
          { label: "Toplam tanım", value: views.length, href: PATH },
          { label: "Varsayılandan farklı", value: changedCount, href: href({ durum: "degisen" }), hint: "ofisinize özel", attention: changedCount > 0 },
          ...OFFICE_SETTING_GROUPS.map((g) => ({
            label: g.label,
            value: views.filter((v) => v.group === g.id).length,
            href: href({ grup: g.id }),
          })),
        ]}
      />

      <form action={PATH} className="flex max-w-xl items-center gap-2">
        <label className="relative flex-1">
          <span className="sr-only">Tanım ara</span>
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-text-faint" />
          <input
            name="ara"
            defaultValue={q}
            placeholder="Tanım ara (ör. hareketsiz, SLA, komisyon)"
            className="w-full rounded-[var(--radius-control)] border border-line bg-canvas py-2.5 pl-9 pr-3 text-sm outline-none focus:border-brand-400 focus:bg-surface"
          />
        </label>
        {grup ? <input type="hidden" name="grup" value={grup} /> : null}
        {onlyChanged ? <input type="hidden" name="durum" value="degisen" /> : null}
        <button type="submit" className="focus-ring press rounded-[var(--radius-control)] bg-ink-950 px-4 py-2.5 text-xs font-semibold text-white">
          Ara
        </button>
      </form>

      <nav aria-label="Tanım grupları" className="flex flex-wrap gap-2">
        <Link
          href={href({})}
          aria-current={!grup && !onlyChanged ? "page" : undefined}
          className={`focus-ring rounded-full border px-3 py-1 text-xs font-semibold ${!grup && !onlyChanged ? "border-ink-950 bg-ink-950 text-white" : "border-line bg-surface text-ink-950 hover:bg-canvas"}`}
        >
          Tümü ({views.length})
        </Link>
        {OFFICE_SETTING_GROUPS.map((g) => (
          <Link
            key={g.id}
            href={href({ grup: g.id })}
            aria-current={grup === g.id ? "page" : undefined}
            className={`focus-ring rounded-full border px-3 py-1 text-xs font-semibold ${grup === g.id ? "border-ink-950 bg-ink-950 text-white" : "border-line bg-surface text-ink-950 hover:bg-canvas"}`}
          >
            {g.label} ({views.filter((v) => v.group === g.id).length})
          </Link>
        ))}
        {onlyChanged ? (
          <Link href={href({ grup })} className="focus-ring rounded-full border border-amber-400/50 bg-amber-400/15 px-3 py-1 text-xs font-semibold text-amber-800">
            Yalnız değişenler ({changedCount}) · kaldır
          </Link>
        ) : null}
      </nav>

      <ReadOnlyGate canEdit={canEdit}>
        {groups.length === 0 ? (
          <p className="rounded-[var(--radius-card)] border border-dashed border-line px-4 py-10 text-center text-sm text-text-muted">
            {q ? `“${q}” için tanım bulunamadı.` : onlyChanged ? "Varsayılandan farklı tanım yok; her şey standart değerlerde." : "Bu grupta tanım yok."}{" "}
            <Link href={PATH} className="font-semibold text-brand-600 hover:underline">
              Tüm tanımlar
            </Link>
          </p>
        ) : (
          groups.map((g) => (
            <section key={g.id} aria-labelledby={`grup-${g.id}`} className="mb-6 space-y-3">
              <div>
                <h2 id={`grup-${g.id}`} className="text-base font-semibold text-ink-950">
                  {g.label}
                </h2>
                <p className="text-xs text-text-muted">{g.description}</p>
              </div>
              <div className="grid gap-3">
                {g.items.map((v: SettingView) => {
                  const used = USED_IN[v.key] ?? (v.group === "bildirim" ? NOTIFY_USED_IN : null);
                  return (
                    <div key={v.key} className="space-y-1">
                      <SettingField view={v} canEdit={canEdit} actions={ACTIONS} readOnlyNote="Bu tanımı değiştirmek için ayar düzenleme yetkisi gerekir." />
                      {used ? (
                        <p className="px-1 text-xs text-text-faint">
                          Etkilediği ekran:{" "}
                          <Link href={used.href} className="inline-flex items-center gap-0.5 font-semibold text-brand-600 hover:underline">
                            {used.label} <ArrowUpRight className="h-3 w-3" aria-hidden="true" />
                          </Link>
                        </p>
                      ) : null}
                    </div>
                  );
                })}
              </div>
            </section>
          ))
        )}
      </ReadOnlyGate>
    </div>
  );
}
