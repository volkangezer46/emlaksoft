import Link from "next/link";
import { AlertTriangle, CheckCircle2, Clock3, Eye, FileSignature, MapPin, Undo2, XCircle } from "lucide-react";
import { setAppointmentStatus } from "@/app/actions/appointments";
import { AddToCalendarButton } from "@/components/app/add-to-calendar-button";
import { IntentLink } from "@/components/app/intent-link";
import { Table, TableFrame, TBody, TD, TH, THead, TR } from "@/components/ui/table";
import { EntityThumb, RowActionLink, RowActions, StatusPill, type Density, type PillTone } from "@/components/ui/list-kit";
import type { CalendarEvent } from "@/lib/calendar";
import { CompleteAppointmentDialog } from "./complete-appointment-dialog";
import { AppointmentEditDialog } from "./appointment-edit-dialog";
import { CopyConfirmLink } from "./copy-confirm-link";

/** Sunuma hazır randevu satır modeli (tablo + mobil liste ortak). */
export type AppointmentVM = {
  id: string;
  /** Tür/durum sözleşmesi için ham değerler. */
  status: string;
  dateLabel: string;
  timeLabel: string;
  customerId: string | null;
  customerName: string;
  /** Satır linki: müşteri kartı, yoksa portföy; ikisi de yoksa null. */
  cardHref: string | null;
  typeLabel: string;
  typeTone: PillTone;
  propertyId: string | null;
  propertyName: string;
  location: string | null;
  durationMin: number | null;
  onLeave: boolean;
  statusLabel: string;
  statusTone: PillTone;
  /** Müşterinin teyit yanıtı (Geliyorum / İptal etti). */
  response: { label: string; tone: PillTone } | null;
  outcome: { label: string; emoji: string; tone: PillTone; note: string | null } | null;
  /** Geçmişte kalmış ama teyit/imza bekleyen. */
  followUp: boolean;
  confirmToken: string | null;
  isShowing: boolean;
  tutanakHref: string;
  edit: { id: string; appointment_type: string; scheduled_at: string; duration_min: number | null; location: string | null; notes: string | null };
  calendarEvent: CalendarEvent;
};

type TypeOption = { value: string; label: string };

const FORM_ICON_BTN =
  "focus-ring press grid h-8 w-8 place-items-center rounded-[var(--radius-control)] border border-transparent transition hover:border-line hover:bg-canvas";

function StatusForm({ id, status, label, className, children }: { id: string; status: "confirmed" | "cancelled"; label: string; className: string; children: React.ReactNode }) {
  return (
    <form action={setAppointmentStatus}>
      <input type="hidden" name="id" value={id} />
      <input type="hidden" name="status" value={status} />
      <button type="submit" aria-label={label} title={label} className={`${FORM_ICON_BTN} ${className}`}>
        {children}
      </button>
    </form>
  );
}

/** Satır eylemleri: onayla / tamamla (sonuç diyaloğu) / düzenle / iptal / teyit linki / tutanak. */
function Actions({ a, typeOptions, withCalendar }: { a: AppointmentVM; typeOptions: TypeOption[] | undefined; withCalendar: boolean }) {
  const completed = a.status === "completed";
  return (
    <div className="relative z-10 flex flex-wrap items-center justify-end gap-1.5">
      {!completed ? (
        <CompleteAppointmentDialog appointmentId={a.id} customerName={a.customerName} />
      ) : (
        /* Yanlış tamamlanan randevu kilitli değil: geri alma sonuç notunu da siler. */
        <form action={setAppointmentStatus}>
          <input type="hidden" name="id" value={a.id} />
          <input type="hidden" name="status" value="confirmed" />
          <button
            type="submit"
            title="Randevuyu tamamlanmamışa çevir (sonuç notu silinir)"
            className="focus-ring press inline-flex items-center gap-1 rounded-[var(--radius-control)] border border-line bg-canvas px-2.5 py-1.5 text-xs font-semibold text-text-muted transition hover:border-amber-400 hover:text-amber-600"
          >
            <Undo2 aria-hidden="true" className="h-3 w-3" /> Geri al
          </button>
        </form>
      )}
      {!completed ? <AppointmentEditDialog appointment={a.edit} typeOptions={typeOptions} /> : null}
      <RowActions>
        {a.cardHref ? <RowActionLink href={a.cardHref} label={`${a.customerName} randevusu detayı`} icon={Eye} /> : null}
        {a.status === "pending" ? (
          <StatusForm id={a.id} status="confirmed" label="Randevuyu onayla" className="text-[var(--success-strong)] hover:text-[var(--success-strong)]">
            <CheckCircle2 aria-hidden="true" className="h-4 w-4" />
          </StatusForm>
        ) : null}
        {!completed ? (
          <StatusForm id={a.id} status="cancelled" label="Randevuyu iptal et" className="text-[var(--danger-strong)] hover:text-[var(--danger-strong)]">
            <XCircle aria-hidden="true" className="h-4 w-4" />
          </StatusForm>
        ) : null}
        {a.isShowing ? <RowActionLink href={a.tutanakHref} label="Yer gösterme tutanağı oluştur" icon={FileSignature} /> : null}
      </RowActions>
      {!completed && a.confirmToken ? <CopyConfirmLink token={a.confirmToken} /> : null}
      {withCalendar ? <AddToCalendarButton event={a.calendarEvent} /> : null}
    </div>
  );
}

function Pills({ a }: { a: AppointmentVM }) {
  return (
    <span className="flex flex-wrap items-center gap-1.5">
      <StatusPill tone={a.statusTone}>{a.statusLabel}</StatusPill>
      {a.response ? (
        <StatusPill tone={a.response.tone} dot={false}>
          {a.response.label}
        </StatusPill>
      ) : null}
      {a.outcome ? (
        <span title={a.outcome.note ?? "Randevu sonucu"}>
          <StatusPill tone={a.outcome.tone} dot={false}>
            {a.outcome.emoji} {a.outcome.label}
          </StatusPill>
        </span>
      ) : null}
      {a.followUp ? (
        <StatusPill tone="warning" dot={false} title="Tarihi geçti, teyit/imza hâlâ bekliyor">
          Takip gerekli
        </StatusPill>
      ) : null}
    </span>
  );
}

function LeaveFlag({ a }: { a: AppointmentVM }) {
  if (!a.onLeave) return null;
  return (
    <Link
      href="/app/ekip/izinler"
      className="relative z-10 inline-flex items-center gap-1 rounded-full bg-amber-400/15 px-2 py-0.5 text-xs font-bold text-amber-600 transition hover:bg-amber-400/25"
      title="Randevunun danışmanı o gün izinli — devretmeyi düşünün"
    >
      <AlertTriangle aria-hidden="true" className="h-3 w-3" /> Danışman izinde
    </Link>
  );
}

/** md+ tablo görünümü. */
export function AppointmentTable({ rows, density, typeOptions }: { rows: AppointmentVM[]; density: Density; typeOptions: TypeOption[] | undefined }) {
  return (
    <div className="hidden md:block">
      <TableFrame minWidth={1040} density={density} maxHeight="75vh">
        <Table>
          <THead sticky>
            <TR>
              <TH>Tarih · saat</TH>
              <TH>Müşteri · tür</TH>
              <TH className="hidden lg:table-cell">Portföy · konum</TH>
              <TH>Durum</TH>
              <TH align="right">
                <span className="sr-only">İşlemler</span>
              </TH>
            </TR>
          </THead>
          <TBody>
            {rows.map((a) => (
              // id: takvimdeki gün öğeleri #randevu-{id} çapasıyla buraya kaydırır
              <TR key={a.id} id={`randevu-${a.id}`} interactive className="scroll-mt-24 target:bg-brand-600/[0.06]">
                <TD className="w-28">
                  {a.cardHref ? <IntentLink href={a.cardHref} className="absolute inset-0" aria-label={`${a.customerName} randevusu detayı`} /> : null}
                  <p className="numeric font-display text-base font-extrabold text-ink-950">{a.timeLabel}</p>
                  <p className="text-xs uppercase tracking-[0.06em] text-text-faint">{a.dateLabel}</p>
                </TD>
                <TD>
                  <div className="flex items-center gap-3">
                    <EntityThumb alt="" name={a.customerName} size="sm" />
                    <div className="min-w-0">
                      <p className="max-w-[14rem] truncate font-semibold text-text">{a.customerName}</p>
                      <div className="mt-0.5">
                        <StatusPill tone={a.typeTone} dot={false}>
                          {a.typeLabel}
                        </StatusPill>
                      </div>
                    </div>
                  </div>
                </TD>
                <TD className="hidden lg:table-cell">
                  {a.propertyId ? (
                    <Link
                      href={`/app/portfoyler/${a.propertyId}`}
                      prefetch={false}
                      className="focus-ring relative z-10 block max-w-[16rem] truncate rounded-[var(--radius-control)] text-text-muted transition hover:text-brand-600 hover:underline"
                    >
                      {a.propertyName}
                    </Link>
                  ) : (
                    <p className="max-w-[16rem] truncate text-text-muted">{a.propertyName}</p>
                  )}
                  <div className="mt-0.5 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-text-faint">
                    {a.location ? (
                      <span className="inline-flex items-center gap-1">
                        <MapPin aria-hidden="true" className="h-3 w-3" /> {a.location}
                      </span>
                    ) : null}
                    {a.durationMin ? (
                      <span className="inline-flex items-center gap-1">
                        <Clock3 aria-hidden="true" className="h-3 w-3" /> {a.durationMin} dk
                      </span>
                    ) : null}
                    <LeaveFlag a={a} />
                  </div>
                </TD>
                <TD>
                  <Pills a={a} />
                </TD>
                <TD>
                  <Actions a={a} typeOptions={typeOptions} withCalendar={false} />
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
export function AppointmentMobileList({ rows, typeOptions }: { rows: AppointmentVM[]; typeOptions: TypeOption[] | undefined }) {
  return (
    <ul className="space-y-2.5 md:hidden">
      {rows.map((a) => (
        <li key={a.id} id={`randevu-m-${a.id}`} className="surface-card relative scroll-mt-24 rounded-[var(--radius-card)] p-3">
          <div className="flex items-start gap-3">
            <EntityThumb alt="" name={a.customerName} size="sm" />
            <div className="min-w-0 flex-1">
              {a.cardHref ? (
                <Link href={a.cardHref} prefetch={false} className="focus-ring block truncate font-semibold text-text after:absolute after:inset-0">
                  {a.customerName}
                </Link>
              ) : (
                <p className="truncate font-semibold text-text">{a.customerName}</p>
              )}
              <p className="numeric mt-0.5 text-xs text-text-muted">
                {a.dateLabel} · {a.timeLabel} · {a.typeLabel}
              </p>
              <p className="mt-0.5 truncate text-xs text-text-muted">{a.propertyName}</p>
              <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
                <Pills a={a} />
                <LeaveFlag a={a} />
              </div>
            </div>
          </div>
          <div className="mt-2 border-t border-line pt-2">
            <Actions a={a} typeOptions={typeOptions} withCalendar />
          </div>
        </li>
      ))}
    </ul>
  );
}
