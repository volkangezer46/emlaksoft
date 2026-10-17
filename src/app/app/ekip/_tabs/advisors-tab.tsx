import type { ReactNode } from "react";
import { Users } from "lucide-react";
import { AdvisorTable } from "@/components/app/office-center/advisor-table";
import { Alert } from "@/components/ui/alert";
import { EmptyState } from "@/components/ui/empty-state";
import { FilterGrid, FilterSelect, ListToolbar, buildActiveChips } from "@/components/ui/list-kit";
import { StatRow } from "@/components/ui/stat-row";
import { filterAdvisors, parseAdvisorFilters, sortAdvisors, tabHref } from "@/lib/office-center/logic";
import { loadOfficeAdvisors } from "@/lib/office-center/store";
import { TEAM_HUB_PATH, type AdvisorSortKey } from "@/lib/office-center/types";
import { ROLE_LABELS } from "@/lib/role-labels";
import { assignableRolesFor } from "@/lib/team/assignable-roles";
import { buildHref, mergeParams } from "@/lib/ui/filter-params";
import type { TabContext } from "./context";
import { Combobox } from "@/components/ui/combobox";

const PATH = TEAM_HUB_PATH;
const ADVISOR_ROLES = ["owner", "gm", "branch_manager", "team_lead", "advisor"];

export async function AdvisorsTab({ ctx, extra }: { ctx: TabContext; extra?: ReadonlyMap<string, ReactNode>; simple?: boolean }) {
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
  // Araç çubuğu URL durumu: yalnız tanınan danışman listesi parametreleri (sekme yok; Ekip sekmesi varsayılan).
  const toolbarParams: Record<string, string> = {};
  for (const k of ["q", "durum", "rol", "sube", "sirala", "yon"] as const) {
    const v = f[k];
    if (v && !(k === "sirala" && v === "ad") && !(k === "yon" && v === "asc" && f.sirala === "ad")) toolbarParams[k] = v;
  }
  const chips = buildActiveChips(PATH, toolbarParams, [
    { key: "q", label: "Arama" },
    { key: "durum", label: "Durum", format: (v) => (v === "aktif" ? "Aktif" : "Pasif") },
    { key: "rol", label: "Rol", format: (v) => ROLE_LABELS[v] ?? v },
    { key: "sube", label: "Şube", format: (v) => data.branches.find((b) => b.id === v)?.name ?? "Seçili şube" },
  ]);

  return (
    <div className="space-y-5">
      {/* KPI kartları = süzgeçler (WP3, tek desen): Toplam / Aktif / Pasif durum süzgecidir (etkin kart işaretli); ayrı durum
          sekmesi yok. Tek özet satırı (sayfada ikinci KPI şeridi yok, C25). */}
      <StatRow
        label="Danışman süzgeçleri"
        items={[
          { label: "Toplam üye", value: all.length, href: tabHref("danismanlar", { q: f.q || undefined }), active: !f.durum },
          { label: "Aktif", value: active.length, href: tabHref("danismanlar", { durum: "aktif", q: f.q || undefined }), active: f.durum === "aktif" && f.sirala !== "aktivite" },
          { label: "Pasif", value: all.length - active.length, href: tabHref("danismanlar", { durum: "pasif", q: f.q || undefined }), active: f.durum === "pasif" },
          { label: "Bugün izinli", value: active.filter((r) => r.onLeaveToday).length, href: "/app/ekip/izinler" },
          { label: "30 gündür aktivitesiz", value: idle30, href: tabHref("danismanlar", { durum: "aktif", sirala: "aktivite", yon: "asc" }), attention: idle30 > 0, hint: "aktif üyeler", active: f.durum === "aktif" && f.sirala === "aktivite" && f.yon === "asc" },
        ]}
      />

      {data.failed ? (
        <Alert tone="warning" title="Bazı sayılar okunamadı">
          Liste gösteriliyor ancak portföy/talep/kapanış sayılarından biri yüklenemedi; sayılara güvenmeyin, sayfayı yenileyin.
        </Alert>
      ) : null}
      {data.partial ? <p className="text-xs text-text-muted">Büyük ofis: sayımlar tavana dayandı, bazı değerler eksik olabilir.</p> : null}

      {/* Tek araç çubuğu (WP3): anlık arama + "Filtreler" paneli (rol, şube); "Uygula" düğmesi yok. "Danışman ekle" başlıktadır. */}
      <ListToolbar
        pathname={PATH}
        params={toolbarParams}
        searchPlaceholder="Ad, unvan veya takım ara…"
        searchLabel="Danışman ara"
        panelParamKeys={["rol", "sube"]}
        chips={chips}
        resultCount={rows.length}
        resultNoun="danışman"
        panel={
          <FilterGrid>
            <FilterSelect
              name="rol"
              label="Rol"
              value={f.rol}
              options={[{ value: "", label: "Tümü" }, ...Object.entries(ROLE_LABELS).map(([k, v]) => ({ value: k, label: v }))]}
            />
            {data.branches.length ? (
              <label className="grid gap-1 text-xs font-semibold text-text-muted">
                Şube
                <Combobox
                  name="sube"
                  defaultValue={f.sube}
                  options={data.branches.map((b) => ({ value: b.id, label: b.name }))}
                  placeholder="Tümü"
                  searchPlaceholder="Şube ara…"
                  emptyText="Eşleşen şube yok"
                />
              </label>
            ) : null}
          </FilterGrid>
        }
      />

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
          extra={extra}
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
