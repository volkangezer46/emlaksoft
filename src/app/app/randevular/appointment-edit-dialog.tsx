"use client";

import { formatTrTime, trDayKey } from "@/lib/clock";
import { useState, useTransition } from "react";
import { CalendarClock, MapPin, TriangleAlert, UsersRound } from "lucide-react";
import { searchCustomers, searchProperties } from "@/app/actions/lookup";
import { Combobox } from "@/components/ui/combobox";
import { updateAppointment } from "@/app/actions/appointments";
import { DEFAULT_DEFINITIONS } from "@/lib/definition-defaults";
import { InlineTabbedPanel } from "@/components/ui/inline-tabbed-panel";
import { VoiceNoteRecorder } from "@/components/app/voice-note-recorder";

type TypeOption = { value: string; label: string };
type Appointment = {
  id: string;
  appointment_type: string;
  scheduled_at: string;
  duration_min: number | null;
  location: string | null;
  notes: string | null;
  assigned_to: string | null;
  customer_id: string | null;
  customer_label: string | null;
  property_id: string | null;
  property_label: string | null;
};

const DEFAULT_TYPES: TypeOption[] = [...DEFAULT_DEFINITIONS.appointment_type];

// UTC ISO → Türkiye duvar saati tarih & saat parçaları (tarayıcı saat diliminden bağımsız;
// sunucu eylemi de girdiyi +03:00 olarak yorumlar).
function localParts(iso: string) {
  return { date: trDayKey(iso), time: formatTrTime(iso) };
}

export function AppointmentEditDialog({
  appointment,
  typeOptions,
  advisors,
}: {
  appointment: Appointment;
  typeOptions?: TypeOption[];
  /** Yalnız yönetim katmanında dolu; danışman değiştirme seçicisi. */
  advisors?: { id: string; label: string }[];
}) {
  const [open, setOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // Çakışma freni: sunucu uyarı döndüyse kayıt YAPILMAMIŞTIR; amber bant
  // gösterilir ve gizli confirm_conflict=1 ile ikinci gönderim kaydeder.
  const [conflictWarning, setConflictWarning] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const types = typeOptions && typeOptions.length > 0 ? typeOptions : DEFAULT_TYPES;
  const { date, time } = localParts(appointment.scheduled_at);

  function submit(fd: FormData) {
    setError(null);
    startTransition(async () => {
      const res = await updateAppointment(fd);
      if (res?.conflictWarning) {
        setConflictWarning(res.conflictWarning);
        return;
      }
      setConflictWarning(null);
      if (res?.error) setError(res.error);
      else setOpen(false);
    });
  }

  const fieldClass =
    "w-full rounded-[var(--radius-control)] border border-line bg-canvas px-3 py-2 text-sm outline-none focus:border-brand-300";
  /* Popup yok: sayfa içi sekme alanı. onSubmit kipi: hatada/çakışmada girilen değerler korunur. */
  return (
    <InlineTabbedPanel
      open={open}
      onOpenChange={setOpen}
      title="Randevuyu ertele / düzenle"
      icon={<CalendarClock />}
      onSubmit={submit}
      pending={pending}
      error={error}
      submitLabelOverride={conflictWarning ? "Yine de kaydet" : undefined}
      hiddenFields={<input type="hidden" name="id" value={appointment.id} />}
      fieldLabels={{ appointment_type: "Tür", date: "Tarih", time: "Saat", duration_min: "Süre (dk)", assigned_to: "Danışman", customer_id: "Müşteri", property_id: "Portföy", location: "Konum", notes: "Not" }}
      trigger={({ onClick, ...aria }) => (
        <button
          type="button"
          onClick={onClick}
          {...aria}
          className="focus-ring press inline-flex items-center gap-1 rounded-[var(--radius-control)] border border-hairline bg-canvas px-2.5 py-1.5 text-xs font-semibold text-text-muted transition hover:border-brand-300"
        >
          <CalendarClock className="h-3 w-3" /> Ertele
        </button>
      )}
      notice={
        conflictWarning ? (
          <div
            className="mt-4 flex items-start gap-2.5 rounded-[var(--radius-card)] border border-amber-400/50 bg-amber-400/10 px-4 py-3 text-xs font-medium leading-relaxed text-amber-700"
            role="alert"
          >
            <TriangleAlert className="mt-0.5 h-4 w-4 shrink-0 text-amber-500" />
            <span>
              <strong>{conflictWarning}</strong> Değişiklik henüz kaydedilmedi — yine de istiyorsanız
              &quot;Yine de kaydet&quot; ile devam edin.
            </span>
            <input type="hidden" name="confirm_conflict" value="1" />
          </div>
        ) : null
      }
      tabs={[
        { id: "zaman", label: "Zaman", icon: CalendarClock, fields: ["appointment_type", "date", "time", "duration_min"] },
        { id: "katilimci", label: "Katılımcılar", icon: UsersRound, fields: [...(advisors && advisors.length > 0 ? ["assigned_to"] : []), "customer_id", "property_id"] },
        { id: "detay", label: "Konum ve not", icon: MapPin, fields: ["location", "notes"] },
      ]}
      panels={{
        zaman: (
          <>
            <label className="text-xs font-semibold text-text-muted sm:col-span-2">
              Tür
              <select name="appointment_type" defaultValue={appointment.appointment_type} className={`mt-1 ${fieldClass}`}>
                {types.map((t) => (
                  <option key={t.value} value={t.value}>{t.label}</option>
                ))}
              </select>
            </label>
            <label className="text-xs font-semibold text-text-muted">
              Tarih
              <input name="date" type="date" required defaultValue={date} className={`mt-1 ${fieldClass}`} />
            </label>
            <label className="text-xs font-semibold text-text-muted">
              Saat
              <input name="time" type="time" required defaultValue={time} className={`mt-1 ${fieldClass}`} />
            </label>
            <label className="text-xs font-semibold text-text-muted">
              Süre (dk)
              <input name="duration_min" type="number" min="0" step="5" defaultValue={appointment.duration_min ?? ""} className={`mt-1 ${fieldClass}`} />
            </label>
          </>
        ),
        katilimci: (
          <>
            {advisors && advisors.length > 0 ? (
              <label className="text-xs font-semibold text-text-muted sm:col-span-2">
                Danışman
                <select name="assigned_to" defaultValue={appointment.assigned_to ?? ""} className={`mt-1 ${fieldClass}`}>
                  {!appointment.assigned_to ? <option value="">Atanmamış</option> : null}
                  {advisors.map((a) => (
                    <option key={a.id} value={a.id}>{a.label}</option>
                  ))}
                </select>
              </label>
            ) : null}
            <div className="text-xs font-semibold text-text-muted">
              Müşteri
              <div className="mt-1">
                <Combobox
                  name="customer_id"
                  aria-label="Müşteri"
                  placeholder="Seçiniz"
                  searchPlaceholder="Müşteri ara…"
                  emptyText="Eşleşen müşteri yok"
                  onSearch={searchCustomers}
                  defaultValue={appointment.customer_id ?? ""}
                  options={appointment.customer_id ? [{ value: appointment.customer_id, label: appointment.customer_label ?? "Müşteri" }] : []}
                />
              </div>
            </div>
            <div className="text-xs font-semibold text-text-muted">
              Portföy
              <div className="mt-1">
                <Combobox
                  name="property_id"
                  aria-label="Portföy"
                  placeholder="Seçiniz"
                  searchPlaceholder="Portföy ara…"
                  emptyText="Eşleşen portföy yok"
                  onSearch={searchProperties}
                  defaultValue={appointment.property_id ?? ""}
                  options={appointment.property_id ? [{ value: appointment.property_id, label: appointment.property_label ?? "Portföy" }] : []}
                />
              </div>
            </div>
          </>
        ),
        detay: (
          <>
            <label className="text-xs font-semibold text-text-muted sm:col-span-2">
              Konum
              <input name="location" defaultValue={appointment.location ?? ""} className={`mt-1 ${fieldClass}`} />
            </label>
            <label className="text-xs font-semibold text-text-muted sm:col-span-2">
              Not
              <textarea name="notes" rows={3} defaultValue={appointment.notes ?? ""} placeholder="Not (opsiyonel)" className={`mt-1 ${fieldClass}`} />
            </label>
            <div className="sm:col-span-2"><VoiceNoteRecorder kind="appointment" id={appointment.id} /></div>
          </>
        ),
      }}
    />
  );
}
