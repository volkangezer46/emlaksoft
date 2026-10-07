"use client";

import { useActionState, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Check, Loader2, Send, Undo2, X } from "lucide-react";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { Button } from "@/components/ui/button";
import { BulkBar } from "@/components/ui/list-kit";
import { useBulkSelection } from "@/components/app/bulk-selection";
import { useToast } from "@/components/app/toast-provider";
import {
  addApprovalComment,
  cancelApprovalRequest,
  decideApproval,
  decideApprovalsBulk,
  type ApprovalResult,
} from "@/app/actions/approvals";

const init: ApprovalResult = {};

const fieldCls =
  "w-full rounded-[var(--radius-control)] border border-line bg-canvas px-3 py-2.5 text-sm outline-none transition focus:border-brand-400 focus:bg-surface";

/**
 * Onay / ret kararı — SAYFA İÇİ panel (popup yok). Düğmeye basınca satırın altında
 * gerekçe alanı açılır; ret için gerekçe zorunlu. Açıkken kapsayıcı tam satır genişliği alır
 * (`basis-full`), böylece liste satırının içinde kalır.
 */
export function DecisionControls({ requestId, requestTitle }: { requestId: string; requestTitle: string }) {
  const [mode, setMode] = useState<"onaylandi" | "reddedildi" | null>(null);
  const [state, action, isPending] = useActionState(decideApproval, init);
  const red = mode === "reddedildi";
  if (state?.ok && mode) setMode(null);

  const toggleBtn = (decision: "onaylandi" | "reddedildi") => {
    const isRed = decision === "reddedildi";
    const active = mode === decision;
    return (
      <button
        type="button"
        aria-expanded={active}
        onClick={() => setMode(active ? null : decision)}
        className={`focus-ring press inline-flex items-center gap-1.5 rounded-[var(--radius-control)] px-3 py-1.5 text-xs font-semibold transition ${
          isRed
            ? "border border-danger-500/30 bg-danger-500/8 text-danger-600 hover:bg-danger-500/15"
            : "bg-mint-500/12 text-mint-700 hover:bg-mint-500/20"
        } ${active ? "ring-2 ring-offset-1 ring-brand-300" : ""}`}
      >
        {isRed ? <X className="h-3.5 w-3.5" /> : <Check className="h-3.5 w-3.5" />}
        {isRed ? "Reddet" : "Onayla"}
      </button>
    );
  };

  return (
    <span className={`flex flex-wrap items-center justify-end gap-2 ${mode ? "basis-full" : ""}`}>
      {toggleBtn("onaylandi")}
      {toggleBtn("reddedildi")}
      {mode ? (
        <form action={action} className="w-full space-y-2 rounded-[var(--radius-card)] border border-line bg-canvas/60 p-3">
          <input type="hidden" name="id" value={requestId} />
          <input type="hidden" name="decision" value={mode} />
          <label className="block text-xs font-semibold text-ink-950" htmlFor={`note-${requestId}`}>
            {red ? (
              <>Ret gerekçesi <span className="text-danger-500">*</span> <span className="font-normal text-text-faint">({requestTitle})</span></>
            ) : (
              <>Karar notu <span className="font-normal text-text-faint">(opsiyonel · {requestTitle})</span></>
            )}
          </label>
          <textarea
            id={`note-${requestId}`}
            name="decision_note"
            rows={2}
            required={red}
            autoFocus
            className={`${fieldCls} resize-none`}
            placeholder={red ? "Neden reddedildi? Talep sahibine bu metin gider." : "Koşul/uyarı eklemek isterseniz…"}
          />
          {state?.error ? (
            <p className="rounded-[var(--radius-control)] bg-danger-500/8 px-3 py-2 text-xs font-medium text-danger-600" role="alert">
              {state.error}
            </p>
          ) : null}
          <div className="flex justify-end gap-2">
            <button
              type="button"
              onClick={() => setMode(null)}
              className="focus-ring press rounded-[var(--radius-control)] border border-hairline px-3 py-1.5 text-xs font-semibold text-text-muted transition hover:bg-canvas"
            >
              Vazgeç
            </button>
            <button
              type="submit"
              disabled={isPending}
              className={`focus-ring press inline-flex items-center gap-1.5 rounded-[var(--radius-control)] px-4 py-1.5 text-xs font-semibold text-white transition disabled:opacity-50 ${
                red ? "bg-danger-500 hover:bg-danger-600" : "bg-mint-600 hover:bg-mint-700"
              }`}
            >
              {isPending ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : red ? <X className="h-3.5 w-3.5" /> : <Check className="h-3.5 w-3.5" />}
              {isPending ? "Kaydediliyor…" : red ? "Reddet" : "Onayla"}
            </button>
          </div>
        </form>
      ) : null}
    </span>
  );
}

/**
 * Toplu karar çubuğu (yalnız "Bekleyen" sekmesinde, karar yetkili rollerde). Her talep sunucuda
 * tek tek aynı kurallardan geçer; kendi talebi olan ya da artık beklemeyen atlanır ve raporlanır.
 */
export function ApprovalBulkBar() {
  const { selected, clear } = useBulkSelection();
  const router = useRouter();
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
      clear();
      setNote("");
      router.refresh();
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
            className="focus-ring press inline-flex items-center gap-1.5 rounded-[var(--radius-control)] border border-line px-3 py-1.5 text-xs font-semibold text-text-muted transition hover:border-danger-500/40 hover:text-danger-600"
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
