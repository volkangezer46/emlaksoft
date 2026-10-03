import Link from "next/link";
import { CalendarPlus, Eye, Mail, MapPin, MessageCircle, Phone } from "lucide-react";
import { IntentLink } from "@/components/app/intent-link";
import { CustomerPortalLinkButton } from "@/components/app/portal-link-dialog";
import { Table, TableFrame, TBody, TD, TH, THead, TR } from "@/components/ui/table";
import {
  EntityThumb,
  RowActionAnchor,
  RowActionLink,
  RowActions,
  StatusPill,
  type Density,
  type PillTone,
} from "@/components/ui/list-kit";
import { CustomerRowCheckbox, CustomerSelectAllCheckbox } from "./customer-bulk-actions";
import { CustomerRowDelete } from "./customer-row-delete";
import { customerTypeTone } from "./customer-list-logic";

/** Sayfanın hazırladığı, sunuma hazır müşteri satır modeli. */
export type CustomerVM = {
  id: string;
  name: string;
  href: string;
  types: string[];
  tags: string[];
  heat: { label: string; tone: PillTone; title: string } | null;
  lead: { score: number; hot: boolean } | null;
  blacklist: boolean;
  sourceLabel: string | null;
  phone: string | null;
  phoneDisplay: string | null;
  telHref: string | null;
  waHref: string | null;
  email: string | null;
  province: string;
  advisor: string | null;
  lastContact: string | null;
  addedLabel: string;
  createdLabel: string;
};

function TypeCell({ types, tags }: { types: string[]; tags: string[] }) {
  return (
    <div className="flex flex-wrap items-center gap-1">
      {types.length > 0 ? (
        <StatusPill tone={customerTypeTone(types[0]!)} dot={false}>
          {types[0]}
        </StatusPill>
      ) : (
        <span className="text-text-faint">—</span>
      )}
      {types.length > 1 ? (
        <span className="text-xs font-semibold text-text-faint" title={types.slice(1).join(", ")}>
          +{types.length - 1}
        </span>
      ) : null}
      {tags.slice(0, 2).map((t) => (
        <span key={t} className="rounded-full border border-line px-2 py-0.5 text-xs font-medium text-text-muted">
          {t}
        </span>
      ))}
      {tags.length > 2 ? (
        <span className="text-xs font-semibold text-text-faint" title={tags.slice(2).join(", ")}>
          +{tags.length - 2}
        </span>
      ) : null}
    </div>
  );
}

function HeatCell({ c }: { c: CustomerVM }) {
  if (c.blacklist) return <StatusPill tone="danger">Kara liste</StatusPill>;
  return (
    <div className="flex items-center gap-1.5">
      {c.heat ? (
        <span title={c.heat.title}>
          <StatusPill tone={c.heat.tone}>{c.heat.label}</StatusPill>
        </span>
      ) : null}
      {c.lead ? (
        <span
          title={`Lead skoru: ${c.lead.score}`}
          className={`numeric rounded-full px-1.5 text-xs font-semibold ${c.lead.hot ? "tone-warning" : "bg-canvas text-text-faint"}`}
        >
          {c.lead.score}
        </span>
      ) : null}
    </div>
  );
}

/** md+ tablo görünümü. */
export function CustomerTable({
  rows,
  ids,
  canBulk,
  canEdit,
  canDelete,
  density,
  sortHeader,
}: {
  rows: CustomerVM[];
  ids: string[];
  canBulk: boolean;
  canEdit: boolean;
  canDelete: boolean;
  density: Density;
  /** Sıralanabilir başlık hücreleri (sayfa üretir: sıralama linkleri URL kontratına bağlı). */
  sortHeader: { name: React.ReactNode; created: React.ReactNode; nameSort?: "ascending" | "descending"; createdSort?: "ascending" | "descending" };
}) {
  return (
    <div className="hidden md:block">
      <TableFrame minWidth={canBulk ? 980 : 940} density={density} maxHeight="75vh">
        <Table>
          <THead sticky>
            <TR>
              {canBulk ? (
                <TH className="w-10">
                  <CustomerSelectAllCheckbox ids={ids} />
                </TH>
              ) : null}
              <TH aria-sort={sortHeader.nameSort}>{sortHeader.name}</TH>
              <TH>Tür</TH>
              <TH>Sıcaklık</TH>
              <TH>İletişim</TH>
              <TH className="hidden xl:table-cell">Danışman</TH>
              <TH className="hidden lg:table-cell">Son temas</TH>
              <TH className="hidden xl:table-cell" aria-sort={sortHeader.createdSort}>
                {sortHeader.created}
              </TH>
              <TH align="right">
                <span className="sr-only">İşlemler</span>
              </TH>
            </TR>
          </THead>
          <TBody>
            {rows.map((c) => (
              <TR key={c.id} interactive>
                {canBulk ? (
                  <TD className="w-10">
                    <CustomerRowCheckbox id={c.id} name={c.name} />
                  </TD>
                ) : null}
                <TD>
                  <IntentLink href={c.href} className="absolute inset-0" aria-label={`${c.name} detayları`} />
                  <div className="flex items-center gap-3">
                    <EntityThumb alt="" name={c.name} size="sm" />
                    <div className="min-w-0">
                      <p className="max-w-[14rem] truncate font-semibold text-text">{c.name}</p>
                      <p className="mt-0.5 flex items-center gap-1.5 truncate text-xs text-text-muted">
                        <span className="inline-flex items-center gap-1">
                          <MapPin aria-hidden="true" className="h-3 w-3 text-text-faint" />
                          {c.province}
                        </span>
                        {c.sourceLabel ? <span>· {c.sourceLabel}</span> : null}
                      </p>
                    </div>
                  </div>
                </TD>
                <TD>
                  <TypeCell types={c.types} tags={c.tags} />
                </TD>
                <TD>
                  <HeatCell c={c} />
                </TD>
                <TD>
                  {c.phoneDisplay ? (
                    <p className="numeric flex items-center gap-1.5 text-text-muted">
                      <Phone aria-hidden="true" className="h-3.5 w-3.5 text-brand-600" />
                      {c.phoneDisplay}
                    </p>
                  ) : (
                    <p className="text-text-faint">—</p>
                  )}
                  {c.email ? (
                    <p className="mt-0.5 flex max-w-[14rem] items-center gap-1.5 truncate text-xs text-text-faint">
                      <Mail aria-hidden="true" className="h-3 w-3 shrink-0" />
                      <span className="truncate">{c.email}</span>
                    </p>
                  ) : null}
                </TD>
                <TD className="hidden text-text-muted xl:table-cell">{c.advisor ?? <span className="text-text-faint">Atanmadı</span>}</TD>
                <TD className="hidden text-text-muted lg:table-cell">
                  {c.lastContact ?? <span className="text-text-faint">Temas yok</span>}
                </TD>
                <TD className="numeric hidden text-text-muted xl:table-cell">{c.createdLabel}</TD>
                <TD>
                  <RowActions>
                    <RowActionLink href={c.href} label={`${c.name} detayını aç`} icon={Eye} />
                    {c.telHref ? <RowActionAnchor href={c.telHref} label={`${c.name} numarasını ara`} icon={Phone} /> : null}
                    {c.waHref ? <RowActionLink href={c.waHref} label={`${c.name} ile WhatsApp görüşmesi`} icon={MessageCircle} external tone="success" /> : null}
                    <RowActionLink href={`/app/randevular/yeni?customer=${c.id}`} label={`${c.name} için randevu oluştur`} icon={CalendarPlus} />
                    {canEdit ? <CustomerPortalLinkButton customerId={c.id} customerName={c.name} phone={c.phone} /> : null}
                    {canDelete ? <CustomerRowDelete customerId={c.id} name={c.name} /> : null}
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

/** <md: tablo yerine dokunmatik dostu kart listesi; hızlı ara / WhatsApp / randevu eylemleri. */
export function CustomerMobileList({ rows }: { rows: CustomerVM[] }) {
  return (
    <ul className="space-y-2.5 md:hidden">
      {rows.map((c) => (
        <li key={c.id} className="surface-card relative rounded-[var(--radius-card)] p-3">
          <div className="flex items-start gap-3">
            <EntityThumb alt="" name={c.name} size="sm" />
            <div className="min-w-0 flex-1">
              <Link href={c.href} prefetch={false} className="focus-ring block truncate font-semibold text-text after:absolute after:inset-0">
                {c.name}
              </Link>
              <p className="mt-0.5 truncate text-xs text-text-muted">
                {c.province}
                {c.types[0] ? ` · ${c.types[0]}` : ""}
                {c.lastContact ? ` · Son temas: ${c.lastContact}` : ""}
              </p>
              <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
                <HeatCell c={c} />
              </div>
            </div>
          </div>
          {c.telHref || c.waHref ? (
            <div className="relative z-10 mt-2 flex items-center gap-1 border-t border-line pt-2">
              {c.telHref ? <RowActionAnchor href={c.telHref} label={`${c.name} numarasını ara`} icon={Phone} /> : null}
              {c.waHref ? <RowActionLink href={c.waHref} label={`${c.name} ile WhatsApp görüşmesi`} icon={MessageCircle} external tone="success" /> : null}
              <RowActionLink href={`/app/randevular/yeni?customer=${c.id}`} label={`${c.name} için randevu oluştur`} icon={CalendarPlus} />
              <span className="numeric ml-auto text-xs text-text-muted">{c.phoneDisplay}</span>
            </div>
          ) : null}
        </li>
      ))}
    </ul>
  );
}
