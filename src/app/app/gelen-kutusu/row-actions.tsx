"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Check, ListPlus, NotebookPen } from "lucide-react";
import { InlinePanel, useInlinePanel } from "@/components/ui/inline-panel";
import { createTask } from "@/app/actions/tasks";
import { appendCustomerNote } from "@/app/actions/customers";
import { daysFromNowIso } from "@/lib/clock";
import { useToast } from "@/components/app/toast-provider";

/**
 * Gelen kutusu satırı hızlı aksiyonları — yalnız MÜŞTERİSİ EŞLEŞMİŞ satırlarda:
 *   - Görev oluştur: düğme satırın eylem kümesinde, form SAYFA İÇİ panelde (popup yok; `TaskPanel`).
 *     Başlık mesajdan ön dolu, termin varsayılan YARIN, görev müşteriye bağlı gider.
 *   - Nota ekle: mesaj metnini müşterinin notlarına tarih damgalı satır olarak EKLER (appendCustomerNote).
 */

const ROW_BTN =
  "focus-ring press relative z-10 grid h-8 w-8 place-items-center rounded-[var(--radius-control)] text-text-faint transition disabled:cursor-not-allowed disabled:opacity-40";

const fieldClass =
  "w-full rounded-[var(--radius-control)] border border-line bg-canvas px-3 py-2.5 text-sm outline-none transition focus:border-brand-400 focus:bg-surface";

/** ISO anı datetime-local girdisinin beklediği yerel "YYYY-MM-DDTHH:mm" biçimine çevirir. */
function toLocalInput(iso: string): string {
  const d = new Date(iso);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

/** Yarın 09:00 — görev termini varsayılanı. */
function tomorrowDefault(): string {
  return `${toLocalInput(daysFromNowIso(1)).slice(0, 10)}T09:00`;
}

export function RowQuickActions({
  customerId,
  customerName,
  message,
  taskPanelId,
}: {
  customerId: string;
  customerName: string;
  message: string;
  /** `TaskPanel` ile eşleşen panel kimliği (satır başına benzersiz). */
  taskPanelId: string;
}) {
  const router = useRouter();
  const { push } = useToast();
  const { open, toggle } = useInlinePanel(taskPanelId);

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
      <button
        type="button"
        aria-expanded={open}
        aria-controls={taskPanelId}
        onClick={(e) => toggle(e.currentTarget)}
        className={`${ROW_BTN} hover:bg-brand-600/10 hover:text-brand-600`}
        aria-label={`${customerName} için görev oluştur`}
        title="Görev oluştur"
      >
        <ListPlus className="h-4 w-4" />
      </button>
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

/** Satırın altında tam genişlikte açılan görev formu (sayfa içi panel). */
export function TaskPanel({
  panelId,
  customerId,
  customerName,
  message,
}: {
  panelId: string;
  customerId: string;
  customerName: string;
  message: string;
}) {
  return (
    <InlinePanel
      id={panelId}
      title="Görev oluştur"
      description={`${customerName} için dönüş görevi planlayın; görev müşteriye bağlı açılır.`}
      icon={<ListPlus />}
      className="relative z-10 w-full basis-full"
    >
      {(close) => <TaskForm customerId={customerId} customerName={customerName} message={message} close={close} />}
    </InlinePanel>
  );
}

function TaskForm({
  customerId,
  customerName,
  message,
  close,
}: {
  customerId: string;
  customerName: string;
  message: string;
  close: () => void;
}) {
  const router = useRouter();
  const { push } = useToast();
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const excerpt = message.length > 60 ? `${message.slice(0, 60)}…` : message;
  const [title, setTitle] = useState(`Dönüş: ${customerName} — ${excerpt}`);
  const [due, setDue] = useState(() => tomorrowDefault());

  async function submit(formData: FormData) {
    setPending(true);
    setError(null);
    const result = await createTask({}, formData);
    setPending(false);
    if (result.ok) {
      push("Görev oluşturuldu", "ok");
      close();
      router.refresh();
      return;
    }
    setError(result.error ?? "Görev oluşturulamadı.");
  }

  return (
    <form action={submit} className="space-y-3 p-4">
      <input type="hidden" name="customer_id" value={customerId} />
      <input type="hidden" name="kind" value="followup" />
      <div className="grid gap-3 sm:grid-cols-[2fr_1fr]">
        <div>
          <label className="mb-1.5 block text-sm font-medium text-ink-950" htmlFor={`task-title-${customerId}`}>
            Başlık *
          </label>
          <input
            id={`task-title-${customerId}`}
            name="title"
            required
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            className={fieldClass}
          />
        </div>
        <div>
          <label className="mb-1.5 block text-sm font-medium text-ink-950" htmlFor={`task-due-${customerId}`}>
            Termin
          </label>
          <input
            id={`task-due-${customerId}`}
            name="due_at"
            type="datetime-local"
            value={due}
            onChange={(e) => setDue(e.target.value)}
            className={fieldClass}
          />
        </div>
      </div>
      <div>
        <label className="mb-1.5 block text-sm font-medium text-ink-950" htmlFor={`task-notes-${customerId}`}>
          Not
        </label>
        <textarea
          id={`task-notes-${customerId}`}
          name="notes"
          rows={2}
          defaultValue={message}
          className={`${fieldClass} resize-none`}
        />
      </div>
      {error ? (
        <p className="text-sm text-danger-500" role="alert">
          {error}
        </p>
      ) : null}
      <div className="flex justify-end gap-2">
        <button
          type="button"
          onClick={close}
          className="focus-ring press rounded-[var(--radius-control)] border border-hairline px-4 py-2 text-sm font-semibold text-text-muted transition hover:bg-canvas"
        >
          Vazgeç
        </button>
        <button
          type="submit"
          disabled={pending}
          className="btn-shine focus-ring press inline-flex items-center gap-2 rounded-[var(--radius-control)] bg-brand-600 px-4 py-2 text-sm font-semibold text-white transition hover:bg-brand-700 disabled:opacity-50"
        >
          <Check className="h-4 w-4" /> {pending ? "Oluşturuluyor…" : "Görevi oluştur"}
        </button>
      </div>
    </form>
  );
}
