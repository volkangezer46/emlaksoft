import Link from "next/link";
import { Building2, Phone, UserCheck, UserMinus, Users, X } from "lucide-react";
import { createAdminClient } from "@/lib/supabase/admin";
import { requirePlatformModule } from "@/lib/platform";
import { formatTurkishPhone } from "@/lib/phone";
import { orIlike } from "@/lib/pgrst";
import { exportMembersCsv } from "@/app/actions/platform-export";
import { ExportButton } from "@/components/admin/export-button";
import { AdminPageHeader } from "@/components/admin/admin-page-header";
import { AdminStatCard, AdminStatGrid } from "@/components/admin/admin-stat-card";
import { AdminFilterChip, AdminSearchForm } from "@/components/admin/admin-table";
import { DataTable, ROW_HREF, type DataTableColumn, type DataTableRow } from "@/components/ui/data-table";
import { Pagination, pageRange, parsePage } from "@/app/admin/_components/pagination";

const roleLabel: Record<string, string> = {
  owner: "Ofis sahibi",
  gm: "Genel müdür",
  branch_manager: "Şube müdürü",
  team_lead: "Takım lideri",
  advisor: "Danışman",
  call_center: "Çağrı merkezi",
  accounting: "Muhasebe",
  readonly: "Salt okunur",
};

/** Rol etiketleri rozet haritasına türetiliyor — tek kaynak `roleLabel`. */
const ROLE_BADGES: DataTableColumn["badges"] = Object.fromEntries(
  Object.entries(roleLabel).map(([k, label]) => [k, { label, variant: "info" as const }]),
);

const MEMBER_COLUMNS: DataTableColumn[] = [
  { key: "full_name", header: "Kullanıcı", sortable: true, subtitleKey: "phone" },
  { key: "tenantName", header: "Ofis", sortable: true },
  { key: "role", header: "Rol", format: "badge", badges: ROLE_BADGES, sortable: true },
  {
    key: "status",
    header: "Durum",
    format: "badge",
    sortable: true,
    badges: {
      active: { label: "Aktif", variant: "success" },
      passive: { label: "Pasif", variant: "outline" },
    },
  },
  { key: "created_at", header: "Kayıt", format: "date", align: "right", sortable: true },
];

function buildMembersHref(p: { tenant?: string; q?: string; durum?: string; sayfa?: number }) {
  const sp = new URLSearchParams();
  if (p.tenant) sp.set("tenant", p.tenant);
  if (p.q) sp.set("q", p.q);
  if (p.durum) sp.set("durum", p.durum);
  if (p.sayfa && p.sayfa > 1) sp.set("sayfa", String(p.sayfa));
  const s = sp.toString();
  return s ? `/admin/members?${s}` : "/admin/members";
}

type Rel = { name?: string } | { name?: string }[] | null;

function tenantName(value: Rel) {
  if (!value) return "—";
  return Array.isArray(value) ? (value[0]?.name ?? "—") : (value.name ?? "—");
}

export default async function AdminMembersPage({
  searchParams,
}: {
  searchParams?: Promise<{ tenant?: string; q?: string; durum?: string; sayfa?: string }>;
}) {
  await requirePlatformModule("members");
  const sp = (await searchParams) ?? {};
  const tenantFilter = (sp.tenant ?? "").trim() || undefined;
  const query = (sp.q ?? "").trim();
  const durum = sp.durum === "aktif" || sp.durum === "pasif" ? sp.durum : undefined;
  const page = parsePage(sp.sayfa);
  const filtered = Boolean(tenantFilter || query || durum);

  const admin = createAdminClient();

  let memberQuery = admin
    .from("profiles")
    .select("id, full_name, phone, role, is_active, created_at, tenant_id, tenant:tenants(name)", { count: "exact" })
    .order("created_at", { ascending: false })
    .range(...pageRange(page));
  if (tenantFilter) memberQuery = memberQuery.eq("tenant_id", tenantFilter);
  // Ad + telefon birlikte taranır: destek ekibi çoğu zaman elinde numarayla gelir.
  if (query) memberQuery = memberQuery.or(orIlike(["full_name", "phone"], query));
  if (durum) memberQuery = memberQuery.eq("is_active", durum === "aktif");

  // Özet kartlar filtreden bağımsız — tüm platformun üye tablosunu anlatır.
  const [{ data, count: memberTotal }, filterTenantRes, { count: allMembers }, { count: activeMembers }, { count: officeCount }] =
    await Promise.all([
      memberQuery,
      tenantFilter
        ? admin.from("tenants").select("id, name").eq("id", tenantFilter).maybeSingle()
        : Promise.resolve({ data: null as { id: string; name: string } | null }),
      admin.from("profiles").select("id", { count: "exact", head: true }),
      admin.from("profiles").select("id", { count: "exact", head: true }).eq("is_active", true),
      admin.from("tenants").select("id", { count: "exact", head: true }),
    ]);

  const rows = data ?? [];
  const filterTenant = filterTenantRes.data;
  const totalMembers = allMembers ?? 0;
  const active = activeMembers ?? 0;

  const memberRows: DataTableRow[] = rows.map((m) => ({
    id:         m.id,
    full_name:  m.full_name,
    phone:      m.phone ? formatTurkishPhone(m.phone) : null,
    tenantName: tenantName(m.tenant as Rel),
    role:       m.role,
    status:     m.is_active ? "active" : "passive",
    created_at: m.created_at,
    [ROW_HREF]: m.tenant_id ? `/admin/tenants/${m.tenant_id}` : null,
  }));

  // Telefon + ofis linki: DataTable satır overlay'inin ÜSTÜNDE kalan aksiyonlar
  const rowActions = Object.fromEntries(
    rows.map((m): [string, React.ReactNode] => [
      m.id,
      <>
        {m.phone ? (
          <a
            href={`tel:${m.phone}`}
            className="focus-ring press inline-flex items-center gap-1 rounded-[8px] border border-hairline bg-surface px-2.5 py-1.5 text-xs font-semibold text-ink-950 shadow-[var(--elev-1)] transition hover:bg-canvas"
          >
            <Phone className="h-3 w-3" /> Ara
          </a>
        ) : null}
        {m.tenant_id ? (
          <Link
            href={`/admin/tenants/${m.tenant_id}`}
            className="focus-ring press inline-flex items-center gap-1.5 rounded-[8px] border border-hairline bg-surface px-3 py-1.5 text-xs font-semibold text-brand-700 shadow-[var(--elev-1)] transition hover:bg-brand-600/5"
          >
            Ofis
          </Link>
        ) : null}
        <Link
          href={`/admin/members/${m.id}`}
          className="focus-ring press relative z-10 inline-flex items-center gap-1.5 rounded-[8px] border border-hairline bg-surface px-3 py-1.5 text-xs font-semibold text-brand-700 shadow-[var(--elev-1)] transition hover:bg-brand-600/5"
        >
          Detay
        </Link>
      </>,
    ]),
  );

  return (
    <div className="space-y-6">
      <AdminPageHeader
        eyebrow="Üye envanteri"
        icon={Users}
        title="Tüm platform kullanıcıları"
        description={
          filtered
            ? `${memberTotal ?? rows.length} sonuç · toplam ${totalMembers} profil içinde filtreleniyor`
            : `${totalMembers} profil · ofis bazlı görünüm`
        }
        actions={<ExportButton action={exportMembersCsv} label="Excel'e aktar" />}
      >
        <AdminStatGrid className="mt-6">
          <AdminStatCard
            tone="dark"
            label="Toplam kullanıcı"
            value={totalMembers || null}
            href={totalMembers ? "/admin/members" : undefined}
            icon={Users}
            accent="text-amber-300"
            emptyHint="Henüz kullanıcı yok"
          />
          <AdminStatCard
            tone="dark"
            label="Aktif"
            value={totalMembers ? active : null}
            href={totalMembers ? buildMembersHref({ tenant: tenantFilter, q: query, durum: durum === "aktif" ? undefined : "aktif" }) : undefined}
            icon={UserCheck}
            accent="text-mint-400"
            hint={durum === "aktif" ? "filtre aktif · kaldırmak için tıkla" : undefined}
            emptyHint="Henüz kullanıcı yok"
          />
          <AdminStatCard
            tone="dark"
            label="Pasif"
            value={totalMembers ? totalMembers - active : null}
            href={totalMembers ? buildMembersHref({ tenant: tenantFilter, q: query, durum: durum === "pasif" ? undefined : "pasif" }) : undefined}
            icon={UserMinus}
            accent="text-danger-300"
            hint={durum === "pasif" ? "filtre aktif · kaldırmak için tıkla" : undefined}
            emptyHint="Henüz kullanıcı yok"
          />
          <AdminStatCard
            tone="dark"
            label="Ofis"
            value={officeCount ?? null}
            href={officeCount ? "/admin/tenants" : undefined}
            icon={Building2}
            accent="text-brand-300"
            hint={officeCount ? `ofis başına ~${Math.round(totalMembers / officeCount)} kullanıcı` : undefined}
            emptyHint="Henüz ofis yok"
          />
        </AdminStatGrid>
      </AdminPageHeader>

      <div className="flex flex-wrap items-center gap-3 rounded-[16px] border border-line bg-surface p-3">
        <AdminSearchForm
          action="/admin/members"
          defaultValue={query}
          placeholder="Ad soyad veya telefon ara…"
          hidden={{ tenant: tenantFilter, durum }}
        />
        {query ? (
          <AdminFilterChip href={buildMembersHref({ tenant: tenantFilter, durum })}>
            Arama: {query} <X className="h-3 w-3" />
          </AdminFilterChip>
        ) : null}
        {durum ? (
          <AdminFilterChip href={buildMembersHref({ tenant: tenantFilter, q: query })}>
            Durum: {durum === "aktif" ? "Aktif" : "Pasif"} <X className="h-3 w-3" />
          </AdminFilterChip>
        ) : null}
        {filterTenant ? (
          <AdminFilterChip href={buildMembersHref({ q: query, durum })}>
            Ofis: {filterTenant.name} <X className="h-3 w-3" />
          </AdminFilterChip>
        ) : null}
        <p className="ml-auto text-[11px] text-text-faint">
          Arama sunucuda çalışır ve tüm sayfaları tarar; tablodaki arama yalnız açık sayfayı süzer.
        </p>
      </div>

      <DataTable
        columns={MEMBER_COLUMNS}
        rows={memberRows}
        rowActions={rowActions}
        minWidth={760}
        searchPlaceholder="Bu sayfada süz (ofis, rol)…"
        empty={{
          description: filtered
            ? "Filtreyle eşleşen kullanıcı yok — arama terimini değiştirin ya da filtreleri temizleyin."
            : "Henüz kullanıcı kaydı yok. Ofisler üye davet ettiğinde burada görünür.",
        }}
      />

      <Pagination
        page={page}
        total={memberTotal ?? 0}
        hrefFor={(p) => buildMembersHref({ tenant: tenantFilter, q: query, durum, sayfa: p })}
      />
    </div>
  );
}
