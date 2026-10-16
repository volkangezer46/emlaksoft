import { Settings2 } from "lucide-react";
import { AdminPageHeader } from "@/components/admin/admin-page-header";
import { Alert } from "@/components/ui/alert";
import { FilterChip } from "@/components/ui/filter-chip";
import { RegistrySettings } from "@/components/settings/registry-settings";
import { requirePlatformModule } from "@/lib/platform";
import { PLATFORM_ROLE_LABELS, type PlatformRole } from "@/lib/platform-access";
import { SUPPORT_SETTING_KEYS } from "@/lib/settings/registry/support";
import { KVKK_SETTING_KEYS } from "@/lib/settings/registry/kvkk";
import { addBusinessMinutes } from "@/lib/support/business-hours";
import { loadDeskConfig } from "@/lib/support/desk-data";
import { resolveSlaTarget, SLA_PLAN_LABEL, SLA_PRIORITY_LABEL } from "@/lib/support/sla-policy";
import { TICKET_CATEGORIES_FALLBACK } from "@/lib/support/ticket-contract";
import { createAdminClient } from "@/lib/supabase/admin";
import { AssignmentRules, BusinessHoursForm, HolidayList, SlaMatrixForm, StaffAvailabilityList } from "./desk-settings-forms";

export const metadata = { title: "Destek ayarları" };

const TABS = [
  { id: "sla", label: "SLA ve iş saatleri" },
  { id: "atama", label: "Atama" },
  { id: "otomasyon", label: "Otomasyon" },
  { id: "kvkk", label: "KVKK" },
] as const;
type TabId = (typeof TABS)[number]["id"];

const CATEGORY_FALLBACK_LABEL: Record<string, string> = {
  general: "Genel",
  billing: "Abonelik / fatura",
  bug: "Hata bildirimi",
  feature: "Özellik isteği",
  compliance: "İYS / KVKK",
  onboarding: "Kurulum",
};

function Section({ title, description, children }: { title: string; description?: string; children: React.ReactNode }) {
  return (
    <section className="space-y-3 rounded-[var(--radius-panel)] border border-line bg-surface p-4 sm:p-5">
      <div>
        <h2 className="font-display text-sm font-bold text-ink-950">{title}</h2>
        {description ? <p className="mt-0.5 text-xs text-text-muted">{description}</p> : null}
      </div>
      {children}
    </section>
  );
}

/**
 * Destek ayarları (AD9): SLA matrisi (öncelik × plan, iş saati) + iş saatleri/tatil, otomatik atama kuralları ve
 * personel izinleri, yanıt bekleyen bilet otomasyonu + yanıt e-postası (ayar defteri). Yeni menü satırı değil:
 * destek sekme şeridinden açılır. Yazma: süper admin ve operasyon (personel kendi izin durumunu değiştirebilir).
 */
export default async function SupportSettingsPage({ searchParams }: { searchParams?: Promise<{ sekme?: string }> }) {
  const staff = await requirePlatformModule("tickets");
  const requested = ((await searchParams) ?? {}).sekme ?? "";
  const tab: TabId = TABS.find((t) => t.id === requested)?.id ?? "sla";
  const canEdit = staff.role === "super_admin" || staff.role === "ops";
  const [config, categoryResult] = await Promise.all([
    loadDeskConfig(),
    createAdminClient().from("definitions").select("value, label").eq("category", "ticket_category").is("tenant_id", null).eq("is_active", true).order("sort_order"),
  ]);

  const categories = (categoryResult.data?.length ? categoryResult.data : TICKET_CATEGORIES_FALLBACK.map((value) => ({ value, label: CATEGORY_FALLBACK_LABEL[value] ?? value }))) as {
    value: string;
    label: string;
  }[];
  const staffName = new Map(config.staff.map((s) => [s.id, s.full_name]));
  const roleOptions = (["support", "billing", "ops", "super_admin"] as PlatformRole[]).map((r) => ({ value: r, label: PLATFORM_ROLE_LABELS[r] }));
  const staffOptions = config.staff.filter((s) => s.is_active).map((s) => ({ value: s.id, label: `${s.full_name} · ${PLATFORM_ROLE_LABELS[s.role as PlatformRole] ?? s.role}` }));

  // Önizleme: cuma 17:30'da açılan Profesyonel plan + yüksek öncelikli talebin ilk yanıt hedefi (kayıtlı ayarla).
  const sample = resolveSlaTarget(config.policies, "professional", "high");
  const sampleDue = addBusinessMinutes(new Date("2026-10-16T14:30:00Z"), sample.firstResponseMinutes, {
    days: config.days,
    holidays: config.holidays.map((h) => h.day),
  });
  const sampleText = new Intl.DateTimeFormat("tr-TR", { weekday: "long", hour: "2-digit", minute: "2-digit", timeZone: "Europe/Istanbul" }).format(sampleDue);

  return (
    <div className="space-y-4">
      <AdminPageHeader
        art="gear"
        eyebrow="Destek"
        icon={Settings2}
        title="Destek ayarları"
        description="SLA hedefleri iş saatine göre işler; atama kuralları yeni talebi uygun kişiye sırayla dağıtır; otomasyon yanıt bekleyen talepleri hatırlatır ve kapatır."
      />
      <nav aria-label="Destek ayar bölümleri" className="flex flex-wrap gap-1">
        {TABS.map((t) => (
          <FilterChip key={t.id} href={t.id === "sla" ? "/admin/tickets/ayarlar" : `/admin/tickets/ayarlar?sekme=${t.id}`} active={tab === t.id}>
            {t.label}
          </FilterChip>
        ))}
      </nav>

      {!config.installed && (tab === "sla" || tab === "atama") ? (
        <Alert tone="warning" title="Kurulum bekliyor">
          Destek masası tabloları henüz veritabanında yok (migration 20261013004800). Bu sürede SLA sabit takvim saatleriyle işler ve otomatik atama yapılmaz.
        </Alert>
      ) : null}

      {tab === "sla" ? (
        <>
          <Section
            title="SLA hedefleri (öncelik × plan)"
            description={`Süreler iş saati cinsindendir. Örnek: cuma 17:30'da açılan ${SLA_PLAN_LABEL.professional} plan, ${SLA_PRIORITY_LABEL.high.toLocaleLowerCase("tr-TR")} öncelikli talebin ilk yanıt hedefi ${sampleText}. Değişiklik yeni taleplere ve öncelik değişikliklerine uygulanır.`}
          >
            <SlaMatrixForm policies={config.policies} canEdit={canEdit && config.installed} />
          </Section>
          <div className="grid gap-4 xl:grid-cols-2">
            <Section title="İş saatleri" description="Europe/Istanbul saatiyle. Kapalı günler ve saat dışı SLA süresinden sayılmaz.">
              <BusinessHoursForm days={config.days} canEdit={canEdit && config.installed} />
            </Section>
            <Section title="Tatil takvimi" description="Resmî ve dini bayramlar; bu günler çalışılmayan gün sayılır. Dini bayramları her yıl ekleyin.">
              <HolidayList holidays={config.holidays} canEdit={canEdit && config.installed} />
            </Section>
          </div>
        </>
      ) : null}

      {tab === "atama" ? (
        <>
          <Section
            title="Otomatik atama kuralları"
            description="Yeni talep, kategorisine uyan ilk etkin kurala göre adaylar arasında sırayla (round robin) dağıtılır. Uygun aday yoksa sıradaki kurala, o da yoksa kuyruğa düşer. 'Tüm kategoriler' kuralı yedektir."
          >
            <AssignmentRules
              rules={config.rules.map((r) => ({
                id: r.id,
                category: r.category,
                target_role: r.target_role,
                target_staff_ids: r.target_staff_ids,
                is_active: r.is_active,
                sort_order: r.sort_order,
                assigned_count: r.assigned_count,
                last_assigned_name: r.last_assigned_staff_id ? staffName.get(r.last_assigned_staff_id) ?? null : null,
              }))}
              categories={categories}
              roles={roleOptions}
              staff={staffOptions}
              canEdit={canEdit && config.installed}
            />
          </Section>
          <Section title="Personel izin durumu" description="İzinli veya pasif personel otomatik atamada atlanır. Dönüş tarihi verilirse o gün yeniden atanmaya başlar.">
            <StaffAvailabilityList
              viewerId={staff.id}
              canEditAll={canEdit && config.installed}
              rows={config.staff.map((s) => {
                const a = config.availability.find((x) => x.staff_id === s.id);
                return {
                  id: s.id,
                  name: s.full_name,
                  roleLabel: PLATFORM_ROLE_LABELS[s.role as PlatformRole] ?? s.role,
                  isAway: Boolean(a?.is_away),
                  awayUntil: a?.away_until
                    ? new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/Istanbul" }).format(new Date(a.away_until))
                    : null,
                  note: a?.note ?? null,
                  active: s.is_active && config.installed,
                };
              })}
            />
          </Section>
        </>
      ) : null}

      {tab === "otomasyon" ? (
        <RegistrySettings
          id="otomasyon"
          title="Otomasyon ve e-posta"
          description="Otomatik atama ana anahtarı, yanıt bekleyen talep hatırlatma/kapanış eşikleri ve destek yanıtının e-postayla gönderimi. Değişiklikler gerekçeli geçmişe yazılır."
          keys={SUPPORT_SETTING_KEYS}
          canEdit={canEdit}
        />
      ) : null}

      {tab === "kvkk" ? (
        <RegistrySettings
          id="kvkk"
          title="KVKK başvuruları"
          description="Herkese açık başvuru formu (/kvkk-basvuru). Yasal yanıt süresi 30 gündür ve ayar değildir; süre uyarısının eşiği Sistem > Uyarılar > KVKK başvuru süresi kuralındadır."
          keys={Object.values(KVKK_SETTING_KEYS)}
          canEdit={canEdit}
        />
      ) : null}
    </div>
  );
}
