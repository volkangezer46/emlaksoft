import { Building2, Eye } from "lucide-react";
import { SpriteIcon } from "@/components/ui/icon-sprite";
import { IntentLink } from "@/components/app/intent-link";
import { OwnerPortalLinkButton } from "@/components/app/owner-portal-link-button";
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
  /** Kapalı (gizli) portföy: vitrin/portal yayınında yok, yalnız ofis içi. */
  isClosed: boolean;
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

/**
 * md+ tablo görünümü: kapak önizleme, kapsüller, satır eylemleri. <768 px'te kompakt kart (list-page.css `.tbl-stack`):
 * kapak + başlık + eylemler bir satır, tip · işlem / fiyat / durum ikinci satır — 390×844'te ilk ekranda ≥4 portföy.
 */
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
      {/* 1366 px'te (içerik ~1060 px) tablo yatay kaymadan sığar: hücre yatay boşluğu 12 px, başlık/konum sınırlı genişlik,
          küçük kapak; böylece "Fiyat sağlığı" başlığı yapışık işlem sütununun altında kesilmez ("FİYAT SA", P1 9). */}
      <TableFrame
        stack
        minWidth={canBulk ? 1000 : 960}
        density={density}
        maxHeight="75vh"
        className={density === "kompakt" ? "md:[&_td]:px-3 md:[&_th]:px-3" : "md:[&_td]:px-3 md:[&_td]:py-2.5 md:[&_th]:px-3"}
      >
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
              <TH className="hidden xl:table-cell" title="Fiyat sağlığı">Fiyat sağlığı</TH>
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
                    <EntityThumb src={p.coverSrc} alt="" icon={Building2} size="sm" />
                    <div className="min-w-0">
                      <p className="flex items-center gap-1.5 font-semibold text-text">
                        {/* Kartta (<768) başlık iki satıra kadar: sonu farklı başlıklar ("… (referans)") ayırt edilir (B139).
                            xl ve üstünde genişlikle büyür (F9: geniş tabloda 14rem'de kesiliyordu). */}
                        <span className="min-w-0 max-w-[14rem] truncate max-md:line-clamp-2 max-md:max-w-none max-md:whitespace-normal xl:max-w-[clamp(14rem,26vw,32rem)]" title={p.title}>{p.title}</span>
                        {p.isNew ? <StatusPill tone="success" dot={false}>Yeni</StatusPill> : null}
                        {p.isClosed ? <StatusPill tone="warning" dot={false}>Kapalı portföy</StatusPill> : null}
                      </p>
                      <p className="mt-0.5 truncate text-xs text-text-muted">
                        <span className="numeric font-medium">{p.code}</span>
                        {p.subtitle ? ` · ${p.subtitle}` : ""}
                      </p>
                    </div>
                  </div>
                </TD>
                <TD>
                  {/* Kartta (<768 px) tip ve işlem tek satır: kart yüksekliği bir satır kısalır. */}
                  <p className="font-medium text-text max-md:inline">{p.type}</p>
                  <p className="text-xs text-text-muted max-md:ml-1.5 max-md:inline">{p.tx}</p>
                </TD>
                <TD stackHide className="hidden text-text-muted xl:table-cell">
                  <span className="flex items-center gap-1.5">
                    <SpriteIcon name="map-pin" className="h-3.5 w-3.5 shrink-0 text-text-faint" />
                    <span className="max-w-[10rem] truncate" title={p.location}>{p.location}</span>
                  </span>
                </TD>
                <TD align="right" className="font-semibold text-text">
                  {p.price}
                </TD>
                <TD>
                  <StatusPill tone={p.statusTone}>{p.statusLabel}</StatusPill>
                </TD>
                <TD stackHide className="hidden xl:table-cell">
                  {p.health ? <StatusPill tone={p.health.tone}>{p.health.label}</StatusPill> : <span className="text-text-faint">—</span>}
                </TD>
                <TD stackHide className="hidden 2xl:table-cell">
                  <PortalCell live={p.portalsLive} total={p.portalsTotal} />
                </TD>
                <TD stackHide className="numeric hidden text-text-muted 2xl:table-cell">{p.createdLabel}</TD>
                <TD actions>
                  <RowActions>
                    <RowActionLink href={p.href} label={`${p.title} detayını aç`} icon={Eye} hideWhenStacked />
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

