import Link from "next/link";
import { Phone, Users, X } from "lucide-react";
import { createAdminClient } from "@/lib/supabase/admin";
import { requirePlatformModule } from "@/lib/platform";
import { formatTurkishPhone } from "@/lib/phone";
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

function buildMembersHref(p: { tenant?: string; q?: string; sayfa?: number }) {
  const sp = new URLSearchParams();
  if (p.tenant) sp.set("tenant", p.tenant);
  if (p.q) sp.set("q", p.q);
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
  searchParams?: Promise<{ tenant?: string; q?: string; sayfa?: string }>;
}) {
  await requirePlatformModule("members");
  const sp = (await searchParams) ?? {};
  const tenantFilter = (sp.tenant ?? "").trim() || undefined;
  const query = (sp.q ?? "").trim();
  const page = parsePage(sp.sayfa);

  const admin = createAdminClient();

  let memberQuery = admin
    .from("profiles")
    .select("id, full_name, phone, role, is_active, created_at, tenant_id, tenant:tenants(name)", { count: "exact" })
    .order("created_at", { ascending: false })
    .range(...pageRange(page));
  if (tenantFilter) memberQuery = memberQuery.eq("tenant_id", tenantFilter);
  if (query) memberQuery = memberQuery.ilike("full_name", `%${query}%`);

  const [{ data, count: memberTotal }, filterTenantRes] = await Promise.all([
    memberQuery,
    tenantFilter
      ? admin.from("tenants").select("id, name").eq("id", tenantFilter).maybeSingle()
      : Promise.resolve({ data: null as { id: string; name: string } | null }),
  ]);

  const rows = data ?? [];
  const filterTenant = filterTenantRes.data;

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
      <section className="theme-dark relative overflow-hidden rounded-[22px] bg-[image:var(--grad-ink)] p-6 text-white">
        <div className="pointer-events-none absolute inset-0 grid-overlay-dark opacity-35" />
        <div className="relative">
          <span className="flex items-center gap-2 text-xs font-semibold text-amber-400"><Users className="h-4 w-4" /> Üye envanteri</span>
          <h1 className="mt-2 font-display text-2xl font-extrabold text-white">Tüm platform kullanıcıları</h1>
          <p className="mt-1 text-sm text-white/60">{memberTotal ?? rows.length} profil · tenant bazlı görünüm</p>
          {filterTenant ? (
            <p className="mt-3">
              <Link
                href="/admin/members"
                className="focus-ring inline-flex items-center gap-1.5 rounded-full bg-white/10 px-3 py-1 text-xs font-semibold text-white transition hover:bg-white/15"
              >
                Ofis: {filterTenant.name} <X className="h-3 w-3" />
              </Link>
            </p>
          ) : null}
        </div>
      </section>

      <DataTable
        columns={MEMBER_COLUMNS}
        rows={memberRows}
        rowActions={rowActions}
        minWidth={760}
        searchPlaceholder="Kullanıcı, telefon, ofis veya rol ara…"
        empty={{ description: "Arama terimini değiştirip tekrar deneyin." }}
      />

      <Pagination page={page} total={memberTotal ?? 0} hrefFor={(p) => buildMembersHref({ tenant: tenantFilter, q: query, sayfa: p })} />
    </div>
  );
}
