import Link from "next/link";
import { ArrowUpRight, PalmtreeIcon, Users } from "lucide-react";
import { AdvisorRowActions } from "@/components/app/office-center/advisor-row-actions";
import { QuickInvitePanel } from "@/components/app/office-center/quick-invite-panel";
import { Alert } from "@/components/ui/alert";
import { EmptyState } from "@/components/ui/empty-state";
import { FilterBar } from "@/components/ui/filter-bar";
import { FormSelect } from "@/components/ui/form-controls";
import { StatRow } from "@/components/ui/stat-row";
import { Table, TableFrame, TBody, TD, TH, THead, TR } from "@/components/ui/table";
import { relativeTimeTR } from "@/lib/admin-format";
import { filterAdvisors, parseAdvisorFilters, sortAdvisors, tabHref } from "@/lib/office-center/logic";
import { loadOfficeAdvisors } from "@/lib/office-center/store";
import type { AdvisorSortKey, OfficeAdvisorRow } from "@/lib/office-center/types";
import { ROLE_LABELS } from "@/lib/role-labels";
import { assignableRolesFor } from "@/lib/team/assignable-roles";
import { buildHref, mergeParams } from "@/lib/ui/filter-params";
import type { TabContext } from "./context";

const PATH = "/app/ofis-merkezi";
const ADVISOR_ROLES = ["owner", "gm", "branch_manager", "team_lead", "advisor"];

const SORTS: { key: AdvisorSortKey; label: string; align?: "right" }[] = [
  { key: "ad", label: "Danışman" },
  { key: "portfoy", label: "Açık portföy", align: "right" },
  { key: "talep", label: "Açık talep", align: "right" },
  { key: "kapanis", label: "Bu ay kapanış", align: "right" },
  { key: "sla", label: "SLA uyumu", align: "right" },
  { key: "aktivite", label: "Son aktivite" },
];

function Num({ value, href, label, dim }: { value: number | string; href: string; label: string; dim?: boolean }) {
  return (
    <Link href={href} aria-label={label} className={`focus-ring numeric inline-flex items-center gap-0.5 rounded-[var(--radius-control)] px-1 font-semibold text-ink-950 hover:text-brand-600 ${dim ? "opacity-60" : ""}`}>
      {value} <ArrowUpRight className="hover-action h-3 w-3 opacity-0 transition group-hover:opacity-100" aria-hidden="true" />
    </Link>
  );
}

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
        <TableFrame stickyFirst minWidth={960}>
          <Table>
            <THead>
              <TR>
                {SORTS.map((s) => (
                  <TH key={s.key} align={s.align} aria-sort={f.sirala === s.key ? (f.yon === "asc" ? "ascending" : "descending") : "none"}>
                    <Link href={sortHref(s.key)} className="focus-ring inline-flex items-center gap-1 hover:text-brand-600">
                      {s.label}
                      {f.sirala === s.key ? <span aria-hidden="true">{f.yon === "asc" ? "↑" : "↓"}</span> : null}
                    </Link>
                  </TH>
                ))}
                <TH>Rol · takım/şube</TH>
                {ctx.canEdit ? <TH>İşlem</TH> : null}
              </TR>
            </THead>
            <TBody>
              {rows.map((r: OfficeAdvisorRow) => (
                <TR key={r.id} className={`group ${!r.isActive ? "opacity-70" : ""}`}>
                  <TD>
                    <Link href={`/app/ekip/${r.id}`} className="focus-ring inline-flex items-center gap-1 font-semibold text-ink-950 hover:text-brand-600">
                      {r.fullName} <ArrowUpRight className="h-3.5 w-3.5 opacity-0 transition group-hover:opacity-100" aria-hidden="true" />
                    </Link>
                    <p className="text-xs text-text-muted">
                      {r.title ?? "—"}
                      {!r.isActive ? " · Pasif" : ""}
                      {r.onLeaveToday ? (
                        <Link href="/app/ekip/izinler" className="ml-1 inline-flex items-center gap-0.5 rounded-full bg-amber-400/15 px-1.5 text-xs font-semibold text-amber-700">
                          <PalmtreeIcon className="h-3 w-3" aria-hidden="true" /> İzinde
                        </Link>
                      ) : null}
                    </p>
                  </TD>
                  <TD align="right">
                    <Num value={r.openProperties} href={`/app/portfoyler?danisman=${r.id}`} label={`${r.fullName} açık portföyleri`} dim={r.openProperties === 0} />
                  </TD>
                  <TD align="right">
                    <Num value={r.openDemands} href={`/app/talepler?danisman=${r.id}`} label={`${r.fullName} açık talepleri`} dim={r.openDemands === 0} />
                  </TD>
                  <TD align="right">
                    <Num value={r.wonThisMonth} href={`/app/anlasmalar?gorunum=liste&asama=won&danisman=${r.id}`} label={`${r.fullName} bu ay kazanılan anlaşmaları`} dim={r.wonThisMonth === 0} />
                  </TD>
                  <TD align="right">
                    <Num value={r.slaWithinPct == null ? "—" : `%${r.slaWithinPct}`} href={`/app/raporlar/lead-hizi?danisman=${r.id}`} label={`${r.fullName} ilk yanıt raporu`} dim={r.slaWithinPct == null} />
                  </TD>
                  <TD>
                    <span className="text-xs text-text-muted">{r.lastActivityAt ? relativeTimeTR(r.lastActivityAt) : "90+ gün / kayıt yok"}</span>
                  </TD>
                  <TD>
                    <span className="text-xs font-semibold text-ink-950">{ROLE_LABELS[r.role] ?? r.role}</span>
                    <p className="text-xs text-text-muted">{[r.teamName, r.branchName].filter(Boolean).join(" · ") || "—"}</p>
                  </TD>
                  {ctx.canEdit ? (
                    <TD>
                      {r.role === "owner" ? (
                        <span className="text-xs text-text-faint">Ofis sahibi</span>
                      ) : r.id === ctx.userId ? (
                        <Link href="/app/hesabim" className="text-xs font-semibold text-brand-600 hover:underline">
                          Hesabım
                        </Link>
                      ) : (
                        <AdvisorRowActions
                          advisor={{ id: r.id, fullName: r.fullName, role: r.role, isActive: r.isActive, branchId: r.branchId, teamId: r.teamId }}
                          roles={roles}
                          branches={data.branches}
                          teams={data.teams}
                          teamsAvailable={data.teamsAvailable}
                          handoffTargets={handoffTargets.filter((t) => t.id !== r.id)}
                        />
                      )}
                    </TD>
                  ) : null}
                </TR>
              ))}
            </TBody>
          </Table>
        </TableFrame>
      )}
    </div>
  );
}
