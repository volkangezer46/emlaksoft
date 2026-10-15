"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { CalendarX, Undo2, XCircle } from "lucide-react";
import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { cancelPostCloseAppointments, undoPostCloseCleanup } from "@/app/actions/post-close";
import { bulkUpdateOfferStatus } from "@/app/actions/offers";
import { postCloseMessage, type PostCloseSummary } from "@/lib/post-close-model";

/**
 * Kapanış sonrası özet: otomatik yapılanı söyler ("Geri al" ile döner) ve portföyde kalan randevu/teklifler
 * için TEK TIKLA iptal/ret önerir. Hiçbir şey sessizce iptal edilmez; her düğme kendi modül izniyle çalışır.
 */
export function PostClosePanel({ summary }: { summary: PostCloseSummary }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [state, setState] = useState(summary);
  const [undone, setUndone] = useState(false);
  const [info, setInfo] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const message = postCloseMessage(undone ? { ...state, closedDemands: [], anniversary: null } : state);
  const canUndo = !undone && (state.closedDemands.length > 0 || state.anniversary !== null);
  if (!message && !info && !error) return null;

  function run(task: () => Promise<void>) {
    setError(null);
    setInfo(null);
    startTransition(async () => {
      try {
        await task();
      } catch {
        setError("İşlem tamamlanamadı. Sayfayı yenileyip tekrar deneyin.");
      }
      router.refresh();
    });
  }

  const undo = () =>
    run(async () => {
      const res = await undoPostCloseCleanup({
        dealId: state.dealId,
        closedDemands: state.closedDemands,
        anniversary: state.anniversary,
      });
      if (res.error) return setError(res.error);
      setUndone(true);
      setInfo(
        `Geri alındı: ${res.restoredDemands ?? 0} talep eski durumuna döndü${res.anniversaryCleared ? ", yıldönümü kaldırıldı" : ""}.`,
      );
    });

  const cancelAppointments = () =>
    run(async () => {
      const res = await cancelPostCloseAppointments(state.appointmentIds);
      if (res.error) return setError(res.error);
      setState((s) => ({ ...s, appointmentIds: [] }));
      setInfo(`${res.updated ?? 0} randevu iptal edildi.${res.failed ? ` ${res.failed} randevu iptal edilemedi: ${res.firstError ?? ""}` : ""}`);
    });

  const rejectOffers = () =>
    run(async () => {
      const res = await bulkUpdateOfferStatus(state.offerIds, "rejected");
      if (res.error) return setError(res.error);
      setState((s) => ({ ...s, offerIds: [] }));
      setInfo(`${res.updated ?? 0} teklif reddedildi.${res.failed ? ` ${res.failed} teklif reddedilemedi: ${res.firstError ?? ""}` : ""}`);
    });

  const hasActions = canUndo || state.appointmentIds.length > 0 || state.offerIds.length > 0;

  return (
    <div className="space-y-2">
      {message ? (
        <Alert tone="info" title="Kapanış sonrası düzenleme">
          <p>{message}</p>
          {hasActions ? (
            <div className="mt-2 flex flex-wrap gap-2">
              {state.appointmentIds.length > 0 ? (
                <Button type="button" size="sm" variant="secondary" icon={CalendarX} loading={pending} onClick={cancelAppointments}>
                  Randevuları iptal et ({state.appointmentIds.length})
                </Button>
              ) : null}
              {state.offerIds.length > 0 ? (
                <Button type="button" size="sm" variant="secondary" icon={XCircle} loading={pending} onClick={rejectOffers}>
                  Teklifleri reddet ({state.offerIds.length})
                </Button>
              ) : null}
              {canUndo ? (
                <Button type="button" size="sm" variant="ghost" icon={Undo2} loading={pending} onClick={undo}>
                  Geri al
                </Button>
              ) : null}
            </div>
          ) : null}
        </Alert>
      ) : null}
      {info ? <Alert tone="success">{info}</Alert> : null}
      {error ? <Alert tone="danger">{error}</Alert> : null}
    </div>
  );
}
