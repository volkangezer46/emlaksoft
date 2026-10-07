import Link from "@/components/ui/smart-link";
import { Building2 } from "lucide-react";
import { PageHeader } from "@/components/ui/page-header";
import { parseTab, tabHref } from "@/lib/office-center/logic";
import { OFFICE_CENTER_PATH, OFFICE_CENTER_TABS } from "@/lib/office-center/types";
import { getEffectivePermissions } from "@/lib/permissions-effective";
import { requireModulePage } from "@/lib/require-module-page";
import { now } from "@/lib/clock";
import { createClient } from "@/lib/supabase/server";
import { AdvisorsTab } from "./_tabs/advisors-tab";
import { AssignmentsTab } from "./_tabs/assignments-tab";
import { DefinitionsTab } from "./_tabs/definitions-tab";
import { StatsTab } from "./_tabs/stats-tab";
import type { TabContext } from "./_tabs/context";

export const metadata = { title: "Ofis Merkezi" };

/** URL filtre kontratı: sekme + sekme içi filtreler (sunucu sorgusu aynı değerleri okur). */
type Sp = {
  sekme?: string;
  /** danışmanlar: aktif|pasif */
  durum?: string;
  q?: string;
  rol?: string;
  sube?: string;
  sirala?: string;
  yon?: string;
};

/**
 * Ofis Merkezi — ofis sahibi/yöneticinin tek ekranı: danışmanlar, atama özeti (atama İlan Havuzu'nda), tanımlar,
 * istatistikler. Sekme ve filtreler URL'dedir (?sekme=, ?durum=, ?q= ...): sunucu sorgusu aynı
 * değerleri okur. Yetki: sayfa kapısı office_center modülü + paket/modül kilidi (href ile); yazma eylemleri kendi kapılarından geçer.
 */
export default async function OfficeCenterPage({ searchParams }: { searchParams: Promise<Sp> }) {
  const { userId, role, tenantId, perms } = await requireModulePage("office_center", OFFICE_CENTER_PATH);
  // Etkin izinler URL'den bağımsız: searchParams ile aynı turda (eskiden ardışık).
  const effectiveP = tenantId ? getEffectivePermissions(tenantId, role, userId) : Promise.resolve(null);
  const sp = await searchParams;
  const effective = await effectiveP;
  const tab = parseTab(sp.sekme);

  if (!tenantId || !effective) {
    return (
      <div className="space-y-6">
        <PageHeader eyebrow="Ekip ve yetkiler" title="Ofis Merkezi" description="Ofis Merkezi yalnız ofis hesabıyla çalışır." />
      </div>
    );
  }

  const supabase = await createClient();
  const ctx: TabContext = {
    tenantId,
    userId,
    role,
    perms: effective,
    canEdit: (perms.office_center ?? []).includes("edit"),
    canCreate: (perms.office_center ?? []).includes("create"),
    canEditSettings: (perms.settings ?? []).includes("edit"),
    // Filtre kontratı: yalnız bilinen parametreler sekmelere geçer (sunucu sorgusu bunları okur).
    sp: { sekme: sp.sekme, durum: sp.durum, q: sp.q, rol: sp.rol, sube: sp.sube, sirala: sp.sirala, yon: sp.yon },
    nowMs: now(),
    supabase,
  };

  return (
    <div className="space-y-6">
      <PageHeader
        eyebrow="Ekip ve yetkiler"
        icon={<Building2 className="h-6 w-6 text-accent" aria-hidden="true" />}
        title="Ofis Merkezi"
        description="Danışmanları yönetin, atama durumunu izleyin, ofis tanımlarını tek yerden değiştirin."
        actions={
          <Link href="/app/ekip" className="focus-ring inline-flex items-center rounded-[var(--radius-control)] border border-line bg-surface px-3.5 py-2 text-sm font-semibold text-text transition hover:bg-surface-2">
            Ekip Merkezi
          </Link>
        }
      />

      <nav aria-label="Ofis Merkezi sekmeleri" className="flex flex-wrap gap-1 rounded-[var(--radius-card)] border border-line bg-canvas p-1">
        {OFFICE_CENTER_TABS.map((t) => (
          <Link
            key={t.id}
            href={tabHref(t.id)}
            aria-current={tab === t.id ? "page" : undefined}
            className={`focus-ring inline-flex min-h-10 items-center rounded-[var(--radius-control)] px-3.5 py-2 text-sm font-semibold transition ${tab === t.id ? "bg-surface text-ink-950 shadow-[var(--shadow-xs)]" : "text-text-muted hover:text-ink-950"}`}
          >
            {t.label}
          </Link>
        ))}
      </nav>

      {tab === "danismanlar" ? <AdvisorsTab ctx={ctx} /> : null}
      {tab === "atamalar" ? <AssignmentsTab ctx={ctx} /> : null}
      {tab === "tanimlar" ? <DefinitionsTab ctx={ctx} /> : null}
      {tab === "istatistikler" ? <StatsTab ctx={ctx} /> : null}
    </div>
  );
}
