"use client";

import { useState, useTransition } from "react";
import { CalendarClock, TriangleAlert } from "lucide-react";
import { updateAppointment } from "@/app/actions/appointments";
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogHeader,
  DialogTrigger,
} from "@/components/ui/dialog";

type TypeOption = { value: string; label: string };
type Appointment = {
  id: string;
  appointment_type: string;
  scheduled_at: string;
  duration_min: number | null;
  location: string | null;
  notes: string | null;
};

const DEFAULT_TYPES: TypeOption[] = [
  { value: "showing", label: "Yer gösterme" },
  { value: "office", label: "Ofis görüşmesi" },
  { value: "valuation", label: "Değerleme" },
  { value: "contract", label: "Sözleşme" },
];

// UTC ISO → yerel tarih & saat parçaları (kaymayı önlemek için yerel bileşenler)
function localParts(iso: string) {
  const d = new Date(iso);
  const pad = (n: number) => String(n).padStart(2, "0");
  const date = `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
  const time = `${pad(d.getHours())}:${pad(d.getMinutes())}`;
  return { date, time };
}

export function AppointmentEditDialog({
  appointment,
  typeOptions,
}: {
  appointment: Appointment;
  typeOptions?: TypeOption[];
}) {
  const [open, setOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // Çakışma freni: sunucu uyarı döndüyse kayıt YAPILMAMIŞTIR; amber bant
  // gösterilir ve gizli confirm_conflict=1 ile ikinci gönderim kaydeder.
  const [conflictWarning, setConflictWarning] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const types = typeOptions && typeOptions.length > 0 ? typeOptions : DEFAULT_TYPES;
  const { date, time } = localParts(appointment.scheduled_at);

  function onSubmit(fd: FormData) {
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

  /*
   * Radix Dialog'a taşındı. Elle kurulum Esc'i hallediyordu ama FOCUS TRAP ve
   * SCROLL LOCK yoktu. createPortal + useEffect + dialogRef üçlüsü de artık
   * gereksiz — Radix hepsini kendisi yapıyor.
   */
  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <button
          type="button"
          className="focus-ring press inline-flex items-center gap-1 rounded-[9px] border border-hairline bg-canvas px-2.5 py-1.5 text-[11px] font-semibold text-text-muted transition hover:border-brand-300"
        >
          <CalendarClock className="h-3 w-3" /> Ertele
        </button>
      </DialogTrigger>

      <DialogContent size="sm">
        <DialogHeader icon={<CalendarClock />} title="Randevuyu ertele / düzenle" />
        <form action={onSubmit} className="grid gap-3 p-4 md:p-6">
                <input type="hidden" name="id" value={appointment.id} />
                <select
                  name="appointment_type"
                  defaultValue={appointment.appointment_type}
                  className="rounded-[10px] border border-line bg-canvas px-3 py-2 text-sm outline-none focus:border-brand-300"
                >
                  {types.map((t) => (
                    <option key={t.value} value={t.value}>
                      {t.label}
                    </option>
                  ))}
                </select>
                <div className="grid grid-cols-2 gap-3">
                  <label className="text-xs font-semibold text-text-muted">
                    Tarih
                    <input
                      name="date"
                      type="date"
                      required
                      defaultValue={date}
                      className="mt-1 w-full rounded-[10px] border border-line bg-canvas px-3 py-2 text-sm outline-none focus:border-brand-300"
                    />
                  </label>
                  <label className="text-xs font-semibold text-text-muted">
                    Saat
                    <input
                      name="time"
                      type="time"
                      required
                      defaultValue={time}
                      className="mt-1 w-full rounded-[10px] border border-line bg-canvas px-3 py-2 text-sm outline-none focus:border-brand-300"
                    />
                  </label>
                </div>
                <div className="grid grid-cols-2 gap-3">
                  <input
                    name="duration_min"
                    type="number"
                    min="0"
                    step="5"
                    defaultValue={appointment.duration_min ?? ""}
                    placeholder="Süre (dk)"
                    className="rounded-[10px] border border-line bg-canvas px-3 py-2 text-sm outline-none focus:border-brand-300"
                  />
                  <input
                    name="location"
                    defaultValue={appointment.location ?? ""}
                    placeholder="Konum"
                    className="rounded-[10px] border border-line bg-canvas px-3 py-2 text-sm outline-none focus:border-brand-300"
                  />
                </div>
                <textarea
                  name="notes"
                  rows={2}
                  defaultValue={appointment.notes ?? ""}
                  placeholder="Not (opsiyonel)"
                  className="rounded-[10px] border border-line bg-canvas px-3 py-2 text-sm outline-none focus:border-brand-300"
                />
          {/* Çakışma freni bandı — kayıt yapılmadı, ikinci gönderim confirm_conflict ile geçer */}
          {conflictWarning && (
            <div
              className="flex items-start gap-2.5 rounded-[12px] border border-amber-400/50 bg-amber-400/10 px-4 py-3 text-xs font-medium leading-relaxed text-amber-700"
              role="alert"
            >
              <TriangleAlert className="mt-0.5 h-4 w-4 shrink-0 text-amber-500" />
              <span>
                <strong>{conflictWarning}</strong> Değişiklik henüz kaydedilmedi — yine de istiyorsanız
                &quot;Yine de kaydet&quot; ile devam edin.
              </span>
              <input type="hidden" name="confirm_conflict" value="1" />
            </div>
          )}
          {/* Palet dışı red-600 → danger-600, role="alert" eklendi */}
          {error && (
            <p className="text-xs font-semibold text-danger-600" role="alert">{error}</p>
          )}
          <div className="hairline-t mt-1 flex justify-end gap-2 pt-4">
            <DialogClose asChild>
              <button
                type="button"
                className="focus-ring press rounded-[10px] border border-hairline px-4 py-2 text-sm font-semibold text-text-muted transition hover:bg-canvas"
              >
                Vazgeç
              </button>
            </DialogClose>
            <button
              type="submit"
              disabled={pending}
              className="btn-shine focus-ring press rounded-[10px] bg-brand-600 px-4 py-2 text-sm font-semibold text-white transition hover:bg-brand-700 disabled:opacity-60"
            >
              {pending ? "Kaydediliyor…" : conflictWarning ? "Yine de kaydet" : "Kaydet"}
            </button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}
