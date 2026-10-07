import Link from "@/components/ui/smart-link";
import { Building2, Eye } from "lucide-react";
import { SpriteIcon } from "@/components/ui/icon-sprite";
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
      <SpriteIcon name="radio" className={`h-3.5 w-3.5 ${live > 0 ? "text-[var(--success-strong)]" : "text-text-faint"}`} />
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
    <div>
      <TableFrame stack minWidth={canBulk ? 1040 : 1000} density={density} maxHeight="75vh">
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
              <TH className="hidden xl:table-cell">Konum</TH>
              <TH align="right">Fiyat</TH>
              <TH>Durum</TH>
              <TH className="hidden min-w-[9.5rem] xl:table-cell">Fiyat sağlığı</TH>
              <TH className="hidden 2xl:table-cell">Portal</TH>
              <TH className="hidden 2xl:table-cell">Eklenme</TH>
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
                <TD primary>
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
                <TD className="hidden text-text-muted xl:table-cell">
                  <span className="flex items-center gap-1.5">
                    <SpriteIcon name="map-pin" className="h-3.5 w-3.5 shrink-0 text-text-faint" />
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
                <TD className="hidden 2xl:table-cell">
                  <PortalCell live={p.portalsLive} total={p.portalsTotal} />
                </TD>
                <TD className="numeric hidden text-text-muted 2xl:table-cell">{p.createdLabel}</TD>
                <TD actions>
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

