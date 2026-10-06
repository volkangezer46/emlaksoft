import Link from "next/link";
import { Building2, Eye, FileSignature, User } from "lucide-react";
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

/** Sunuma hazır sözleşme satır modeli (tablo + mobil liste ortak). */
export type ContractVM = {
  id: string;
  href: string;
  title: string;
  typeLabel: string;
  statusLabel: string;
  statusTone: PillTone;
  /** "Yenileme yaklaşıyor · 5 gün" gibi ek uyarı kapsülü. */
  renewalLabel: string | null;
  expired: boolean;
  propertyId: string | null;
  propertyLabel: string | null;
  customerId: string | null;
  customerName: string | null;
  dateLabel: string;
};

const LINK = "focus-ring relative z-10 rounded-[var(--radius-control)] transition hover:text-brand-600 hover:underline";

function Flags({ c }: { c: ContractVM }) {
  return (
    <span className="flex flex-wrap items-center gap-1.5">
      <StatusPill tone={c.statusTone}>{c.statusLabel}</StatusPill>
      {c.renewalLabel ? (
        <StatusPill tone="warning" dot={false}>
          {c.renewalLabel}
        </StatusPill>
      ) : null}
      {c.expired ? (
        <StatusPill tone="danger" dot={false}>
          Süresi doldu
        </StatusPill>
      ) : null}
    </span>
  );
}

/** md+ tablo görünümü. */
export function ContractTable({ rows, density, selectable = false }: { rows: ContractVM[]; density: Density; selectable?: boolean }) {
  return (
    <div className="hidden md:block">
      <TableFrame minWidth={900} density={density} maxHeight="75vh">
        <Table>
          <THead sticky>
            <TR>
              {selectable ? (
                <TH className="w-10">
                  <BulkSelectAll ids={rows.map((r) => r.id)} noun="sözleşme" />
                </TH>
              ) : null}
              <TH>Sözleşme</TH>
              <TH>Tür</TH>
              <TH>Durum</TH>
              <TH className="hidden lg:table-cell">Taraf</TH>
              <TH className="hidden xl:table-cell">Tarih</TH>
              <TH align="right">
                <span className="sr-only">İşlemler</span>
              </TH>
            </TR>
          </THead>
          <TBody>
            {rows.map((c) => (
              <TR key={c.id} interactive>
                {selectable ? (
                  <TD>
                    <BulkRowCheckbox id={c.id} label={`${c.title} sözleşmesini`} />
                  </TD>
                ) : null}
                <TD>
                  <IntentLink href={c.href} className="absolute inset-0" aria-label={`${c.title} detayları`} />
                  <div className="flex items-center gap-3">
                    <EntityThumb alt="" icon={FileSignature} size="sm" />
                    <div className="min-w-0">
                      <p className="max-w-[18rem] truncate font-semibold text-text">{c.title}</p>
                      {c.propertyId ? (
                        <Link href={`/app/portfoyler/${c.propertyId}`} prefetch={false} className={`${LINK} mt-0.5 block max-w-[18rem] truncate text-xs text-text-muted`}>
                          {c.propertyLabel}
                        </Link>
                      ) : c.propertyLabel ? (
                        <p className="mt-0.5 max-w-[18rem] truncate text-xs text-text-muted">{c.propertyLabel}</p>
                      ) : null}
                    </div>
                  </div>
                </TD>
                <TD>
                  <StatusPill tone="neutral" dot={false}>
                    {c.typeLabel}
                  </StatusPill>
                </TD>
                <TD>
                  <Flags c={c} />
                </TD>
                <TD className="hidden lg:table-cell">
                  {c.customerId ? (
                    <Link href={`/app/musteriler/${c.customerId}`} prefetch={false} className={`${LINK} font-medium text-text`}>
                      {c.customerName ?? "Müşteri"}
                    </Link>
                  ) : (
                    <span className="text-text-faint">{c.customerName ?? "—"}</span>
                  )}
                </TD>
                <TD className="hidden text-text-muted xl:table-cell">{c.dateLabel}</TD>
                <TD>
                  <RowActions>
                    <RowActionLink href={c.href} label={`${c.title} detayını aç`} icon={Eye} />
                    {c.propertyId ? <RowActionLink href={`/app/portfoyler/${c.propertyId}`} label={`${c.propertyLabel ?? "Portföy"} kaydını aç`} icon={Building2} /> : null}
                    {c.customerId ? <RowActionLink href={`/app/musteriler/${c.customerId}`} label={`${c.customerName ?? "Müşteri"} kartını aç`} icon={User} /> : null}
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
export function ContractMobileList({ rows }: { rows: ContractVM[] }) {
  return (
    <MobileCardList>
      {rows.map((c) => (
        <MobileCard key={c.id}>
          <div className="flex items-start gap-3">
            <EntityThumb alt="" icon={FileSignature} size="sm" />
            <div className="min-w-0 flex-1">
              <Link href={c.href} prefetch={false} className="focus-ring block truncate font-semibold text-text after:absolute after:inset-0">
                {c.title}
              </Link>
              <p className="mt-0.5 truncate text-xs text-text-muted">
                {c.typeLabel}
                {c.customerName ? ` · ${c.customerName}` : ""} · {c.dateLabel}
              </p>
              <div className="mt-1.5">
                <Flags c={c} />
              </div>
            </div>
          </div>
        </MobileCard>
      ))}
    </MobileCardList>
  );
}
