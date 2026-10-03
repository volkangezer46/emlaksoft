"use client";

import { useState } from "react";
import { X } from "lucide-react";
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogTitle,
} from "@/components/ui/dialog";
import { LOSS_NOTE_MAX, LOSS_REASON_OTHER } from "@/lib/loss-reason";

export type LossReasonOption = { value: string; label: string };

/**
 * Kayıp nedeni diyaloğu: ofisin `loss_reason` tanım listesinden seçim zorunlu,
 * "Diğer" seçilirse not zorunlu, diğerlerinde not isteğe bağlıdır.
 * Sunucu (updateDealStage) aynı kuralı yeniden doğrular.
 */
export function LossReasonDialog({
  open,
  title,
  options,
  pending,
  onCancel,
  onConfirm,
  onCloseAutoFocus,
}: {
  open: boolean;
  title: string;
  options: LossReasonOption[];
  pending: boolean;
  onCancel: () => void;
  onConfirm: (value: string, note: string) => void;
  onCloseAutoFocus?: (event: Event) => void;
}) {
  return (
    <Dialog open={open} onOpenChange={(next) => { if (!next) onCancel(); }}>
      {open ? (
        <DialogContent
          size="sm"
          overlayClassName="bg-ink-950/40 backdrop-blur-sm"
          className="max-w-sm rounded-[var(--radius-panel)] border-line shadow-[var(--shadow-lg)]"
          onCloseAutoFocus={onCloseAutoFocus}
        >
          <LossReasonForm title={title} options={options} pending={pending} onConfirm={onConfirm} />
        </DialogContent>
      ) : null}
    </Dialog>
  );
}

function LossReasonForm({
  title,
  options,
  pending,
  onConfirm,
}: {
  title: string;
  options: LossReasonOption[];
  pending: boolean;
  onConfirm: (value: string, note: string) => void;
}) {
  // Form her açılışta yeniden bağlanır (open ? ... : null) → seçim/not sıfırdan başlar.
  const [value, setValue] = useState("");
  const [note, setNote] = useState("");
  const isOther = value === LOSS_REASON_OTHER;
  const missingNote = isOther && !note.trim();
  const canSubmit = Boolean(value) && !missingNote && !pending;

  return (
    <>
      <div className="flex items-center justify-between border-b border-line px-6 py-4">
        <DialogTitle className="font-display text-lg font-bold text-ink-950">Kayıp nedeni</DialogTitle>
        <DialogClose asChild>
          <button type="button" className="grid h-8 w-8 place-items-center rounded-[var(--radius-control)] text-text-muted hover:bg-canvas" aria-label="Kapat">
            <X className="h-5 w-5" />
          </button>
        </DialogClose>
      </div>
      <div className="space-y-4 p-6">
        <DialogDescription className="text-sm text-text-muted">{title} neden kaybedildi? Bir neden seçmek zorunludur.</DialogDescription>
        <div className="flex flex-wrap gap-1.5" role="group" aria-label="Kayıp nedeni seçenekleri">
          {options.map((o) => (
            <button
              key={o.value}
              type="button"
              aria-pressed={value === o.value}
              onClick={() => setValue(o.value)}
              className={`rounded-full px-2.5 py-1 text-xs font-semibold transition ${value === o.value ? "bg-danger-500 text-white" : "border border-line text-text-muted hover:border-danger-500/40"}`}
            >
              {o.label}
            </button>
          ))}
        </div>
        <div>
          <label htmlFor="loss-note" className="mb-1 block text-xs text-text-muted">
            Not {isOther ? <span className="font-semibold text-danger-500">(zorunlu)</span> : <span className="text-text-faint">(isteğe bağlı)</span>}
          </label>
          <textarea
            id="loss-note"
            value={note}
            onChange={(e) => setNote(e.target.value)}
            maxLength={LOSS_NOTE_MAX}
            rows={2}
            aria-required={isOther}
            aria-invalid={missingNote}
            placeholder={isOther ? "Nedeni kısaca açıklayın…" : "Ek açıklama…"}
            className="w-full resize-none rounded-[var(--radius-control)] border border-line bg-canvas px-3 py-2.5 text-sm outline-none focus:border-danger-400"
          />
          {missingNote ? <p role="alert" className="mt-1 text-xs text-danger-500">“Diğer” için açıklama notu gerekli.</p> : null}
        </div>
        <div className="flex justify-end gap-2">
          <DialogClose asChild>
            <button type="button" className="rounded-[var(--radius-control)] border border-line px-4 py-2.5 text-sm font-semibold text-text-muted hover:bg-canvas">Vazgeç</button>
          </DialogClose>
          <button
            type="button"
            disabled={!canSubmit}
            onClick={() => onConfirm(value, note.trim())}
            className="rounded-[var(--radius-control)] bg-danger-500 px-4 py-2.5 text-sm font-semibold text-white hover:bg-danger-600 disabled:opacity-60"
          >
            Kayıp olarak işaretle
          </button>
        </div>
      </div>
    </>
  );
}
