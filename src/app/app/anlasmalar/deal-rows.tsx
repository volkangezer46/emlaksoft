import Link from "next/link";
import { Building2, Eye, FileCheck2, Handshake, MessageSquare, User } from "lucide-react";
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

/** Sunuma hazır anlaşma satır modeli (tablo + mobil liste ortak). */
export type DealVM = {
  id: string;
  href: string;
  propertyId: string | null;
  propertyLabel: string | null;
  customerId: string | null;
  customerName: string | null;
  stageLabel: string;
  stageTone: PillTone;
  value: string | null;
  probability: number | null;
  advisor: string | null;
  updatedLabel: string;
  /** 14+ gündür güncellenmeyen açık anlaşma. */
  stale: boolean;
  checklist: { done: number; total: number } | null;
  noteCount: number;
};

const LINK = "focus-ring relative z-10 rounded-[var(--radius-control)] transition hover:text-brand-600 hover:underline";

function Badges({ d }: { d: DealVM }) {
  return (
    <span className="inline-flex items-center gap-2 text-xs text-text-muted">
      {d.checklist ? (
        <span className="inline-flex items-center gap-1" title={`Zorunlu evrak: ${d.checklist.done}/${d.checklist.total}`}>
          <FileCheck2 aria-hidden="true" className="h-3.5 w-3.5" />
          <span className="numeric">
            {d.checklist.done}/{d.checklist.total}
          </span>
        </span>
      ) : null}
      {d.noteCount > 0 ? (
        <span className="inline-flex items-center gap-1" title={`${d.noteCount} not`}>
          <MessageSquare aria-hidden="true" className="h-3.5 w-3.5" />
          <span className="numeric">{d.noteCount}</span>
        </span>
      ) : null}
    </span>
  );
}

/** md+ tablo görünümü. */
export function DealTable({ rows, density }: { rows: DealVM[]; density: Density }) {
  return (
    <div className="hidden md:block">
      <TableFrame minWidth={940} density={density} maxHeight="75vh">
        <Table>
          <THead sticky>
            <TR>
              <TH>Anlaşma</TH>
              <TH>Aşama</TH>
              <TH align="right">Değer</TH>
              <TH align="right" className="hidden lg:table-cell">Olasılık</TH>
              <TH className="hidden xl:table-cell">Danışman</TH>
              <TH className="hidden xl:table-cell">Güncelleme</TH>
              <TH align="right">
                <span className="sr-only">İşlemler</span>
              </TH>
            </TR>
          </THead>
          <TBody>
            {rows.map((d) => (
              <TR key={d.id} interactive>
                <TD>
                  <IntentLink href={d.href} className="absolute inset-0" aria-label={`${d.propertyLabel ?? d.customerName ?? "Anlaşma"} detayını aç`} />
                  <div className="flex items-center gap-3">
                    <EntityThumb alt="" icon={Handshake} size="sm" />
                    <div className="min-w-0">
                      {d.propertyId ? (
                        <Link href={`/app/portfoyler/${d.propertyId}`} prefetch={false} className={`${LINK} block max-w-[16rem] truncate font-semibold text-text`}>
                          {d.propertyLabel ?? "Portföy"}
                        </Link>
                      ) : (
                        <p className="max-w-[16rem] truncate font-semibold text-text">{d.propertyLabel ?? "Portföy bağlı değil"}</p>
                      )}
                      <p className="mt-0.5 flex items-center gap-2 truncate text-xs text-text-muted">
                        {d.customerId ? (
                          <Link href={`/app/musteriler/${d.customerId}`} prefetch={false} className={LINK}>
                            {d.customerName ?? "Müşteri"}
                          </Link>
                        ) : (
                          <span>{d.customerName ?? "Müşteri yok"}</span>
                        )}
                        <Badges d={d} />
                      </p>
                    </div>
                  </div>
                </TD>
                <TD>
                  <StatusPill tone={d.stageTone}>{d.stageLabel}</StatusPill>
                </TD>
                <TD align="right" className="whitespace-nowrap font-semibold text-text">{d.value ?? <span className="font-normal text-text-faint">—</span>}</TD>
                <TD align="right" className="hidden text-text-muted lg:table-cell">{d.probability != null ? `%${d.probability}` : <span className="text-text-faint">—</span>}</TD>
                <TD className="hidden text-text-muted xl:table-cell">{d.advisor ?? <span className="text-text-faint">Atanmadı</span>}</TD>
                <TD className="hidden xl:table-cell">
                  <span className={d.stale ? "font-semibold text-[var(--warning-strong)]" : "text-text-muted"} title={d.stale ? "14+ gündür güncellenmedi" : undefined}>
                    {d.updatedLabel}
                  </span>
                </TD>
                <TD>
                  <RowActions>
                    <RowActionLink href={d.href} label="Anlaşma detayını aç" icon={Eye} />
                    {d.propertyId ? <RowActionLink href={`/app/portfoyler/${d.propertyId}`} label={`${d.propertyLabel ?? "Portföy"} kaydını aç`} icon={Building2} /> : null}
                    {d.customerId ? <RowActionLink href={`/app/musteriler/${d.customerId}`} label={`${d.customerName ?? "Müşteri"} kartını aç`} icon={User} /> : null}
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
export function DealMobileList({ rows }: { rows: DealVM[] }) {
  return (
    <MobileCardList>
      {rows.map((d) => (
        <MobileCard key={d.id}>
          <div className="flex items-start gap-3">
            <EntityThumb alt="" icon={Handshake} size="sm" />
            <div className="min-w-0 flex-1">
              <Link href={d.href} prefetch={false} className="focus-ring block truncate font-semibold text-text after:absolute after:inset-0">
                {d.propertyLabel ?? d.customerName ?? "Anlaşma"}
              </Link>
              <p className="mt-0.5 truncate text-xs text-text-muted">
                {d.customerName ?? "Müşteri yok"} · {d.updatedLabel}
              </p>
              <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
                <StatusPill tone={d.stageTone}>{d.stageLabel}</StatusPill>
                {d.value ? <span className="numeric text-sm font-semibold text-text">{d.value}</span> : null}
                {d.probability != null ? <span className="numeric text-xs text-text-muted">%{d.probability}</span> : null}
                <Badges d={d} />
              </div>
            </div>
          </div>
        </MobileCard>
      ))}
    </MobileCardList>
  );
}
