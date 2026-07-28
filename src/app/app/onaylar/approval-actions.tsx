"use client";

import { useActionState, useState } from "react";
import { Check, Loader2, Send, Undo2, X } from "lucide-react";
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogHeader,
  DialogTrigger,
} from "@/components/ui/dialog";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import {
  addApprovalComment,
  cancelApprovalRequest,
  decideApproval,
  type ApprovalResult,
} from "@/app/actions/approvals";

const init: ApprovalResult = {};

const fieldCls =
  "w-full rounded-[10px] border border-line bg-canvas px-3 py-2.5 text-sm outline-none transition focus:border-brand-400 focus:bg-surface";

/**
 * Onay / ret kararı.
 *
 * NEDEN ConfirmDialog DEĞİL: ret için GEREKÇE zorunlu, yani onay penceresinin
 * içinde bir metin alanı olmalı. `ConfirmDialog` yalnız evet/hayır taşıyor ve
 * paylaşılan bir primitive — bu ekran için genişletmek yerine aynı görsel dili
 * kullanan yerel bir pencere kuruldu (Dialog + DialogHeader zaten ortak).
 */
export function DecisionDialog({
  requestId,
  decision,
  requestTitle,
}: {
  requestId: string;
  decision: "onaylandi" | "reddedildi";
  requestTitle: string;
}) {
  const [open, setOpen] = useState(false);
  const [state, action, isPending] = useActionState(decideApproval, init);
  const red = decision === "reddedildi";

  if (state?.ok && open) setOpen(false);

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <button
          type="button"
          className={`focus-ring press inline-flex items-center gap-1.5 rounded-[9px] px-3 py-1.5 text-xs font-semibold transition ${
            red
              ? "border border-danger-500/30 bg-danger-500/8 text-danger-600 hover:bg-danger-500/15"
              : "bg-mint-500/12 text-mint-700 hover:bg-mint-500/20"
          }`}
        >
          {red ? <X className="h-3.5 w-3.5" /> : <Check className="h-3.5 w-3.5" />}
          {red ? "Reddet" : "Onayla"}
        </button>
      </DialogTrigger>

      <DialogContent size="sm">
        <DialogHeader
          icon={red ? <X /> : <Check />}
          tone={red ? "danger" : "default"}
          title={red ? "Talebi reddet" : "Talebi onayla"}
          description={requestTitle}
        />
        <form action={action} className="space-y-4 p-6">
          <input type="hidden" name="id" value={requestId} />
          <input type="hidden" name="decision" value={decision} />
          <div>
            <label className="mb-1.5 block text-sm font-medium text-ink-950" htmlFor={`note-${requestId}-${decision}`}>
              {red ? (
                <>Ret gerekçesi <span className="text-danger-500">*</span></>
              ) : (
                <>Karar notu <span className="text-xs text-text-faint">(opsiyonel)</span></>
              )}
            </label>
            <textarea
              id={`note-${requestId}-${decision}`}
              name="decision_note"
              rows={3}
              required={red}
              className={`${fieldCls} resize-none`}
              placeholder={red ? "Neden reddedildi? Talep sahibine bu metin gider." : "Koşul/uyarı eklemek isterseniz…"}
            />
          </div>

          {state?.error ? (
            <p className="rounded-[10px] bg-danger-500/8 px-3 py-2 text-sm font-medium text-danger-600" role="alert">
              {state.error}
            </p>
          ) : null}

          <div className="hairline-t flex justify-end gap-2 pt-4">
            <DialogClose asChild>
              <button
                type="button"
                className="focus-ring press rounded-[10px] border border-hairline px-4 py-2.5 text-sm font-semibold text-text-muted transition hover:bg-canvas"
              >
                Vazgeç
              </button>
            </DialogClose>
            <button
              type="submit"
              disabled={isPending}
              className={`focus-ring press inline-flex items-center gap-2 rounded-[10px] px-5 py-2.5 text-sm font-semibold text-white transition disabled:opacity-50 ${
                red ? "bg-danger-500 hover:bg-danger-600" : "bg-mint-600 hover:bg-mint-700"
              }`}
            >
              {isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : red ? <X className="h-4 w-4" /> : <Check className="h-4 w-4" />}
              {isPending ? "Kaydediliyor…" : red ? "Reddet" : "Onayla"}
            </button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}

/** Talebi geri çek — yalnız sahibi, yalnız bekliyorken (sunucuda da doğrulanır). */
export function CancelApprovalButton({ requestId, requestTitle }: { requestId: string; requestTitle: string }) {
  const [error, setError] = useState<string | null>(null);

  return (
    <>
      <ConfirmDialog
        title="Talebi geri çek"
        description={`"${requestTitle}" talebi iptal edilecek. Kayıt silinmez, "İptal edildi" olarak arşivlenir.`}
        confirmLabel="Geri çek"
        cancelLabel="Vazgeç"
        onConfirm={async () => {
          const fd = new FormData();
          fd.set("id", requestId);
          const res = await cancelApprovalRequest({}, fd);
          setError(res.error ?? null);
        }}
        trigger={
          <button
            type="button"
            className="focus-ring press inline-flex items-center gap-1.5 rounded-[9px] border border-line px-3 py-1.5 text-xs font-semibold text-text-muted transition hover:border-danger-500/40 hover:text-danger-600"
          >
            <Undo2 className="h-3.5 w-3.5" /> İptal et
          </button>
        }
      />
      {error ? <span className="text-[11px] font-semibold text-danger-600">{error}</span> : null}
    </>
  );
}

/** Talep altına not — talep eden ↔ yönetici diyaloğu; herkes yazabilir. */
export function ApprovalCommentForm({ requestId }: { requestId: string }) {
  const [state, action, isPending] = useActionState(addApprovalComment, init);

  return (
    <form action={action} className="mt-3 flex flex-wrap items-start gap-2">
      <input type="hidden" name="request_id" value={requestId} />
      <label className="sr-only" htmlFor={`comment-${requestId}`}>Not ekle</label>
      <input
        id={`comment-${requestId}`}
        name="body"
        required
        maxLength={2000}
        placeholder="Not ekle…"
        className="min-w-0 flex-1 rounded-[10px] border border-line bg-canvas px-3 py-2 text-sm outline-none transition focus:border-brand-400 focus:bg-surface"
      />
      <button
        type="submit"
        disabled={isPending}
        className="focus-ring press inline-flex items-center gap-1.5 rounded-[10px] border border-line px-3 py-2 text-xs font-semibold text-text-muted transition hover:border-brand-300 hover:text-brand-600 disabled:opacity-50"
      >
        {isPending ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Send className="h-3.5 w-3.5" />}
        Gönder
      </button>
      {state?.error ? (
        <p className="w-full text-[11px] font-semibold text-danger-600" role="alert">{state.error}</p>
      ) : null}
    </form>
  );
}
