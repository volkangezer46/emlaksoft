"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Check, ListPlus, NotebookPen } from "lucide-react";
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogHeader,
  DialogTrigger,
} from "@/components/ui/dialog";
import { createTask } from "@/app/actions/tasks";
import { appendCustomerNote } from "@/app/actions/customers";
import { daysFromNowIso } from "@/lib/clock";
import { useToast } from "@/components/app/toast-provider";

/**
 * Gelen kutusu satırı hızlı aksiyonları — yalnız MÜŞTERİSİ EŞLEŞMİŞ satırlarda,
 * "Yanıtla"nın yanında:
 *   - Görev oluştur: mevcut createTask action'ını çağıran mini dialog; başlık
 *     mesajdan ön dolu, termin varsayılan YARIN, görev müşteriye bağlı gider.
 *   - Nota ekle: mesaj metnini müşterinin notlarına tarih damgalı satır olarak
 *     EKLER (appendCustomerNote — mevcut not ezilmez). Geri alınamaz ama düşük
 *     riskli; ConfirmDialog yerine toast onayı yeter.
 *
 * İkisi de satır overlay linkinin üstünde kalmak için relative z-10; masaüstünde
 * satır hover'ında belirir, dokunmatikte hep görünür (.hover-action).
 */

const ROW_BTN =
  "focus-ring press hover-action relative z-10 grid h-8 w-8 place-items-center rounded-[9px] text-text-faint opacity-0 transition group-hover:opacity-100 disabled:cursor-not-allowed disabled:opacity-40";

const fieldClass =
  "w-full rounded-[10px] border border-line bg-canvas px-3 py-2.5 text-sm outline-none transition focus:border-brand-400 focus:bg-surface";

/** ISO anı datetime-local girdisinin beklediği yerel "YYYY-MM-DDTHH:mm" biçimine çevirir. */
function toLocalInput(iso: string): string {
  const d = new Date(iso);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

/** Yarın 09:00 — görev termini varsayılanı (dialog her açılışta tazelenir). */
function tomorrowDefault(): string {
  return `${toLocalInput(daysFromNowIso(1)).slice(0, 10)}T09:00`;
}

export function RowQuickActions({
  customerId,
  customerName,
  message,
}: {
  customerId: string;
  customerName: string;
  message: string;
}) {
  const router = useRouter();
  const { push } = useToast();

  // ---- Görev oluştur ------------------------------------------------------
  const [taskOpen, setTaskOpen] = useState(false);
  const [taskError, setTaskError] = useState<string | null>(null);
  const [taskPending, setTaskPending] = useState(false);
  // Ön dolu başlık: "Dönüş: {müşteri} — {mesajın ilk 60 karakteri}"
  const excerpt = message.length > 60 ? `${message.slice(0, 60)}…` : message;
  const [title, setTitle] = useState(`Dönüş: ${customerName} — ${excerpt}`);
  const [due, setDue] = useState("");

  async function submitTask(formData: FormData) {
    setTaskPending(true);
    setTaskError(null);
    const result = await createTask({}, formData);
    setTaskPending(false);
    if (result.ok) {
      setTaskOpen(false);
      push("Görev oluşturuldu", "ok");
      router.refresh();
      return;
    }
    setTaskError(result.error ?? "Görev oluşturulamadı.");
  }

  // ---- Nota ekle ----------------------------------------------------------
  const [notePending, startNote] = useTransition();
  const [noteDone, setNoteDone] = useState(false);

  function handleAppendNote() {
    if (notePending || noteDone) return;
    startNote(async () => {
      const result = await appendCustomerNote(customerId, message);
      if (result.error) {
        push(result.error, "err");
        return;
      }
      setNoteDone(true);
      push(`Mesaj ${customerName} notlarına eklendi`, "ok");
      router.refresh();
    });
  }

  return (
    <>
      <Dialog
        open={taskOpen}
        onOpenChange={(next) => {
          setTaskOpen(next);
          // Termin her açılışta tazelenir — varsayılan yarın 09:00.
          if (next) setDue(tomorrowDefault());
        }}
      >
        <DialogTrigger asChild>
          <button
            type="button"
            className={`${ROW_BTN} hover:bg-brand-600/10 hover:text-brand-600`}
            aria-label={`${customerName} için görev oluştur`}
            title="Görev oluştur"
          >
            <ListPlus className="h-4 w-4" />
          </button>
        </DialogTrigger>

        <DialogContent size="sm">
          <DialogHeader
            icon={<ListPlus />}
            title="Görev oluştur"
            description={`${customerName} için dönüş görevi planlayın; görev müşteriye bağlı açılır.`}
          />
          <form action={submitTask} className="space-y-4 p-6">
            {/* Görev müşteriye bağlı; tür sabit "takip" — mini dialog, alan azlığı bilinçli */}
            <input type="hidden" name="customer_id" value={customerId} />
            <input type="hidden" name="kind" value="followup" />
            <div>
              <label className="mb-1.5 block text-sm font-medium text-ink-950" htmlFor="quick-task-title">
                Başlık *
              </label>
              <input
                id="quick-task-title"
                name="title"
                required
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                className={fieldClass}
              />
            </div>
            <div>
              <label className="mb-1.5 block text-sm font-medium text-ink-950" htmlFor="quick-task-due">
                Termin
              </label>
              <input
                id="quick-task-due"
                name="due_at"
                type="datetime-local"
                value={due}
                onChange={(e) => setDue(e.target.value)}
                className={fieldClass}
              />
              <p className="mt-1 text-[11px] text-text-faint">Varsayılan: yarın 09:00</p>
            </div>
            <div>
              <label className="mb-1.5 block text-sm font-medium text-ink-950" htmlFor="quick-task-notes">
                Not
              </label>
              <textarea
                id="quick-task-notes"
                name="notes"
                rows={2}
                defaultValue={message}
                className={`${fieldClass} resize-none`}
              />
            </div>

            {taskError ? (
              <p className="text-sm text-danger-500" role="alert">
                {taskError}
              </p>
            ) : null}

            <div className="hairline-t flex justify-end gap-2 pt-4">
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
                disabled={taskPending}
                className="btn-shine focus-ring press inline-flex items-center gap-2 rounded-[10px] bg-brand-600 px-4 py-2 text-sm font-semibold text-white transition hover:bg-brand-700 disabled:opacity-50"
              >
                <Check className="h-4 w-4" /> {taskPending ? "Oluşturuluyor…" : "Görevi oluştur"}
              </button>
            </div>
          </form>
        </DialogContent>
      </Dialog>

      <button
        type="button"
        onClick={handleAppendNote}
        disabled={notePending || noteDone}
        className={`${ROW_BTN} ${noteDone ? "text-mint-600" : "hover:bg-amber-400/15 hover:text-amber-600"}`}
        aria-label={`Mesajı ${customerName} notlarına ekle`}
        title={noteDone ? "Nota eklendi" : "Nota ekle"}
      >
        {noteDone ? <Check className="h-4 w-4" /> : <NotebookPen className="h-4 w-4" />}
      </button>
    </>
  );
}
