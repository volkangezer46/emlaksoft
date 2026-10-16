"use client";

import { useCallback, useEffect, useOptimistic, useRef, useState, useTransition } from "react";
import { Check, Loader2, X } from "lucide-react";
import { useToast } from "@/components/app/toast-provider";
import { useSimpleMode } from "@/lib/simple-mode";
import { decideApproval, type ApprovalResult } from "@/app/actions/approvals";

const init: ApprovalResult = {};

/*
 * Onay kararı denetimi AYRI istemci modülünde: ana ekran ("Senden bekleyenler") yalnız bunu içe aktarır; toplu karar
 * çubuğu, iptal diyaloğu ve yorum formu (approval-actions.tsx) ana ekranın ilk yük paketine girmez (paket bütçesi).
 */

const fieldCls =
  "w-full rounded-[var(--radius-control)] border border-line bg-canvas px-3 py-2.5 text-sm outline-none transition focus:border-brand-400 focus:bg-surface";

type Decision = "onaylandi" | "reddedildi";

/** "Geri al" süresi: karar bu süre boyunca yalnız ekranda (iyimser) durur, sonra sunucuya yazılır. */
const UNDO_MS = 5000;

/**
 * Onay / ret kararı — SAYFA İÇİ panel (popup yok). Sade görünümde "Onayla" tek dokunuştur (not gerekmez). Aksi halde
 * düğmeye basınca satırın altında gerekçe alanı açılır; ret için
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
  const simple = useSimpleMode();
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
    // Sekme kapatma / yenileme: `pagehide` anında başlatılan istek tarayıcı sayfayı söktüğü için çoğu zaman iptal olur
    // (saha denetimi Q3: 5 sn içinde kapatılan sekmede onay kaybolup talep "bekliyor"da kaldı). Bekleyen karar varken
    // istek HEMEN başlatılır ve tarayıcının "sayfadan ayrıl?" onayı istenir — onay penceresi açıkken sayfa yaşar, istek biter.
    const onBeforeUnload = (e: BeforeUnloadEvent) => {
      if (!pendingRef.current) return;
      flush();
      e.preventDefault();
      e.returnValue = "";
    };
    document.addEventListener("visibilitychange", onVisibility);
    window.addEventListener("pagehide", flush);
    window.addEventListener("beforeunload", onBeforeUnload);
    return () => {
      document.removeEventListener("visibilitychange", onVisibility);
      window.removeEventListener("pagehide", flush);
      window.removeEventListener("beforeunload", onBeforeUnload);
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
    queue(mode, decisionNote);
  }

  /** Kararı "Geri al" süresiyle kuyruğa alır (onay notu isteğe bağlı; ret gerekçesi çağıranda denetlenir). */
  function queue(decision: Decision, decisionNote: string) {
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
        // Sade görünümde "Onayla" tek dokunuşta karar verir (Geri al süresi korunur); not gerekmez. Ret gerekçe ister.
        onClick={() => (simple && !isRed ? queue("onaylandi", "") : setMode(active ? null : decision))}
        className={`focus-ring press inline-flex min-h-11 items-center gap-1.5 rounded-[var(--radius-control)] px-4 py-2 text-sm font-semibold transition ${
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

