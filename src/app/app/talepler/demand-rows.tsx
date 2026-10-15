import Link from "@/components/ui/smart-link";
import { Crosshair, Eye, User } from "lucide-react";
import { SpriteIcon } from "@/components/ui/icon-sprite";
import { DemandRowCheckbox, DemandSelectAllCheckbox } from "./demand-bulk";
import { IntentLink } from "@/components/app/intent-link";
import { Table, TableFrame, TBody, TD, TH, THead, TR } from "@/components/ui/table";
import {
  EntityThumb,
  RowActionLink,
  RowActions,
  StatusPill,
  type Density,
  type PillTone,
} from "@/components/ui/list-kit";

/** Sunuma hazır talep satır modeli (tablo + mobil liste ortak). */
export type DemandVM = {
  id: string;
  href: string;
  customerId: string | null;
  customerName: string | null;
  /** "Satılık · Daire" */
  kind: string;
  budget: string;
  province: string | null;
  /** Kriter özetleri: oda, min m² … (satırda kapsül olarak çizilir). */
  criteria: string[];
  statusLabel: string;
  statusTone: PillTone;
  urgencyLabel: string | null;
  urgencyTone: PillTone;
  /** Eşleşme özeti (TEK okuyucu, gizlenenler hariç): kapalı talepte ya da aday okunamadıysa null. */
  match: { shown: number; strong: number; good: number; best: number } | null;
  ageLabel: string;
  /** Acil ve açık talep: yaş etiketi vurgulanır. */
  ageUrgent: boolean;
  advisor: string | null;
};

/**
 * Eşleşme sütunu (CRM-G6): uygun portföy sayısı (güçlü olanlar vurgulu) → talebe süzülü Eşleşme sekmesi; sıfırsa
 * "Kriteri genişlet" önerisine (talep detayı) gider. Mobilde aynı rozet müşteri adının altına iner.
 */
function MatchPill({ d }: { d: DemandVM }) {
  const m = d.match;
  if (!m) return <span className="text-text-faint">—</span>;
  if (m.shown > 0) {
    const label = m.strong > 0 ? `${m.shown} eşleşme · ${m.strong} güçlü` : `${m.shown} eşleşme`;
    return (
      <Link
        href={`/app/talepler?sekme=eslesme&demand=${d.id}`}
        prefetch={false}
        title={`En iyi skor ${m.best} · eşleştirmede aç`}
        className={`focus-ring relative z-10 inline-flex min-h-7 items-center gap-1 whitespace-nowrap rounded-full px-2.5 text-xs font-semibold transition hover:opacity-80 touch:min-h-11 ${m.strong > 0 ? "tone-success" : m.good > 0 ? "tone-info" : "tone-neutral"}`}
      >
        <SpriteIcon name="sparkles" className="h-3 w-3" />
        {label}
      </Link>
    );
  }
  return (
    <Link
      href={`/app/talepler/${d.id}#kriter-genislet`}
      prefetch={false}
      title="Uygun portföy yok: kriteri genişletme önerilerini görün"
      className="focus-ring relative z-10 inline-flex min-h-7 items-center gap-1 whitespace-nowrap rounded-full border border-dashed border-line-strong px-2.5 text-xs font-semibold text-text-muted transition hover:border-brand-300 hover:text-brand-600 touch:min-h-11"
    >
      Eşleşme yok · genişlet
    </Link>
  );
}

function CriteriaPills({ items }: { items: string[] }) {
  if (items.length === 0) return null;
  return (
    <>
      {items.map((c) => (
        <span key={c} className="rounded-full border border-line px-2 py-0.5 text-xs font-medium text-text-muted">
          {c}
        </span>
      ))}
    </>
  );
}

/** md+ tablo görünümü. */
export function DemandTable({ rows, density, canBulk = false }: { rows: DemandVM[]; density: Density; canBulk?: boolean }) {
  return (
    <div>
      <TableFrame stack minWidth={960} density={density} maxHeight="75vh">
        <Table>
          <THead sticky>
            <TR>
              {canBulk ? (
                <TH className="w-10">
                  <DemandSelectAllCheckbox ids={rows.map((d) => d.id)} />
                </TH>
              ) : null}
              <TH>Müşteri · talep</TH>
              <TH align="right">Bütçe</TH>
              <TH className="hidden lg:table-cell">Konum · kriter</TH>
              <TH>Durum</TH>
              <TH className="hidden xl:table-cell">Eşleşme</TH>
              <TH className="hidden 2xl:table-cell">Danışman</TH>
              <TH className="hidden xl:table-cell">Açık süre</TH>
              <TH align="right">
                <span className="sr-only">İşlemler</span>
              </TH>
            </TR>
          </THead>
          <TBody>
            {rows.map((d) => (
              <TR key={d.id} interactive>
                {canBulk ? (
                  <TD className="w-10">
                    <DemandRowCheckbox id={d.id} name={d.customerName ?? "Talep"} />
                  </TD>
                ) : null}
                <TD primary>
                  <IntentLink
                    href={d.href}
                    className="absolute inset-0"
                    aria-label={d.customerName ? `${d.customerName} talebinin detayını aç` : "Talep detayını aç"}
                  />
                  <div className="flex items-center gap-3">
                    <EntityThumb alt="" name={d.customerName ?? "Talep"} size="sm" />
                    <div className="min-w-0">
                      {d.customerId ? (
                        <Link
                          href={`/app/musteriler/${d.customerId}`}
                          prefetch={false}
                          className="focus-ring relative z-10 block max-w-[14rem] truncate rounded-[var(--radius-control)] font-semibold text-text hover:text-brand-600 hover:underline"
                        >
                          {d.customerName}
                        </Link>
                      ) : (
                        <p className="max-w-[14rem] truncate font-semibold text-text">{d.customerName ?? "Müşteri yok"}</p>
                      )}
                      <p className="mt-0.5 truncate text-xs text-text-muted">{d.kind}</p>
                      {d.match ? (
                        <div className="mt-1 xl:hidden">
                          <MatchPill d={d} />
                        </div>
                      ) : null}
                    </div>
                  </div>
                </TD>
                <TD align="right" className="whitespace-nowrap font-semibold text-text">{d.budget}</TD>
                <TD className="hidden lg:table-cell">
                  <div className="flex flex-wrap items-center gap-1.5">
                    {d.province ? (
                      <span className="inline-flex items-center gap-1 text-text-muted">
                        <SpriteIcon name="map-pin" className="h-3 w-3 text-text-faint" />
                        {d.province}
                      </span>
                    ) : null}
                    <CriteriaPills items={d.criteria} />
                    {!d.province && d.criteria.length === 0 ? <span className="text-text-faint">—</span> : null}
                  </div>
                </TD>
                <TD>
                  <div className="flex flex-wrap items-center gap-1">
                    <StatusPill tone={d.statusTone}>{d.statusLabel}</StatusPill>
                    {d.urgencyLabel ? (
                      <StatusPill tone={d.urgencyTone} dot={false}>
                        {d.urgencyLabel}
                      </StatusPill>
                    ) : null}
                  </div>
                </TD>
                <TD className="hidden xl:table-cell">
                  <MatchPill d={d} />
                </TD>
                <TD className="hidden text-text-muted 2xl:table-cell">{d.advisor ?? <span className="text-text-faint">Atanmadı</span>}</TD>
                <TD className="hidden xl:table-cell">
                  <span className={`inline-flex items-center gap-1 text-xs ${d.ageUrgent ? "font-semibold text-[var(--warning-strong)]" : "text-text-muted"}`}>
                    <SpriteIcon name="clock-3" className="h-3 w-3" /> {d.ageLabel}
                  </span>
                </TD>
                <TD actions>
                  <RowActions>
                    <RowActionLink href={d.href} label="Talep detayını aç" icon={Eye} />
                    {d.customerId ? <RowActionLink href={`/app/musteriler/${d.customerId}`} label={`${d.customerName ?? "Müşteri"} kartını aç`} icon={User} /> : null}
                    <RowActionLink href={`/app/talepler?sekme=eslesme&demand=${d.id}`} label="Bu talebi eşleştir" icon={Crosshair} />
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

