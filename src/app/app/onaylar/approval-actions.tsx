"use client";

import { useActionState, useCallback, useEffect, useOptimistic, useRef, useState, useTransition } from "react";
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

type Decision = "onaylandi" | "reddedildi";

/** "Geri al" süresi: karar bu süre boyunca yalnız ekranda (iyimser) durur, sonra sunucuya yazılır. */
const UNDO_MS = 5000;

/**
 * Onay / ret kararı — SAYFA İÇİ panel (popup yok). Düğmeye basınca satırın altında gerekçe alanı açılır; ret için
 * gerekçe zorunlu. Açıkken kapsayıcı tam satır genişliği alır (`basis-full`).
 *
 * Görsel tepki AYNI karede (SK10 / B037): gönderince satır hemen "Onaylandı/Reddedildi" olur ve "Geri al" bildirimi
 * çıkar. Sonuçlanmış talep veritabanında değiştirilemediği için (guard_approval_request_update) karar sunucuya
 * `UNDO_MS` sonra yazılır; "Geri al" bu süre içinde kararı hiç göndermez. Sayfadan ayrılınca bekleyen karar hemen
 * gönderilir. Sunucu yazımı `useOptimistic` ile görünür kalır; hata olursa geri sarılır ve bildirim çıkar. Eylem
 * `revalidatePath` yapar: ayrıca `router.refresh()` çağrılmaz (çift tazeleme yok).
 */
export function DecisionControls({ requestId, requestTitle }: { requestId: string; requestTitle: string }) {
  const { push } = useToast();
  const [mode, setMode] = useState<Decision | null>(null);
  const [note, setNote] = useState("");
  const [queued, setQueued] = useState<Decision | null>(null);
  const [optimistic, setOptimistic] = useOptimistic<Decision | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [info, setInfo] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();
  const pendingRef = useRef<{ fd: FormData; timer: ReturnType<typeof setTimeout> } | null>(null);
  const red = mode === "reddedildi";
  const shown = optimistic ?? queued;

  const send = useCallback(
    (fd: FormData, decision: Decision) => {
      startTransition(async () => {
        setOptimistic(decision);
        const res = await decideApproval(init, fd);
        if (!res.ok) {
          const message = res.error ?? "Karar kaydedilemedi.";
          setQueued(null);
          setError(message);
          push(message, "err");
          return;
        }
        if (res.info) setInfo(res.info);
      });
    },
    [push, setOptimistic],
  );

  // Geri al süresi dolmadan sayfadan ayrılınca karar kaybolmasın: bekleyen karar hemen gönderilir. Uygulama içi
  // geçişte bileşen sökülürken; sekme gizlenince / kapanırken (mobilde sekme değişimi, uygulamadan çıkış) da
  // `visibilitychange`/`pagehide` ile — sekme kapatma sökülme temizliğini hiç çalıştırmaz.
  useEffect(() => {
    const flush = () => {
      const pending = pendingRef.current;
      if (!pending) return;
      clearTimeout(pending.timer);
      pendingRef.current = null;
      void decideApproval(init, pending.fd);
    };
    const onVisibility = () => {
      if (document.visibilityState === "hidden") flush();
    };
    document.addEventListener("visibilitychange", onVisibility);
    window.addEventListener("pagehide", flush);
    return () => {
      document.removeEventListener("visibilitychange", onVisibility);
      window.removeEventListener("pagehide", flush);
      flush();
    };
  }, []);

  function submit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (!mode) return;
    const decisionNote = note.trim();
    if (mode === "reddedildi" && !decisionNote) {
      setError("Ret için gerekçe zorunludur.");
      return;
    }
    const decision = mode;
    const fd = new FormData();
    fd.set("id", requestId);
    fd.set("decision", decision);
    fd.set("decision_note", decisionNote);
    const timer = setTimeout(() => {
      pendingRef.current = null;
      send(fd, decision);
    }, UNDO_MS);
    pendingRef.current = { fd, timer };
    setQueued(decision);
    setMode(null);
    setError(null);
    push(`${decision === "onaylandi" ? "Onaylandı" : "Reddedildi"}: ${requestTitle}`, "ok", {
      action: {
        label: "Geri al",
        onClick: () => {
          const pending = pendingRef.current;
          if (!pending) {
            push("Karar kaydedildi; sonuçlanan talep geri alınamaz.", "err");
            return;
          }
          clearTimeout(pending.timer);
          pendingRef.current = null;
          setQueued(null);
        },
      },
    });
  }

  if (shown) {
    return (
      <span className="flex flex-wrap items-center justify-end gap-2" role="status">
        <span
          className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-bold ${
            shown === "onaylandi" ? "bg-mint-500/12 text-mint-700" : "bg-danger-500/10 text-danger-600"
          }`}
        >
          {isPending ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : shown === "onaylandi" ? <Check className="h-3.5 w-3.5" /> : <X className="h-3.5 w-3.5" />}
          {shown === "onaylandi" ? "Onaylandı" : "Reddedildi"}
        </span>
        {info ? <span className="basis-full text-right text-xs font-medium text-text-muted">{info}</span> : null}
      </span>
    );
  }

  const toggleBtn = (decision: Decision) => {
    const isRed = decision === "reddedildi";
    const active = mode === decision;
    return (
      <button
        type="button"
        aria-expanded={active}
        onClick={() => setMode(active ? null : decision)}
        className={`focus-ring press inline-flex items-center gap-1.5 rounded-[var(--radius-control)] px-3 py-1.5 text-xs font-semibold transition touch:min-h-11 ${
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
        <form onSubmit={submit} className="w-full space-y-2 rounded-[var(--radius-card)] border border-line bg-canvas/60 p-3">
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
            value={note}
            onChange={(e) => setNote(e.target.value)}
            maxLength={2000}
            className={`${fieldCls} resize-none`}
            placeholder={red ? "Neden reddedildi? Talep sahibine bu metin gider." : "Koşul/uyarı eklemek isterseniz…"}
          />
          {error ? (
            <p className="rounded-[var(--radius-control)] bg-danger-500/8 px-3 py-2 text-xs font-medium text-danger-600" role="alert">
              {error}
            </p>
          ) : null}
          <div className="flex justify-end gap-2">
            <button
              type="button"
              onClick={() => setMode(null)}
              className="focus-ring press rounded-[var(--radius-control)] border border-hairline px-3 py-1.5 text-xs font-semibold text-text-muted transition hover:bg-canvas touch:min-h-11"
            >
              Vazgeç
            </button>
            <button
              type="submit"
              className={`focus-ring press inline-flex items-center gap-1.5 rounded-[var(--radius-control)] px-4 py-1.5 text-xs font-semibold text-white transition disabled:opacity-50 touch:min-h-11 ${
                red ? "bg-danger-500 hover:bg-danger-600" : "bg-mint-600 hover:bg-mint-700"
              }`}
            >
              {red ? <X className="h-3.5 w-3.5" /> : <Check className="h-3.5 w-3.5" />}
              {red ? "Reddet" : "Onayla"}
            </button>
          </div>
        </form>
      ) : error ? (
        <p className="basis-full text-right text-xs font-medium text-danger-600" role="alert">{error}</p>
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
