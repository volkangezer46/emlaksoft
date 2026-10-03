import Link from "next/link";
import { Building2, Eye, MapPin, Radio } from "lucide-react";
import { IntentLink } from "@/components/app/intent-link";
import { OwnerPortalLinkButton } from "@/components/app/portal-link-dialog";
import type { CompareItem } from "@/components/public/compare-table";
import { Table, TableFrame, TBody, TD, TH, THead, TR } from "@/components/ui/table";
import { EntityThumb, RowActionLink, RowActions, StatusPill, type Density, type PillTone } from "@/components/ui/list-kit";
import { PropertyRowCheckbox, PropertySelectAllCheckbox } from "./property-bulk-actions";
import { PropertyRowCompare } from "./property-row-compare";

/** Sayfanın hazırladığı, sunuma hazır satır modeli (saf veri). */
export type PropertyVM = {
  id: string;
  code: string;
  title: string;
  href: string;
  coverSrc: string | null;
  subtitle: string | null;
  tx: string;
  type: string;
  location: string;
  price: string;
  statusLabel: string;
  statusTone: PillTone;
  health: { tone: PillTone; label: string } | null;
  portalsLive: number;
  portalsTotal: number;
  createdLabel: string;
  isNew: boolean;
  compareItem: CompareItem;
};

function PortalCell({ live, total }: { live: number; total: number }) {
  if (total === 0) return <span className="text-text-faint">—</span>;
  return (
    <span className="inline-flex items-center gap-1.5 text-text-muted" title={`${total} portalda kayıtlı, ${live} canlı`}>
      <Radio aria-hidden="true" className={`h-3.5 w-3.5 ${live > 0 ? "text-[var(--success-strong)]" : "text-text-faint"}`} />
      <span className="numeric">
        {live}/{total}
      </span>
    </span>
  );
}

/** md+ tablo görünümü: kapak önizleme, kapsüller, satır eylemleri. */
export function PropertyTable({
  rows,
  ids,
  canBulk,
  canEdit,
  density,
}: {
  rows: PropertyVM[];
  ids: string[];
  canBulk: boolean;
  canEdit: boolean;
  density: Density;
}) {
  return (
    <div className="hidden md:block">
      <TableFrame minWidth={canBulk ? 980 : 940} density={density} maxHeight="75vh">
        <Table>
          <THead sticky>
            <TR>
              {canBulk ? (
                <TH className="w-10">
                  <PropertySelectAllCheckbox ids={ids} />
                </TH>
              ) : null}
              <TH>Portföy</TH>
              <TH>İşlem · tip</TH>
              <TH className="hidden lg:table-cell">Konum</TH>
              <TH align="right">Fiyat</TH>
              <TH>Durum</TH>
              <TH className="hidden xl:table-cell">Fiyat sağlığı</TH>
              <TH className="hidden xl:table-cell">Portal</TH>
              <TH className="hidden lg:table-cell">Eklenme</TH>
              <TH align="right">
                <span className="sr-only">İşlemler</span>
              </TH>
            </TR>
          </THead>
          <TBody>
            {rows.map((p) => (
              <TR key={p.id} interactive>
                {canBulk ? (
                  <TD className="w-10">
                    <PropertyRowCheckbox id={p.id} name={p.title} />
                  </TD>
                ) : null}
                <TD>
                  <IntentLink href={p.href} className="absolute inset-0" aria-label={`${p.title} detayları`} />
                  <div className="flex items-center gap-3">
                    <EntityThumb src={p.coverSrc} alt="" icon={Building2} />
                    <div className="min-w-0">
                      <p className="flex items-center gap-1.5 font-semibold text-text">
                        <span className="max-w-[16rem] truncate">{p.title}</span>
                        {p.isNew ? <StatusPill tone="success" dot={false}>Yeni</StatusPill> : null}
                      </p>
                      <p className="mt-0.5 truncate text-xs text-text-muted">
                        <span className="numeric font-medium">{p.code}</span>
                        {p.subtitle ? ` · ${p.subtitle}` : ""}
                      </p>
                    </div>
                  </div>
                </TD>
                <TD>
                  <p className="font-medium text-text">{p.type}</p>
                  <p className="text-xs text-text-muted">{p.tx}</p>
                </TD>
                <TD className="hidden text-text-muted lg:table-cell">
                  <span className="flex items-center gap-1.5">
                    <MapPin aria-hidden="true" className="h-3.5 w-3.5 shrink-0 text-text-faint" />
                    <span className="max-w-[12rem] truncate">{p.location}</span>
                  </span>
                </TD>
                <TD align="right" className="font-semibold text-text">
                  {p.price}
                </TD>
                <TD>
                  <StatusPill tone={p.statusTone}>{p.statusLabel}</StatusPill>
                </TD>
                <TD className="hidden xl:table-cell">
                  {p.health ? <StatusPill tone={p.health.tone}>{p.health.label}</StatusPill> : <span className="text-text-faint">—</span>}
                </TD>
                <TD className="hidden xl:table-cell">
                  <PortalCell live={p.portalsLive} total={p.portalsTotal} />
                </TD>
                <TD className="numeric hidden text-text-muted lg:table-cell">{p.createdLabel}</TD>
                <TD>
                  <RowActions>
                    <RowActionLink href={p.href} label={`${p.title} detayını aç`} icon={Eye} />
                    <PropertyRowCompare item={p.compareItem} />
                    {canEdit ? <OwnerPortalLinkButton propertyId={p.id} propertyLabel={p.title} /> : null}
                  </RowActions>
                </TD>
              </TR>
            ))}
          </TBody>
        </Table>
      </TableFrame>
    </div>
  );
}

/** <md: tablo yerine dokunmatik dostu kart listesi (yatay kaydırma yok). */
export function PropertyMobileList({ rows }: { rows: PropertyVM[] }) {
  return (
    <ul className="space-y-2.5 md:hidden">
      {rows.map((p) => (
        <li key={p.id} className="surface-card relative flex gap-3 rounded-[var(--radius-card)] p-3">
          <EntityThumb src={p.coverSrc} alt="" icon={Building2} className="h-16 w-20" />
          <div className="min-w-0 flex-1">
            <Link href={p.href} prefetch={false} className="focus-ring line-clamp-2 font-semibold text-text after:absolute after:inset-0">
              {p.title}
            </Link>
            <p className="mt-0.5 truncate text-xs text-text-muted">
              {p.type} · {p.tx} · {p.location}
            </p>
            <p className="mt-1 font-display text-base font-bold text-text">{p.price}</p>
            <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
              <StatusPill tone={p.statusTone}>{p.statusLabel}</StatusPill>
              {p.health ? <StatusPill tone={p.health.tone}>Fiyat: {p.health.label}</StatusPill> : null}
            </div>
          </div>
        </li>
      ))}
    </ul>
  );
}
