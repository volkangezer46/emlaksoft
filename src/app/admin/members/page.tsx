import { Users } from "lucide-react";
import { createAdminClient } from "@/lib/supabase/admin";
import { requirePlatformModule } from "@/lib/platform";
import { formatTurkishPhone } from "@/lib/phone";

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

      <div className="overflow-hidden rounded-[20px] border border-line bg-surface">
        <div className="overflow-x-auto">
          <table className="w-full min-w-[720px] text-left text-sm">
            <thead className="border-b border-line bg-canvas/80 text-text-muted">
              <tr>
                <th className="px-5 py-3 font-medium">Kullanıcı</th>
                <th className="px-4 py-3 font-medium">Ofis</th>
                <th className="px-4 py-3 font-medium">Rol</th>
                <th className="px-4 py-3 font-medium">Durum</th>
                <th className="px-4 py-3 font-medium">Kayıt</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((m) => (
                <tr key={m.id} className="border-b border-line last:border-0">
                  <td className="px-5 py-3">
                    <p className="font-semibold text-ink-950">{m.full_name}</p>
                    <p className="text-xs text-text-faint">{m.phone ? formatTurkishPhone(m.phone) : "—"}</p>
                  </td>
                  <td className="px-4 py-3 text-text-muted">{tenantName(m.tenant as Rel)}</td>
                  <td className="px-4 py-3">
                    <span className="rounded-full bg-brand-600/10 px-2.5 py-1 text-[10px] font-bold text-brand-600">
                      {roleLabel[m.role] ?? m.role}
                    </span>
                  </td>
                  <td className="px-4 py-3">
                    <span className={`text-xs font-semibold ${m.is_active ? "text-mint-600" : "text-text-faint"}`}>
                      {m.is_active ? "Aktif" : "Pasif"}
                    </span>
                  </td>
                  <td className="px-4 py-3 text-xs text-text-muted">
                    {new Intl.DateTimeFormat("tr-TR", { dateStyle: "medium" }).format(new Date(m.created_at))}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
