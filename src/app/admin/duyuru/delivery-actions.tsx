"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Ban, RotateCcw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cancelScheduledBroadcast, retryFailedDeliveries } from "@/app/actions/platform-notifications";

/** Kuyruklu duyuru eylemleri: başarısızları yeniden dene, zamanlanmış/gönderilen duyuruyu iptal et. */
export function DeliveryActions({ id, status, failed }: { id: string; status: string; failed: number }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [msg, setMsg] = useState<{ tone: "ok" | "err"; text: string } | null>(null);
  const [confirmCancel, setConfirmCancel] = useState(false);

  const run = (fn: (fd: FormData) => Promise<{ ok?: boolean; error?: string; affected?: number }>, okText: (n?: number) => string) =>
    start(async () => {
      const fd = new FormData();
      fd.set("id", id);
      const r = await fn(fd);
      if (r.error) setMsg({ tone: "err", text: r.error });
      else {
        setMsg({ tone: "ok", text: okText(r.affected) });
        setConfirmCancel(false);
        router.refresh();
      }
    });

  const canCancel = status === "scheduled" || status === "sending";
  return (
    <span className="inline-flex flex-wrap items-center gap-2">
      {failed > 0 && status !== "cancelled" && status !== "expired" ? (
        <Button type="button" variant="outline" size="sm" disabled={pending} onClick={() => run(retryFailedDeliveries, (n) => `${n ?? 0} alıcı yeniden kuyrukta`)}>
          <RotateCcw className="h-3.5 w-3.5 text-brand-600" /> {pending ? "Kuyruğa alınıyor…" : `Başarısızları yeniden dene (${failed})`}
        </Button>
      ) : null}
      {canCancel ? (
        confirmCancel ? (
          <span className="inline-flex flex-wrap items-center gap-2 rounded-[var(--radius-control)] border border-danger-500/30 bg-danger-500/5 px-2.5 py-1.5 text-xs">
            <span className="font-semibold text-danger-600">Gönderilmemiş alıcılara gitmesin mi?</span>
            <Button type="button" variant="danger" size="sm" disabled={pending} onClick={() => run(cancelScheduledBroadcast, () => "Duyuru iptal edildi")}>
              {pending ? "İptal ediliyor…" : "Evet, iptal et"}
            </Button>
            <Button type="button" variant="ghost" size="sm" disabled={pending} onClick={() => setConfirmCancel(false)}>
              Vazgeç
            </Button>
          </span>
        ) : (
          <Button type="button" variant="outline" size="sm" onClick={() => setConfirmCancel(true)} className="text-danger-600">
            <Ban className="h-3.5 w-3.5" /> Gönderimi iptal et
          </Button>
        )
      ) : null}
      {msg ? (
        <span role={msg.tone === "err" ? "alert" : "status"} className={`text-xs font-semibold ${msg.tone === "err" ? "text-danger-600" : "text-mint-600"}`}>
          {msg.text}
        </span>
      ) : null}
    </span>
  );
}
