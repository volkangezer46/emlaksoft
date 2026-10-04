"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { CheckCircle2, ClipboardCheck } from "lucide-react";
import { updateAppointmentStatus } from "@/app/actions/appointments";
import {
  APPOINTMENT_OUTCOMES,
  APPOINTMENT_OUTCOME_META,
  type AppointmentOutcome,
} from "@/lib/appointment-outcome";
import { InlineTabbedPanel } from "@/components/ui/inline-tabbed-panel";

/**
 * "Tamamlandı" artık düz bir damga değil: randevunun NASIL geçtiği sorulur
 * (olumlu / kararsız / olumsuz + kısa not). Sonuç `appointments.outcome` /
 * `outcome_note` kolonlarına yazılır (migration 126).
 *
 * Popup yok: sayfa içi panel. Bu değerlendirme, müşteri portalındaki eşleştirme
 * geri bildirimiyle KARIŞTIRILMAMALIDIR. Sonuç seçmek zorunlu değildir.
 */
export function CompleteAppointmentDialog({
  appointmentId,
  customerName,
}: {
  appointmentId: string;
  customerName: string;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [outcome, setOutcome] = useState<AppointmentOutcome | "">("");
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  const submit = (fd: FormData) => {
    setError(null);
    startTransition(async () => {
      const note = String(fd.get("outcome_note") ?? "").trim();
      const out = new FormData();
      out.set("id", appointmentId);
      out.set("status", "completed");
      if (outcome) out.set("outcome", outcome);
      if (note) out.set("outcome_note", note);
      const res = await updateAppointmentStatus(out);
      if (res.error) {
        setError(res.error);
        return;
      }
      setOpen(false);
      setOutcome("");
      router.refresh();
    });
  };

  return (
    <InlineTabbedPanel
      open={open}
      onOpenChange={setOpen}
      title="Randevuyu tamamla"
      description={`${customerName} — randevu nasıl geçti? (isteğe bağlı)`}
      icon={<ClipboardCheck />}
      onSubmit={submit}
      pending={pending}
      error={error}
      submitLabel="Tamamla"
      pendingLabel="Kaydediliyor…"
      fieldLabels={{ outcome_note: "Kısa not" }}
      trigger={({ onClick, ...aria }) => (
        <button
          type="button"
          onClick={onClick}
          {...aria}
          className="inline-flex items-center gap-1 rounded-[var(--radius-control)] border border-line bg-canvas px-2.5 py-1.5 text-xs font-semibold text-brand-600 transition hover:border-brand-300"
        >
          <CheckCircle2 className="h-3 w-3" /> Tamamlandı
        </button>
      )}
      tabs={[{ id: "sonuc", label: "Sonuç", icon: ClipboardCheck, fields: ["outcome_note"] }]}
      panels={{
        sonuc: (
          <div className="space-y-4 sm:col-span-2">
            <div>
              <span className="text-xs font-semibold text-text-muted">Sonuç</span>
              <div className="mt-1.5 grid grid-cols-3 gap-2">
                {APPOINTMENT_OUTCOMES.map((key) => {
                  const meta = APPOINTMENT_OUTCOME_META[key];
                  const active = outcome === key;
                  return (
                    <button
                      key={key}
                      type="button"
                      aria-pressed={active}
                      onClick={() => setOutcome(active ? "" : key)}
                      className={`focus-ring press flex flex-col items-center gap-1 rounded-[var(--radius-card)] border px-3 py-3 text-xs font-semibold transition ${
                        active
                          ? "border-brand-400/60 bg-brand-600/8 text-brand-700"
                          : "border-line bg-canvas text-text-muted hover:border-brand-300 hover:text-ink-950"
                      }`}
                    >
                      <span className="text-lg" aria-hidden>{meta.emoji}</span>
                      {meta.label}
                    </button>
                  );
                })}
              </div>
              <p className="mt-1.5 text-xs text-text-faint">
                Seçmeden de tamamlayabilirsiniz. Bu değerlendirme danışman notudur; müşteri portalındaki
                eşleştirme beğenisinden bağımsızdır.
              </p>
            </div>
            <label className="block">
              <span className="text-xs font-semibold text-text-muted">Kısa not</span>
              <textarea
                name="outcome_note"
                rows={3}
                maxLength={500}
                placeholder="Örn. Müşteri konumu beğendi, fiyatta indirim bekliyor."
                className="mt-1 w-full resize-none rounded-[var(--radius-control)] border border-line bg-canvas px-3 py-2.5 text-sm outline-none transition focus:border-brand-400 focus:bg-surface"
              />
            </label>
          </div>
        ),
      }}
    />
  );
}
