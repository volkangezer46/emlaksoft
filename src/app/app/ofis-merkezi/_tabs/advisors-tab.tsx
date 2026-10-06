import { Users } from "lucide-react";
import { AdvisorTable } from "@/components/app/office-center/advisor-table";
import { QuickInvitePanel } from "@/components/app/office-center/quick-invite-panel";
import { Alert } from "@/components/ui/alert";
import { EmptyState } from "@/components/ui/empty-state";
import { FilterBar } from "@/components/ui/filter-bar";
import { FormSelect } from "@/components/ui/form-controls";
import { StatRow } from "@/components/ui/stat-row";
import { filterAdvisors, parseAdvisorFilters, sortAdvisors, tabHref } from "@/lib/office-center/logic";
import { loadOfficeAdvisors } from "@/lib/office-center/store";
import type { AdvisorSortKey } from "@/lib/office-center/types";
import { ROLE_LABELS } from "@/lib/role-labels";
import { assignableRolesFor } from "@/lib/team/assignable-roles";
import { buildHref, mergeParams } from "@/lib/ui/filter-params";
import type { TabContext } from "./context";

const PATH = "/app/ofis-merkezi";
const ADVISOR_ROLES = ["owner", "gm", "branch_manager", "team_lead", "advisor"];

export async function AdvisorsTab({ ctx }: { ctx: TabContext }) {
  const f = parseAdvisorFilters(ctx.sp);
  const data = await loadOfficeAdvisors(ctx.supabase, ctx.tenantId, { userId: ctx.userId, role: ctx.role, perms: ctx.perms }, ctx.nowMs);
  const all = data.rows;
  const rows = sortAdvisors(filterAdvisors(all, f), f.sirala, f.yon);
  const active = all.filter((r) => r.isActive);
  const roles = assignableRolesFor(ctx.role);
  const handoffTargets = active.filter((r) => ADVISOR_ROLES.includes(r.role)).map((r) => ({ id: r.id, name: r.fullName }));
  const sp = ctx.sp;
  const sortHref = (key: AdvisorSortKey) => buildHref(PATH, mergeParams(sp, { sekme: undefined, sirala: key, yon: f.sirala === key && f.yon === "desc" ? "asc" : f.sirala === key ? "desc" : key === "ad" ? "asc" : "desc" }));
  const idle30 = active.filter((r) => !r.lastActivityAt || ctx.nowMs - Date.parse(r.lastActivityAt) > 30 * 86_400_000).length;

  return (
    <div className="space-y-5">
      <StatRow
        label="Danışman özeti"
        items={[
          { label: "Toplam üye", value: all.length, href: tabHref("danismanlar") },
          { label: "Aktif", value: active.length, href: tabHref("danismanlar", { durum: "aktif" }) },
          { label: "Pasif", value: all.length - active.length, href: tabHref("danismanlar", { durum: "pasif" }) },
          { label: "Bugün izinli", value: active.filter((r) => r.onLeaveToday).length, href: "/app/ekip/izinler" },
          { label: "30 gündür aktivitesiz", value: idle30, href: tabHref("danismanlar", { durum: "aktif", sirala: "aktivite", yon: "asc" }), attention: idle30 > 0, hint: "aktif üyeler" },
        ]}
      />

      {data.failed ? (
        <Alert tone="warning" title="Bazı sayılar okunamadı">
          Liste gösteriliyor ancak portföy/talep/kapanış sayılarından biri yüklenemedi; sayılara güvenmeyin, sayfayı yenileyin.
        </Alert>
      ) : null}
      {data.partial ? <p className="text-xs text-text-muted">Büyük ofis: sayımlar tavana dayandı, bazı değerler eksik olabilir.</p> : null}

      <div className="flex flex-wrap items-start justify-between gap-3">
        <FilterBar
          className="min-w-0 flex-1"
          pathname={PATH}
          params={sp}
          searchPlaceholder="Ad, unvan veya takım ara"
          tabParam="durum"
          tabs={[
            { label: "Aktif", value: "aktif", count: active.length },
            { label: "Pasif", value: "pasif", count: all.length - active.length },
          ]}
          panelParamKeys={["rol", "sube"]}
          resultCount={rows.length}
          resultNoun="danışman"
          panel={
            <>
              <label className="text-xs font-medium text-ink-950">
                Rol
                <FormSelect name="rol" defaultValue={f.rol} className="mt-1">
                  <option value="">Tümü</option>
                  {Object.entries(ROLE_LABELS).map(([k, v]) => (
                    <option key={k} value={k}>
                      {v}
                    </option>
                  ))}
                </FormSelect>
              </label>
              {data.branches.length ? (
                <label className="text-xs font-medium text-ink-950">
                  Şube
                  <FormSelect name="sube" defaultValue={f.sube} className="mt-1">
                    <option value="">Tümü</option>
                    {data.branches.map((b) => (
                      <option key={b.id} value={b.id}>
                        {b.name}
                      </option>
                    ))}
                  </FormSelect>
                </label>
              ) : null}
            </>
          }
        />
        {ctx.canCreate ? <QuickInvitePanel roles={roles} branches={data.branches} /> : null}
      </div>

      {rows.length === 0 ? (
        <EmptyState
          icon={Users}
          title={all.length === 0 ? "Henüz ekip üyesi yok" : "Filtreye uyan danışman yok"}
          description={all.length === 0 ? "İlk danışmanı davet edin; hesap açılır ve e-posta ile erişim bağlantısı gider." : "Filtreleri temizleyin ya da başka bir şube/rol seçin."}
          action={all.length === 0 && ctx.canCreate ? { href: "/app/ekip/yeni", label: "Danışman ekle" } : { href: tabHref("danismanlar"), label: "Filtreleri temizle" }}
        />
      ) : (
        <AdvisorTable
          rows={rows}
          sort={{ key: f.sirala, dir: f.yon, href: sortHref }}
          actions={
            ctx.canEdit
              ? { viewerId: ctx.userId, roles, branches: data.branches, teams: data.teams, teamsAvailable: data.teamsAvailable, handoffTargets }
              : null
          }
        />
      )}
    </div>
  );
}
