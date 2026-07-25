import { Users } from "lucide-react";
import { createAdminClient } from "@/lib/supabase/admin";
import { requirePlatformModule } from "@/lib/platform";
import { formatTurkishPhone } from "@/lib/phone";
import { DataTable, type DataTableColumn, type DataTableRow } from "@/components/ui/data-table";

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

type Rel = { name?: string } | { name?: string }[] | null;

function tenantName(value: Rel) {
  if (!value) return "—";
  return Array.isArray(value) ? (value[0]?.name ?? "—") : (value.name ?? "—");
}

export default async function AdminMembersPage() {
  await requirePlatformModule("members");
  const admin = createAdminClient();

  const { data } = await admin
    .from("profiles")
    .select("id, full_name, phone, role, is_active, created_at, tenant:tenants(name)")
    .order("created_at", { ascending: false })
    .limit(300);

  const rows = data ?? [];

  const memberRows: DataTableRow[] = rows.map((m) => ({
    id:         m.id,
    full_name:  m.full_name,
    phone:      m.phone ? formatTurkishPhone(m.phone) : null,
    tenantName: tenantName(m.tenant as Rel),
    role:       m.role,
    status:     m.is_active ? "active" : "passive",
    created_at: m.created_at,
  }));

  return (
    <div className="space-y-6">
      <section className="theme-dark relative overflow-hidden rounded-[22px] bg-[image:var(--grad-ink)] p-6 text-white">
        <div className="pointer-events-none absolute inset-0 grid-overlay-dark opacity-35" />
        <div className="relative">
          <span className="flex items-center gap-2 text-xs font-semibold text-amber-400"><Users className="h-4 w-4" /> Üye envanteri</span>
          <h1 className="mt-2 font-display text-2xl font-extrabold text-white">Tüm platform kullanıcıları</h1>
          <p className="mt-1 text-sm text-white/60">{rows.length} profil · tenant bazlı görünüm</p>
        </div>
      </section>

      <DataTable
        columns={MEMBER_COLUMNS}
        rows={memberRows}
        minWidth={720}
        searchPlaceholder="Kullanıcı, telefon, ofis veya rol ara…"
        empty={{ description: "Arama terimini değiştirip tekrar deneyin." }}
      />
    </div>
  );
}
