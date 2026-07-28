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
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogBody,
  DialogClose,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTrigger,
} from "@/components/ui/dialog";

/**
 * "Tamamlandı" artık düz bir damga değil: randevunun NASIL geçtiği sorulur
 * (olumlu / kararsız / olumsuz + kısa not). Sonuç `appointments.outcome` /
 * `outcome_note` kolonlarına yazılır (migration 126).
 *
 * Bu değerlendirme, müşteri portalındaki eşleştirme geri bildirimiyle
 * (portal_match_feedback) KARIŞTIRILMAMALIDIR — eşleştirme skorunu etkilemez.
 * Sonuç seçmek zorunlu değildir; boş bırakılırsa randevu sadece tamamlanır.
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
  const [note, setNote] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  const submit = () => {
    setError(null);
    startTransition(async () => {
      const fd = new FormData();
      fd.set("id", appointmentId);
      fd.set("status", "completed");
      if (outcome) fd.set("outcome", outcome);
      if (note.trim()) fd.set("outcome_note", note.trim());
      const res = await updateAppointmentStatus(fd);
      if (res.error) {
        setError(res.error);
        return;
      }
      setOpen(false);
      setNote("");
      setOutcome("");
      router.refresh();
    });
  };

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <button
          type="button"
          className="inline-flex items-center gap-1 rounded-[9px] border border-line bg-canvas px-2.5 py-1.5 text-[11px] font-semibold text-brand-600 transition hover:border-brand-300"
        >
          <CheckCircle2 className="h-3 w-3" /> Tamamlandı
        </button>
      </DialogTrigger>
      <DialogContent size="md">
        <DialogHeader
          icon={<ClipboardCheck />}
          title="Randevuyu tamamla"
          description={`${customerName} — randevu nasıl geçti? (isteğe bağlı)`}
        />
        <DialogBody className="space-y-4">
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
                    className={`focus-ring press flex flex-col items-center gap-1 rounded-[12px] border px-3 py-3 text-xs font-semibold transition ${
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
            <p className="mt-1.5 text-[11px] text-text-faint">
              Seçmeden de tamamlayabilirsiniz. Bu değerlendirme danışman notudur; müşteri portalındaki
              eşleştirme beğenisinden bağımsızdır.
            </p>
          </div>
          <label className="block">
            <span className="text-xs font-semibold text-text-muted">Kısa not</span>
            <textarea
              value={note}
              onChange={(e) => setNote(e.target.value)}
              rows={3}
              maxLength={500}
              placeholder="Örn. Müşteri konumu beğendi, fiyatta indirim bekliyor."
              className="mt-1 w-full resize-none rounded-[11px] border border-line bg-canvas px-3 py-2.5 text-sm outline-none transition focus:border-brand-400 focus:bg-surface"
            />
          </label>
          {error ? <p className="text-sm font-semibold text-danger-500">{error}</p> : null}
        </DialogBody>
        <DialogFooter>
          <DialogClose asChild>
            <Button variant="secondary">Vazgeç</Button>
          </DialogClose>
          <Button type="button" onClick={submit} loading={pending}>
            Tamamla
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
