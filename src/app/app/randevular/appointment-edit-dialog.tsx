"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import { createPortal } from "react-dom";
import { CalendarClock, X } from "lucide-react";
import { updateAppointment } from "@/app/actions/appointments";

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
  const [pending, startTransition] = useTransition();
  const dialogRef = useRef<HTMLDivElement>(null);
  const types = typeOptions && typeOptions.length > 0 ? typeOptions : DEFAULT_TYPES;
  const { date, time } = localParts(appointment.scheduled_at);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    document.addEventListener("keydown", onKey);
    dialogRef.current?.focus();
    return () => document.removeEventListener("keydown", onKey);
  }, [open]);

  function onSubmit(fd: FormData) {
    setError(null);
    startTransition(async () => {
      const res = await updateAppointment(fd);
      if (res?.error) setError(res.error);
      else setOpen(false);
    });
  }

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="inline-flex items-center gap-1 rounded-[9px] border border-line bg-canvas px-2.5 py-1.5 text-[11px] font-semibold text-text-muted transition hover:border-brand-300"
      >
        <CalendarClock className="h-3 w-3" /> Ertele
      </button>

      {open &&
        typeof document !== "undefined" &&
        createPortal(
          <div
            className="fixed inset-0 z-50 grid place-items-center bg-ink-950/40 p-4 backdrop-blur-sm"
            onClick={(e) => e.target === e.currentTarget && setOpen(false)}
          >
            <div
              ref={dialogRef}
              role="dialog"
              aria-modal="true"
              aria-label="Randevu düzenle"
              tabIndex={-1}
              className="w-full max-w-md rounded-[20px] border border-line bg-surface p-5 shadow-xl outline-none"
            >
              <div className="mb-4 flex items-center justify-between">
                <h2 className="font-display font-bold text-ink-950">Randevuyu Ertele / Düzenle</h2>
                <button
                  type="button"
                  onClick={() => setOpen(false)}
                  className="grid h-8 w-8 place-items-center rounded-[9px] text-text-faint transition hover:bg-canvas"
                  aria-label="Kapat"
                >
                  <X className="h-4 w-4" />
                </button>
              </div>

              <form action={onSubmit} className="grid gap-3">
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
                {error && <p className="text-xs font-semibold text-red-600">{error}</p>}
                <div className="mt-1 flex justify-end gap-2">
                  <button
                    type="button"
                    onClick={() => setOpen(false)}
                    className="rounded-[10px] border border-line px-4 py-2 text-sm font-semibold text-text-muted transition hover:bg-canvas"
                  >
                    Vazgeç
                  </button>
                  <button
                    type="submit"
                    disabled={pending}
                    className="rounded-[10px] bg-brand-600 px-4 py-2 text-sm font-semibold text-white transition hover:bg-brand-700 disabled:opacity-60"
                  >
                    {pending ? "Kaydediliyor…" : "Kaydet"}
                  </button>
                </div>
              </form>
            </div>
          </div>,
          document.body,
        )}
    </>
  );
}
