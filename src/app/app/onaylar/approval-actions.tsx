"use client";

import { useActionState, useState, useTransition } from "react";
import { Check, Loader2, Send, Undo2, X } from "lucide-react";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { Button } from "@/components/ui/button";
import { BulkBar } from "@/components/ui/list-kit";
import { useBulkSelection } from "@/components/app/bulk-selection";
import { useToast } from "@/components/app/toast-provider";
import {
  addApprovalComment,
  cancelApprovalRequest,
  decideApprovalsBulk,
  type ApprovalResult,
} from "@/app/actions/approvals";

export { DecisionControls } from "./decision-controls";

const init: ApprovalResult = {};

/**
 * Toplu karar çubuğu (yalnız "Bekleyen" sekmesinde, karar yetkili rollerde). Her talep sunucuda
 * tek tek aynı kurallardan geçer; kendi talebi olan ya da artık beklemeyen atlanır ve raporlanır.
 */
export function ApprovalBulkBar() {
  const { selected, clear } = useBulkSelection();
  const { push } = useToast();
  const [note, setNote] = useState("");
  const [pending, startTransition] = useTransition();
  if (selected.size === 0) return null;
  const ids = [...selected];

  function run(decision: "onaylandi" | "reddedildi") {
    if (decision === "reddedildi" && !note.trim()) {
      push("Toplu ret için gerekçe yazın.", "err");
      return;
    }
    startTransition(async () => {
      const res = await decideApprovalsBulk(ids, decision, note);
      if (res.error) return push(res.error, "err");
      const skipped = res.skipped ?? 0;
      push(
        `${res.decided ?? 0} talep ${decision === "onaylandi" ? "onaylandı" : "reddedildi"}${skipped > 0 ? ` · ${skipped} atlandı${res.firstError ? ` (${res.firstError})` : ""}` : ""}`,
        skipped > 0 ? "err" : "ok",
      );
      const firstInfo = res.infos?.[0];
      if (firstInfo) push(res.infos!.length > 1 ? `${firstInfo} (+${res.infos!.length - 1} talep daha)` : firstInfo, "ok");
      // Eylem revalidatePath yapar; taze liste aynı yanıtla gelir (router.refresh ile çift tazeleme yok).
      clear();
      setNote("");
    });
  }

  return (
    <BulkBar count={selected.size} noun="talep" onClear={clear}>
      <label className="sr-only" htmlFor="approval-bulk-note">Karar notu / ret gerekçesi</label>
      <input
        id="approval-bulk-note"
        value={note}
        onChange={(e) => setNote(e.target.value)}
        maxLength={2000}
        placeholder="Not / ret gerekçesi (ret için zorunlu)"
        className="h-8 min-w-[16rem] rounded-[var(--radius-control)] border border-line bg-surface px-2.5 text-sm"
      />
      <Button size="sm" loading={pending} onClick={() => run("onaylandi")}>
        <Check className="h-3.5 w-3.5" /> Onayla
      </Button>
      <Button size="sm" variant="danger" loading={pending} onClick={() => run("reddedildi")}>
        <X className="h-3.5 w-3.5" /> Reddet
      </Button>
    </BulkBar>
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
            className="focus-ring press inline-flex items-center gap-1.5 rounded-[var(--radius-control)] border border-line px-3 py-1.5 text-xs font-semibold text-text-muted transition hover:border-danger-500/40 hover:text-danger-600 touch:min-h-11"
          >
            <Undo2 className="h-3.5 w-3.5" /> İptal et
          </button>
        }
      />
      {error ? <span className="text-xs font-semibold text-danger-600">{error}</span> : null}
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
        className="min-w-0 flex-1 rounded-[var(--radius-control)] border border-line bg-canvas px-3 py-2 text-sm outline-none transition focus:border-brand-400 focus:bg-surface"
      />
      <button
        type="submit"
        disabled={isPending}
        className="focus-ring press inline-flex items-center gap-1.5 rounded-[var(--radius-control)] border border-line px-3 py-2 text-xs font-semibold text-text-muted transition hover:border-brand-300 hover:text-brand-600 disabled:opacity-50"
      >
        {isPending ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Send className="h-3.5 w-3.5" />}
        Gönder
      </button>
      {state?.error ? (
        <p className="w-full text-xs font-semibold text-danger-600" role="alert">{state.error}</p>
      ) : null}
    </form>
  );
}
