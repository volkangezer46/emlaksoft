import { Building2 } from "lucide-react";
import { createClient } from "@/lib/supabase/server";
import { requireModulePage } from "@/lib/require-module-page";
import { PageHeader } from "@/components/ui/page-header";
import { StatRow } from "@/components/ui/stat-row";
import { BranchManager, type BranchRow, type ManagerOption } from "./branch-manager";
import { provinceOptionsResult } from "@/lib/geo/reader";

export const metadata = { title: "Şubeler" };

const ROLE_LABELS: Record<string, string> = {
  owner: "Ofis sahibi",
  gm: "Genel müdür",
  branch_manager: "Şube müdürü",
  team_lead: "Takım lideri",
  advisor: "Danışman",
  call_center: "Çağrı merkezi",
  accounting: "Muhasebe",
  readonly: "Salt okunur",
};

type ProvinceRel = { name?: string } | { name?: string }[] | null;

/** Şubeler: ekip merkezinin sekmesi. Ekle / düzenle / aktif-pasif / müdür / telefon. */
export default async function BranchesPage() {
  const { perms } = await requireModulePage("team", "/app/ekip");
  const canManage = (perms.team ?? []).includes("create");
  const supabase = await createClient();

  // branches.phone şeması uygulanmadıysa ilk sorgu hata verir; telefon alanı gizlenir.
  let phoneSupported = true;
  let branchRes = await supabase
    .from("branches")
    .select("id, name, is_active, province_id, manager_user_id, phone, province:geo_provinces(name)")
    .order("created_at", { ascending: true })
    .limit(200);
  if (branchRes.error) {
    phoneSupported = false;
    branchRes = (await supabase
      .from("branches")
      .select("id, name, is_active, province_id, manager_user_id, province:geo_provinces(name)")
      .order("created_at", { ascending: true })
      .limit(200)) as unknown as typeof branchRes;
  }

  const [{ data: members }, { data: provinces }] = await Promise.all([
    supabase.from("profiles").select("id, full_name, role, is_active, branch_id").limit(500),
    provinceOptionsResult(),
  ]);

  const memberList = members ?? [];
  const managers: ManagerOption[] = memberList
    .filter((m) => m.is_active)
    .map((m) => ({ id: m.id, name: m.full_name, roleLabel: ROLE_LABELS[m.role] ?? m.role }))
    .sort((a, b) => a.name.localeCompare(b.name, "tr"));

  const rows: BranchRow[] = ((branchRes.data ?? []) as unknown as {
    id: string;
    name: string;
    is_active: boolean;
    province_id: string | null;
    manager_user_id: string | null;
    phone?: string | null;
    province: ProvinceRel;
  }[]).map((b) => {
    const mine = memberList.filter((m) => m.branch_id === b.id);
    const prov = Array.isArray(b.province) ? b.province[0] : b.province;
    return {
      id: b.id,
      name: b.name,
      is_active: b.is_active,
      province_id: b.province_id,
      province_name: prov?.name ?? null,
      manager_user_id: b.manager_user_id,
      phone: b.phone ?? null,
      member_count: mine.length,
      active_member_count: mine.filter((m) => m.is_active).length,
    };
  });

  const activeCount = rows.filter((r) => r.is_active).length;
  const withoutManager = rows.filter((r) => r.is_active && !r.manager_user_id).length;

  return (
    <div className="space-y-6">
      <PageHeader
        title="Şubeler"
        eyebrow="Ekip & yetkiler"
        icon={<Building2 className="h-6 w-6" />}
        description="Şubelerinizi tanımlayın, müdür atayın, pasife alın. Üyelerin şubesi Ekip sayfasından veya üye kartından değişir."
        className="mb-0"
      />
      <StatRow
        items={[
          { label: "Şube", value: rows.length, href: "/app/ekip/subeler" },
          { label: "Aktif", value: activeCount, href: "/app/ekip/subeler" },
          { label: "Müdürü olmayan", value: withoutManager, href: "/app/ekip/subeler" },
          { label: "Şubesiz üye", value: memberList.filter((m) => !m.branch_id).length, href: "/app/ekip#uyeler" },
        ]}
      />
      <BranchManager
        branches={rows}
        managers={managers}
        provinces={provinces ?? []}
        phoneSupported={phoneSupported}
        canManage={canManage}
      />
    </div>
  );
}
