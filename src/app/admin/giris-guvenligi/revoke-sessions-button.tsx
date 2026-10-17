"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Loader2, LogOut } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useStepUpPrompt } from "@/components/admin/step-up";
import { signOutMemberSessions } from "@/app/actions/platform-members";

/**
 * Giriş güvenliği > hedeflenen hesap satırı: "Oturumları kapat". Satır içi onay (pencere yok) → doğrulayıcı kodu
 * (kritik işlem, ayar kapalıysa sorulmaz) → `signOutMemberSessions` (üye ayrıntısıyla aynı eylem; hız sınırı ve
 * denetim kaydı sunucuda). Sonuç düğmenin altında kalır.
 */
export function RevokeSessionsButton({ userId, name }: { userId: string; name: string }) {
  const router = useRouter();
  const stepUp = useStepUpPrompt();
  const [pending, start] = useTransition();
  const [confirming, setConfirming] = useState(false);
  const [result, setResult] = useState<{ ok: boolean; text: string } | null>(null);

  async function run() {
    setConfirming(false);
    const code = await stepUp.ask("Oturumları kapatma");
    if (!code) return;
    const fd = new FormData();
    fd.set("id", userId);
    fd.set("step_up_code", code);
    fd.set("via", "giris-guvenligi");
    fd.set("reason", "Giriş güvenliği: tekrarlanan başarısız giriş");
    start(async () => {
      const res = await signOutMemberSessions(fd);
      setResult(res.error ? { ok: false, text: res.error } : { ok: true, text: "Açık oturumlar kapatıldı." });
      if (!res.error) router.refresh();
    });
  }

  return (
    <div className="flex min-w-0 flex-col items-end gap-1">
      {confirming ? (
        <span className="inline-flex flex-wrap items-center justify-end gap-1.5 text-xs font-semibold text-amber-800">
          <span className="max-w-[14rem] truncate" title={`${name}: tüm oturumlar kapatılsın mı?`}>
            {name}: tüm oturumlar kapatılsın mı?
          </span>
          <Button type="button" size="xs" variant="danger" onClick={run}>
            Kapat
          </Button>
          <Button type="button" size="xs" variant="outline" onClick={() => setConfirming(false)}>
            Vazgeç
          </Button>
        </span>
      ) : (
        <Button type="button" size="xs" variant="outline" disabled={pending} onClick={() => setConfirming(true)} aria-label={`${name}: oturumları kapat`}>
          {pending ? <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden /> : <LogOut className="h-3.5 w-3.5" aria-hidden />}
          Oturumları kapat
        </Button>
      )}
      {result ? (
        <p role={result.ok ? "status" : "alert"} className={`text-xs font-medium ${result.ok ? "text-mint-700" : "text-danger-600"}`}>
          {result.text}
        </p>
      ) : null}
      {stepUp.dialog}
    </div>
  );
}
