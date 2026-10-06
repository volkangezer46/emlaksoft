import { Users } from "lucide-react";
import { createClient } from "@/lib/supabase/server";
import { requireModulePage } from "@/lib/require-module-page";
import { PageHeader } from "@/components/ui/page-header";
import { StatRow } from "@/components/ui/stat-row";
import { Alert } from "@/components/ui/alert";
import { ROLE_LABELS } from "@/lib/role-labels";
import { TeamManager, type MemberRow, type TeamRow } from "./team-manager";

export const metadata = { title: "Takımlar" };

/** Takımlar: ekip merkezinin sekmesi. Takım tanımı, lider ataması ve üye-takım eşleşmesi (ilan kontrol SLA alıcısı). */
export default async function TeamsPage() {
  const { perms } = await requireModulePage("team", "/app/ekip");
  const canManage = (perms.team ?? []).includes("edit");
  const supabase = await createClient();

  const teamsRes = await supabase.from("teams").select("id, name, branch_id, lead_user_id, is_active").order("created_at", { ascending: true }).limit(200);
  const schemaMissing = !!teamsRes.error;
  const membersRes = schemaMissing
    ? await supabase.from("profiles").select("id, full_name, role, is_active, branch_id").limit(500)
    : await supabase.from("profiles").select("id, full_name, role, is_active, branch_id, team_id").limit(500);
  const { data: branches } = await supabase.from("branches").select("id, name").eq("is_active", true).order("name").limit(200);

  const members: MemberRow[] = ((membersRes.data ?? []) as unknown as { id: string; full_name: string; role: string; is_active: boolean; branch_id: string | null; team_id?: string | null }[])
    .filter((m) => m.is_active)
    .map((m) => ({ id: m.id, name: m.full_name, roleLabel: ROLE_LABELS[m.role] ?? m.role, branchId: m.branch_id, teamId: m.team_id ?? null }))
    .sort((a, b) => a.name.localeCompare(b.name, "tr"));
  const teams: TeamRow[] = ((teamsRes.data ?? []) as { id: string; name: string; branch_id: string | null; lead_user_id: string | null; is_active: boolean }[]).map((t) => ({
    id: t.id,
    name: t.name,
    branchId: t.branch_id,
    leadUserId: t.lead_user_id,
    isActive: t.is_active,
    memberCount: members.filter((m) => m.teamId === t.id).length,
  }));

  const active = teams.filter((t) => t.isActive);
  const withoutLead = active.filter((t) => !t.leadUserId).length;
  const teamless = members.filter((m) => !m.teamId).length;

  return (
    <div className="space-y-6">
      <PageHeader
        title="Takımlar"
        eyebrow="Ekip & yetkiler"
        icon={<Users className="h-6 w-6" />}
        description="Danışmanları takımlara ayırın, takım lideri atayın. Portal ilanı uyarıları 4 saat içinde ilgilenilmezse takım liderine yükselir."
        className="mb-0"
      />
      {schemaMissing ? (
        <Alert tone="warning">Takım şeması bu ortamda henüz uygulanmadı; takım tanımlama migration uygulandıktan sonra açılır.</Alert>
      ) : (
        <StatRow
          items={[
            { label: "Takım", value: teams.length, href: "/app/ekip/takimlar" },
            { label: "Aktif", value: active.length, href: "/app/ekip/takimlar" },
            { label: "Lideri olmayan", value: withoutLead, href: "/app/ekip/takimlar" },
            { label: "Takımsız üye", value: teamless, href: "/app/ekip/takimlar#uyeler" },
          ]}
        />
      )}
      <TeamManager teams={teams} members={members} branches={(branches ?? []) as { id: string; name: string }[]} canManage={canManage && !schemaMissing} />
    </div>
  );
}
