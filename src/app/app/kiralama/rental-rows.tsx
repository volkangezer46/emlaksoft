import Link from "@/components/ui/smart-link";
import { Building2, Eye, KeyRound, User } from "lucide-react";
import { IntentLink } from "@/components/app/intent-link";
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

/** Sunuma hazır kira satır modeli (tablo + mobil liste ortak). */
export type RentalVM = {
  id: string;
  href: string;
  propertyId: string | null;
  propertyLabel: string | null;
  renterId: string | null;
  renterName: string | null;
  rent: string;
  /** Aktif kira için sonraki vade (okunur tarih); bitmişse null. */
  nextDue: string | null;
  duePast: boolean;
  active: boolean;
  evreLabel: string;
  evreTone: PillTone;
  endingSoon: boolean;
  overdue: boolean;
  maintenance: boolean;
};

const LINK = "focus-ring relative z-10 rounded-[var(--radius-control)] transition hover:text-brand-600 hover:underline";

function Flags({ r }: { r: RentalVM }) {
  return (
    <span className="inline-flex flex-wrap items-center gap-1.5">
      <StatusPill tone={r.active ? "success" : "neutral"}>{r.active ? "Aktif" : "Bitti"}</StatusPill>
      {r.endingSoon ? (
        <StatusPill tone="warning" dot={false}>
          Sözleşme bitiyor
        </StatusPill>
      ) : null}
      {r.overdue ? (
        <StatusPill tone="danger" dot={false}>
          Gecikme
        </StatusPill>
      ) : null}
      {r.maintenance ? (
        <StatusPill tone="warning" dot={false}>
          Arıza
        </StatusPill>
      ) : null}
    </span>
  );
}

/** md+ tablo görünümü. */
export function RentalTable({ rows, density }: { rows: RentalVM[]; density: Density }) {
  return (
    <div className="hidden md:block">
      <TableFrame minWidth={920} density={density} maxHeight="75vh">
        <Table>
          <THead sticky>
            <TR>
              <TH>Portföy</TH>
              <TH>Kiracı</TH>
              <TH align="right">Aylık kira</TH>
              <TH className="hidden lg:table-cell">Sonraki vade</TH>
              <TH>Durum</TH>
              <TH className="hidden xl:table-cell">Evre</TH>
              <TH align="right">
                <span className="sr-only">İşlemler</span>
              </TH>
            </TR>
          </THead>
          <TBody>
            {rows.map((r) => (
              <TR key={r.id} interactive>
                <TD>
                  <IntentLink href={r.href} className="absolute inset-0" aria-label={`${r.propertyLabel ?? "Kira kaydı"} kira detayını aç`} />
                  <div className="flex items-center gap-3">
                    <EntityThumb alt="" icon={KeyRound} size="sm" />
                    {r.propertyId ? (
                      <Link href={`/app/portfoyler/${r.propertyId}`} prefetch={false} className={`${LINK} max-w-[16rem] truncate font-semibold text-text`}>
                        {r.propertyLabel ?? "Portföy"}
                      </Link>
                    ) : (
                      <span className="max-w-[16rem] truncate font-semibold text-text">{r.propertyLabel ?? "—"}</span>
                    )}
                  </div>
                </TD>
                <TD>
                  {r.renterId ? (
                    <Link href={`/app/musteriler/${r.renterId}`} prefetch={false} className={`${LINK} font-medium text-text`}>
                      {r.renterName ?? "İsimsiz"}
                    </Link>
                  ) : (
                    <span className="text-text-faint">—</span>
                  )}
                </TD>
                <TD align="right" className="whitespace-nowrap font-semibold text-text">{r.rent}</TD>
                <TD className={`hidden lg:table-cell ${r.duePast ? "font-semibold text-[var(--danger-strong)]" : "text-text-muted"}`}>
                  {r.nextDue ?? <span className="text-text-faint">—</span>}
                </TD>
                <TD>
                  <Flags r={r} />
                </TD>
                <TD className="hidden xl:table-cell">
                  <StatusPill tone={r.evreTone} dot={false}>
                    {r.evreLabel}
                  </StatusPill>
                </TD>
                <TD>
                  <RowActions>
                    <RowActionLink href={r.href} label={`${r.propertyLabel ?? "Kira"} detayını aç`} icon={Eye} />
                    {r.propertyId ? <RowActionLink href={`/app/portfoyler/${r.propertyId}`} label={`${r.propertyLabel ?? "Portföy"} kaydını aç`} icon={Building2} /> : null}
                    {r.renterId ? <RowActionLink href={`/app/musteriler/${r.renterId}`} label={`${r.renterName ?? "Kiracı"} kartını aç`} icon={User} /> : null}
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
export function RentalMobileList({ rows }: { rows: RentalVM[] }) {
  return (
    <MobileCardList>
      {rows.map((r) => (
        <MobileCard key={r.id}>
          <div className="flex items-start gap-3">
            <EntityThumb alt="" icon={KeyRound} size="sm" />
            <div className="min-w-0 flex-1">
              <Link href={r.href} prefetch={false} className="focus-ring block truncate font-semibold text-text after:absolute after:inset-0">
                {r.propertyLabel ?? "Kira kaydı"}
              </Link>
              <p className="mt-0.5 truncate text-xs text-text-muted">
                {r.renterName ?? "Kiracı yok"}
                {r.nextDue ? ` · vade ${r.nextDue}` : ""}
              </p>
              <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
                <Flags r={r} />
                <span className="numeric text-sm font-semibold text-text">{r.rent}</span>
              </div>
            </div>
          </div>
        </MobileCard>
      ))}
    </MobileCardList>
  );
}
