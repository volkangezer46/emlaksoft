import type { SupabaseClient } from "@supabase/supabase-js";
import Link from "@/components/ui/smart-link";
import { AlertTriangle, ArrowUpRight, Building2, CalendarClock, Coins, Gauge, Wallet } from "lucide-react";
import { MorphNav } from "@/components/ui/morph-tab-parts";
import { KpiStrip, type KpiItem } from "@/components/ui/list-kit";
import { EmptyState } from "@/components/ui/empty-state";
import { Badge } from "@/components/ui/badge";
import { monthKeyOf } from "@/lib/building-management/period";
import { buildingFeeDescription, summarizeCharges } from "@/lib/building-management/charges";
import { DISTRIBUTION_LABELS } from "@/lib/building-management/distribution";
import { loadBuildingDetail, loadBuildingsOverview } from "@/lib/building-management/load";
import { loadLateFeeSettings } from "@/lib/property-management/load";
import { getProvinceOptions } from "@/lib/geo";
import { BuildingForm, UnitsPanel, type RentalOption } from "./bina-forms";
import { BatchForm, BatchList } from "./tahakkuk-panels";
import { CollectionPanel, type CollectionCharge } from "./tahsilat-panel";

const money = (n: number) => new Intl.NumberFormat("tr-TR", { style: "currency", currency: "TRY", maximumFractionDigits: 0 }).format(n);

const SECTIONS = [
  { id: "tahsilat", label: "Tahsilat" },
  { id: "tahakkuk", label: "Dönem tahakkuku" },
  { id: "gider", label: "Gider paylaştır" },
  { id: "daireler", label: "Daireler" },
] as const;
type SectionId = (typeof SECTIONS)[number]["id"];

export type BinalarPerms = { canCreate: boolean; canEdit: boolean; canDelete: boolean; canOffset: boolean };

/** "Binalar" sekmesi: bina listesi (?bina yok) ya da bina detayı (daireler, dönem tahakkuku, gider paylaştırma, tahsilat). */
export async function BinalarTab({
  db,
  tenantId,
  today,
  binaId,
  bolum,
  perms,
}: {
  db: SupabaseClient;
  tenantId: string;
  today: string;
  binaId: string;
  bolum: string;
  perms: BinalarPerms;
}) {
  if (!binaId) return <BuildingList db={db} tenantId={tenantId} today={today} perms={perms} />;

  const detail = await loadBuildingDetail(db, { tenantId, buildingId: binaId });
  if (!detail) {
    return (
      <EmptyState
        icon={Building2}
        title="Bina bulunamadı"
        description="Bina arşivlenmiş ya da bu ofise ait olmayabilir."
        action={<Link href="/app/aidat?sekme=binalar" className="text-sm font-semibold text-brand-600 hover:underline">Binalara dön</Link>}
      />
    );
  }
  const { building, units, batches, charges, payments } = detail;
  const section: SectionId = (SECTIONS.find((s) => s.id === bolum)?.id ?? (units.length === 0 ? "daireler" : "tahsilat")) as SectionId;
  const base = `/app/aidat?sekme=binalar&bina=${building.id}`;

  const summary = summarizeCharges(charges.map((c) => ({ amount: c.amount, paid: c.paid, dueDate: c.dueDate })), today);
  const feeIncome = payments.filter((p) => !p.voidedAt).reduce((s, p) => s + Math.round(p.managementFee * 100), 0) / 100;
  const kpis: KpiItem[] = [
    { label: "Toplam tahakkuk", value: money(summary.charged), icon: <Coins />, tone: "info", href: `${base}&bolum=tahakkuk`, hint: `${units.filter((u) => u.active).length} etkin daire` },
    { label: "Tahsil edilen", value: money(summary.paid), icon: <Wallet />, tone: "success", href: `${base}&bolum=tahsilat`, hint: `%${summary.collectionRate} tahsilat oranı` },
    { label: "Kalan borç", value: money(summary.outstanding), icon: <Gauge />, tone: "warning", href: `${base}&bolum=tahsilat`, hint: "ödenmemiş tutar" },
    { label: "Geciken", value: summary.overdueCount, icon: <AlertTriangle />, tone: "danger", attention: true, href: `${base}&bolum=tahsilat`, hint: summary.overdueCount > 0 ? money(summary.overdueAmount) : "vadesi geçen yok" },
  ];

  const [provinces, lateFee, rentalsRes] = await Promise.all([
    getProvinceOptions(),
    loadLateFeeSettings(db, tenantId),
    section === "daireler"
      ? db.from("rentals").select("id, property:properties!rentals_property_id_fkey(title, property_code), renter:customers!rentals_renter_customer_id_fkey(full_name)").eq("tenant_id", tenantId).eq("status", "active").limit(300)
      : Promise.resolve({ data: [] as unknown[], error: null }),
  ]);
  const one = <T,>(v: T | T[] | null | undefined): T | null => (Array.isArray(v) ? (v[0] ?? null) : (v ?? null));
  const rentalOptions: RentalOption[] = ((rentalsRes.data ?? []) as { id: string; property: { title: string | null; property_code: string } | { title: string | null; property_code: string }[] | null; renter: { full_name: string | null } | { full_name: string | null }[] | null }[]).map((r) => {
    const p = one(r.property);
    return { value: r.id, label: `${p?.title ?? p?.property_code ?? "Portföy"}${one(r.renter)?.full_name ? ` · ${one(r.renter)?.full_name}` : ""}` };
  });

  const unitById = new Map(units.map((u) => [u.id, u]));
  const collectionCharges: CollectionCharge[] = charges.flatMap((c) => {
    const u = unitById.get(c.unitId);
    if (!u) return [];
    return [{
      id: c.id, unitId: u.id, unitLabel: u.label, payerRole: c.payerRole,
      payerName: c.payerRole === "tenant" ? u.tenantName : u.ownerName,
      title: c.batchTitle, dueDate: c.dueDate, amount: c.amount, paid: c.paid,
      offsetPossible: Boolean(u.rentalId),
    }];
  });
  const chargeIds = new Set(charges.map((c) => c.id));

  const defaultMonth = monthKeyOf(today);
  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <Link href="/app/aidat?sekme=binalar" className="text-xs font-semibold text-brand-600 hover:underline">← Tüm binalar</Link>
          <h2 className="mt-1 flex items-center gap-2 font-display text-xl font-extrabold text-ink-950"><Building2 className="h-5 w-5 text-brand-600" /> {building.name}</h2>
          <p className="text-xs text-text-muted">
            {[building.address, building.district, building.city].filter(Boolean).join(", ") || "Adres girilmemiş"} · vade günü her ayın {building.dueDay}.
            {" "}
            {building.managedByOffice ? <>Ofis yönetiyor · ücret: {buildingFeeDescription(building.feeType, building.feeValue)}{feeIncome > 0 ? ` · bu binadan yönetim ücreti geliri ${money(feeIncome)}` : ""}</> : "Ofis yönetmiyor (yalnız takip)"}
          </p>
        </div>
        <BuildingForm building={building} canSave={perms.canEdit} canArchive={perms.canDelete} provinces={provinces} />
      </div>

      <KpiStrip items={kpis} label="Bina özeti" />

      <MorphNav
        variant="pill"
        label="Bina bölümleri"
        activeId={section}
        scroll={false}
        items={SECTIONS.map((s) => ({ id: s.id, href: `${base}&bolum=${s.id}`, label: s.label }))}
      />

      {section === "tahsilat" ? (
        <CollectionPanel
          charges={collectionCharges}
          payments={payments.filter((p) => chargeIds.has(p.chargeId))}
          today={today}
          lateFee={lateFee.settings}
          canEdit={perms.canEdit}
          canDelete={perms.canDelete}
          canOffset={perms.canOffset}
        />
      ) : null}

      {section === "tahakkuk" ? (
        <div className="space-y-4">
          <BatchForm mode="aidat" buildingId={building.id} units={units} defaultMethod={building.defaultDistribution} defaultMonth={defaultMonth} canCreate={perms.canCreate} />
          <BatchList batches={batches.filter((b) => b.kind === "aidat")} canDelete={perms.canDelete} />
        </div>
      ) : null}

      {section === "gider" ? (
        <div className="space-y-4">
          <BatchForm mode="expense_share" buildingId={building.id} units={units} defaultMethod={building.defaultDistribution === "fixed" ? "equal" : building.defaultDistribution} defaultMonth={defaultMonth} canCreate={perms.canCreate} />
          <BatchList batches={batches.filter((b) => b.kind === "expense_share")} canDelete={perms.canDelete} />
        </div>
      ) : null}

      {section === "daireler" ? (
        <UnitsPanel buildingId={building.id} units={units} rentals={rentalOptions} canCreate={perms.canCreate} canEdit={perms.canEdit} />
      ) : null}

      <p className="flex items-center gap-1.5 text-xs text-text-faint">
        <CalendarClock className="h-3.5 w-3.5" aria-hidden="true" /> Varsayılan dağıtım: {DISTRIBUTION_LABELS[building.defaultDistribution]}. Dosya çıktıları (tahakkuk/tahsilat, daire cari, gider paylaştırma dökümü) Raporlar sayfasındaki Rapor merkezindedir.
      </p>
    </div>
  );
}

async function BuildingList({ db, tenantId, today, perms }: { db: SupabaseClient; tenantId: string; today: string; perms: BinalarPerms }) {
  const overview = await loadBuildingsOverview(db, { tenantId, today });
  if (!overview.available) {
    return <EmptyState icon={Building2} title="Bina yönetimi şu an kullanılamıyor" description="Veritabanı güncellemesi henüz uygulanmamış olabilir; sistem yöneticinize bildirin." />;
  }
  const { buildings } = overview;
  return (
    <div className="space-y-5">
      {buildings.length === 0 ? (
        <EmptyState
          icon={Building2}
          title="Henüz bina eklenmedi"
          description="Bir apartmanı ya da siteyi komple yönetiyorsanız önce binayı ve dairelerini ekleyin; sonra dönem aidatını tek tıkla tüm dairelere tahakkuk ettirip tahsilatı takip edin."
        />
      ) : (
        <ul className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3" aria-label="Binalar">
          {buildings.map((b) => (
            <li key={b.id}>
              <Link href={`/app/aidat?sekme=binalar&bina=${b.id}`} className="focus-ring press lift group block h-full rounded-[var(--radius-card)] border border-line bg-surface p-4 shadow-[var(--shadow-xs)] transition hover:border-brand-300">
                <div className="flex items-start justify-between gap-2">
                  <p className="font-display font-bold text-ink-950">{b.name}</p>
                  <ArrowUpRight className="h-4 w-4 shrink-0 text-text-faint transition group-hover:text-brand-600" aria-hidden="true" />
                </div>
                <p className="mt-0.5 truncate text-xs text-text-muted">{[b.district, b.city].filter(Boolean).join(", ") || "—"} · {b.unitCount} daire</p>
                <div className="mt-3 flex flex-wrap items-center gap-2">
                  <Badge variant={b.managedByOffice ? "info" : "outline"} size="sm">{b.managedByOffice ? `Yönetiyoruz · ${buildingFeeDescription(b.feeType, b.feeValue)}` : "Yalnız takip"}</Badge>
                  {b.overdueCount > 0 ? <Badge variant="danger" size="sm">{b.overdueCount} geciken · {money(b.overdueAmount)}</Badge> : null}
                </div>
                <p className="mt-3 text-xs text-text-muted">Toplam borç <span className="numeric font-bold text-ink-950">{money(b.outstanding)}</span></p>
              </Link>
            </li>
          ))}
        </ul>
      )}
      <BuildingForm canSave={perms.canCreate} provinces={await getProvinceOptions()} />
    </div>
  );
}
