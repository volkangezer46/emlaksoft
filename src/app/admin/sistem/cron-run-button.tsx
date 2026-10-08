"use client";

import { Button } from "@/components/ui/button";
import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Loader2, Play } from "lucide-react";
import { runCronJobNow } from "@/app/actions/platform-cron";

/**
 * "Şimdi çalıştır" — yalnız süper admin görür. Onay satır içidir (popup yok); CRON_SECRET istemciye
 * hiç inmez: istek sunucu action'ı içinden yapılır. Sonuç mesajı butonun altında kalır.
 */
export function CronRunButton({ job, label }: { job: string; label: string }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [confirming, setConfirming] = useState(false);
  const [result, setResult] = useState<{ ok: boolean; text: string } | null>(null);

  function run() {
    setConfirming(false);
    setResult(null);
    start(async () => {
      const fd = new FormData();
      fd.set("job", job);
      const res = await runCronJobNow(fd);
      if (res.ok) {
        setResult({ ok: true, text: `Tamamlandı (HTTP ${res.status}, ${Math.round((res.durationMs ?? 0) / 100) / 10} sn).` });
        router.refresh();
      } else {
        setResult({ ok: false, text: res.error ?? "İş çalıştırılamadı." });
        router.refresh();
      }
    });
  }

  return (
    <div className="flex shrink-0 flex-col items-end gap-1">
      {confirming ? (
        <span className="inline-flex flex-wrap items-center justify-end gap-1.5 text-xs font-semibold text-amber-800">
          “{label}” şimdi çalıştırılsın mı?
          <Button variant="navy" size="xs" type="button" onClick={run}>
            Evet
          </Button>
          <Button variant="outline" size="xs" type="button" onClick={() => setConfirming(false)}>
            Vazgeç
          </Button>
        </span>
      ) : (
        <Button
          variant="outline"
          size="xs"
          type="button"
          disabled={pending}
          onClick={() => setConfirming(true)}
          aria-label={`${label} işini şimdi çalıştır`}
        >
          {pending ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Play className="h-3.5 w-3.5" />}
          Şimdi çalıştır
        </Button>
      )}
      {result ? (
        <span role={result.ok ? "status" : "alert"} className={`text-xs font-semibold ${result.ok ? "text-mint-700" : "text-danger-600"}`}>
          {result.text}
        </span>
      ) : null}
    </div>
  );
}
