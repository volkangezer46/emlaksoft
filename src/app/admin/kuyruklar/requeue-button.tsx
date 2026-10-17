"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Loader2, RotateCcw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { requeueQueueItems } from "@/app/actions/admin-ops";

/**
 * Kalıcı hatalı işi (ya da kuyruğun tüm kalıcı hatalılarını, en çok 100) yeniden kuyruğa alır. Satır içi onay; sonuç
 * düğmenin altında. Yetki, hız sınırı ve denetim kaydı sunucuda (`requeueQueueItems`).
 */
export function RequeueButton({ queue, id, label, confirmText }: { queue: string; id: string; label: string; confirmText: string }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [confirming, setConfirming] = useState(false);
  const [result, setResult] = useState<{ ok: boolean; text: string } | null>(null);

  function run() {
    setConfirming(false);
    const fd = new FormData();
    fd.set("queue", queue);
    fd.set("id", id);
    start(async () => {
      const res = await requeueQueueItems(fd);
      setResult(res.error ? { ok: false, text: res.error } : res.notice ? { ok: true, text: res.notice } : { ok: true, text: `${res.count ?? 0} iş yeniden kuyrukta.` });
      if (!res.error && !res.notice) router.refresh();
    });
  }

  return (
    <div className="flex min-w-0 flex-col items-end gap-1">
      {confirming ? (
        <span className="inline-flex flex-wrap items-center justify-end gap-1.5 text-xs font-semibold text-amber-800">
          <span className="max-w-[16rem] truncate" title={confirmText}>
            {confirmText}
          </span>
          <Button type="button" size="xs" variant="navy" onClick={run}>
            Evet
          </Button>
          <Button type="button" size="xs" variant="outline" onClick={() => setConfirming(false)}>
            Vazgeç
          </Button>
        </span>
      ) : (
        <Button type="button" size="xs" variant="outline" disabled={pending} onClick={() => setConfirming(true)}>
          {pending ? <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden /> : <RotateCcw className="h-3.5 w-3.5" aria-hidden />}
          {label}
        </Button>
      )}
      {result ? (
        <p role={result.ok ? "status" : "alert"} className={`text-xs font-medium ${result.ok ? "text-mint-700" : "text-danger-600"}`}>
          {result.text}
        </p>
      ) : null}
    </div>
  );
}
