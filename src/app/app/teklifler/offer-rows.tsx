import Link from "next/link";
import { Building2, Eye, User } from "lucide-react";
import { IntentLink } from "@/components/app/intent-link";
import { BulkRowCheckbox, BulkSelectAll } from "@/components/app/bulk-selection";
import { Table, TableFrame, TBody, TD, TH, THead, TR } from "@/components/ui/table";
import {
  EntityThumb,
  MobileCard,
  MobileCardList,
  RowActionLink,
  RowActions,
  StatusPill,
  type Density,
  type PillTone,
} from "@/components/ui/list-kit";

/** Sayfanın hazırladığı, sunuma hazır teklif satır modeli (tablo + mobil liste ortak). */
export type OfferVM = {
  id: string;
  href: string;
  propertyId: string | null;
  propertyLabel: string | null;
  customerId: string | null;
  customerName: string | null;
  amount: string;
  counter: string | null;
  statusLabel: string;
  statusTone: PillTone;
  advisor: string | null;
  dateLabel: string;
  /** Açık teklifte geçerlilik bitimine yakınlık rozeti ("2 gün", "Süresi doldu"). */
  expiryLabel?: string | null;
  expiryTone?: "warn" | "danger" | null;
};

const LINK = "focus-ring relative z-10 rounded-[var(--radius-control)] transition hover:text-brand-600 hover:underline";

/** md+ tablo görünümü. */
export function OfferTable({ rows, density, selectable = false }: { rows: OfferVM[]; density: Density; selectable?: boolean }) {
  return (
    <div className="hidden md:block">
      <TableFrame minWidth={880} density={density} maxHeight="75vh">
        <Table>
          <THead sticky>
            <TR>
              {selectable ? (
                <TH className="w-10">
                  <BulkSelectAll ids={rows.map((r) => r.id)} noun="teklif" />
                </TH>
              ) : null}
              <TH>Portföy</TH>
              <TH>Müşteri</TH>
              <TH align="right">Teklif</TH>
              <TH align="right" className="hidden lg:table-cell">Karşı teklif</TH>
              <TH>Durum</TH>
              <TH className="hidden xl:table-cell">Danışman</TH>
              <TH align="right" className="hidden lg:table-cell">Tarih</TH>
              <TH align="right">
                <span className="sr-only">İşlemler</span>
              </TH>
            </TR>
          </THead>
          <TBody>
            {rows.map((o) => (
              <TR key={o.id} interactive>
                {selectable ? (
                  <TD>
                    <BulkRowCheckbox id={o.id} label={`${o.propertyLabel ?? "Teklif"} teklifini`} />
                  </TD>
                ) : null}
                <TD>
                  <IntentLink href={o.href} className="absolute inset-0" aria-label={`${o.propertyLabel ?? "Teklif"} teklif detayı`} />
                  <div className="flex items-center gap-3">
                    <EntityThumb alt="" icon={Building2} size="sm" />
                    {o.propertyId ? (
                      <Link href={`/app/portfoyler/${o.propertyId}`} prefetch={false} className={`${LINK} max-w-[16rem] truncate font-semibold text-text`}>
                        {o.propertyLabel ?? "Portföy"}
                      </Link>
                    ) : (
                      <span className="max-w-[16rem] truncate font-semibold text-text">{o.propertyLabel ?? "—"}</span>
                    )}
                  </div>
                </TD>
                <TD>
                  {o.customerId ? (
                    <Link href={`/app/musteriler/${o.customerId}`} prefetch={false} className={`${LINK} font-medium text-text`}>
                      {o.customerName ?? "Müşteri"}
                    </Link>
                  ) : (
                    <span className="text-text-muted">{o.customerName ?? "—"}</span>
                  )}
                </TD>
                <TD align="right" className="font-semibold text-text">{o.amount}</TD>
                <TD align="right" className="hidden text-text-muted lg:table-cell">{o.counter ?? <span className="text-text-faint">—</span>}</TD>
                <TD>
                  <StatusPill tone={o.statusTone}>{o.statusLabel}</StatusPill>
                  {o.expiryLabel ? (
                    <span className={`ml-1.5 text-xs font-semibold ${o.expiryTone === "danger" ? "text-danger-600" : "text-amber-700"}`}>{o.expiryLabel}</span>
                  ) : null}
                </TD>
                <TD className="hidden text-text-muted xl:table-cell">{o.advisor ?? <span className="text-text-faint">—</span>}</TD>
                <TD align="right" className="hidden text-text-muted lg:table-cell">{o.dateLabel}</TD>
                <TD>
                  <RowActions>
                    <RowActionLink href={o.href} label={`${o.propertyLabel ?? "Teklif"} teklif detayını aç`} icon={Eye} />
                    {o.customerId ? <RowActionLink href={`/app/musteriler/${o.customerId}`} label={`${o.customerName ?? "Müşteri"} kartını aç`} icon={User} /> : null}
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

/** <md: tablo yerine kart listesi. */
export function OfferMobileList({ rows }: { rows: OfferVM[] }) {
  return (
    <MobileCardList>
      {rows.map((o) => (
        <MobileCard key={o.id}>
          <div className="flex items-start gap-3">
            <EntityThumb alt="" icon={Building2} size="sm" />
            <div className="min-w-0 flex-1">
              <Link href={o.href} prefetch={false} className="focus-ring block truncate font-semibold text-text after:absolute after:inset-0">
                {o.propertyLabel ?? "Teklif"}
              </Link>
              <p className="mt-0.5 truncate text-xs text-text-muted">
                {o.customerName ?? "Müşteri yok"} · {o.dateLabel}
              </p>
              <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
                <StatusPill tone={o.statusTone}>{o.statusLabel}</StatusPill>
                <span className="numeric text-sm font-semibold text-text">{o.amount}</span>
                {o.counter ? <span className="numeric text-xs text-text-muted">karşı: {o.counter}</span> : null}
              </div>
            </div>
          </div>
        </MobileCard>
      ))}
    </MobileCardList>
  );
}
