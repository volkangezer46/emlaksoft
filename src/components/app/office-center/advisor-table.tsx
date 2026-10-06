import Link from "next/link";
import type { ReactNode } from "react";
import { ArrowUpRight, PalmtreeIcon } from "lucide-react";
import { AdvisorRowActions, type Option } from "@/components/app/office-center/advisor-row-actions";
import { Table, TableFrame, TBody, TD, TH, THead, TR } from "@/components/ui/table";
import { relativeTimeTR } from "@/lib/admin-format";
import type { AdvisorSortKey, OfficeAdvisorRow } from "@/lib/office-center/types";
import { ROLE_LABELS } from "@/lib/role-labels";

/**
 * TEK danışman listesi (Ofis Merkezi > Danışmanlar ve Ekip Merkezi > Genel aynı bileşen + aynı kaynak `loadOfficeAdvisors`).
 * Her sayı danışmanla süzülmüş listeye gider (sıfır çıkmaz). Sıralama bağlantıları çağırandan (`sort`), satır işlemleri
 * (rol/şube/takım, pasife alma + devir) yalnız `actions` verilirse çizilir. `extra`: sayfaya özgü satır rozeti (ör. son giriş).
 */
export const ADVISOR_SORTS: { key: AdvisorSortKey; label: string; align?: "right" }[] = [
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

export type AdvisorTableActions = {
  viewerId: string;
  roles: readonly string[];
  branches: Option[];
  teams: Option[];
  teamsAvailable: boolean;
  handoffTargets: Option[];
};

export function AdvisorTable({
  rows,
  sort,
  actions,
  extra,
}: {
  rows: readonly OfficeAdvisorRow[];
  sort?: { key: AdvisorSortKey; dir: "asc" | "desc"; href: (key: AdvisorSortKey) => string };
  actions?: AdvisorTableActions | null;
  extra?: ReadonlyMap<string, ReactNode>;
}) {
  return (
    <TableFrame stickyFirst minWidth={960}>
      <Table>
        <THead>
          <TR>
            {ADVISOR_SORTS.map((s) => (
              <TH key={s.key} align={s.align} aria-sort={sort?.key === s.key ? (sort.dir === "asc" ? "ascending" : "descending") : "none"}>
                {sort ? (
                  <Link href={sort.href(s.key)} className="focus-ring inline-flex items-center gap-1 hover:text-brand-600">
                    {s.label}
                    {sort.key === s.key ? <span aria-hidden="true">{sort.dir === "asc" ? "↑" : "↓"}</span> : null}
                  </Link>
                ) : (
                  s.label
                )}
              </TH>
            ))}
            <TH>Rol · takım/şube</TH>
            {actions ? <TH>İşlem</TH> : null}
          </TR>
        </THead>
        <TBody>
          {rows.map((r) => (
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
                {extra?.get(r.id) ?? null}
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
              {actions ? (
                <TD>
                  {r.role === "owner" ? (
                    <span className="text-xs text-text-faint">Ofis sahibi</span>
                  ) : r.id === actions.viewerId ? (
                    <Link href="/app/hesabim" className="text-xs font-semibold text-brand-600 hover:underline">
                      Hesabım
                    </Link>
                  ) : (
                    <AdvisorRowActions
                      advisor={{ id: r.id, fullName: r.fullName, role: r.role, isActive: r.isActive, branchId: r.branchId, teamId: r.teamId }}
                      roles={actions.roles}
                      branches={actions.branches}
                      teams={actions.teams}
                      teamsAvailable={actions.teamsAvailable}
                      handoffTargets={actions.handoffTargets.filter((t) => t.id !== r.id)}
                    />
                  )}
                </TD>
              ) : null}
            </TR>
          ))}
        </TBody>
      </Table>
    </TableFrame>
  );
}
