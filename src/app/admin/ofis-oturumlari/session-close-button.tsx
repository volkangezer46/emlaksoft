"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Loader2, LogOut } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useStepUpPrompt } from "@/components/admin/step-up";
import { closeOfficeSession, closeOfficeUserSessions } from "@/app/actions/admin-office-sessions";

const REASON_MIN = 10;

/**
 * Ofis oturumları > "Oturumu kapat" (tek oturum) ya da "Tümünü kapat" (kullanıcının tüm oturumları). Satır içi gerekçe
 * (≥10 karakter, pencere yok) → doğrulayıcı kodu → sunucu eylemi (hız sınırı, dört göz, denetim sunucuda). Dört göz
 * açıksa sonuç "onaya gönderildi" bildirimidir; liste yenilenmez.
 */
export function SessionCloseButton({ mode, sessionId, userId, label }: { mode: "one" | "all"; sessionId?: string; userId: string; label: string }) {
  const router = useRouter();
  const stepUp = useStepUpPrompt();
  const [pending, start] = useTransition();
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState("");
  const [result, setResult] = useState<{ ok: boolean; text: string } | null>(null);
  const valid = reason.trim().length >= REASON_MIN;
  const inputId = `sess-reason-${mode}-${sessionId ?? userId}`;

  async function submit() {
    const code = await stepUp.ask(mode === "one" ? "Oturumu kapatma" : "Tüm oturumları kapatma");
    if (!code) return;
    const fd = new FormData();
    if (sessionId) fd.set("session_id", sessionId);
    fd.set("user_id", userId);
    fd.set("label", label);
    fd.set("reason", reason.trim());
    fd.set("step_up_code", code);
    start(async () => {
      const res = mode === "one" ? await closeOfficeSession(fd) : await closeOfficeUserSessions(fd);
      if (res.error) {
        setResult({ ok: false, text: res.error });
        return;
      }
      setOpen(false);
      setReason("");
      if (res.notice) {
        setResult({ ok: true, text: res.notice });
        return;
      }
      setResult({ ok: true, text: mode === "one" ? "Oturum kapatıldı." : `${res.count ?? 0} oturum kapatıldı.` });
      router.refresh();
    });
  }

  return (
    <div className="flex min-w-0 max-w-full flex-col items-stretch gap-1.5 sm:items-end">
      {open ? (
        <div className="flex min-w-0 flex-wrap items-center gap-1.5">
          <label className="sr-only" htmlFor={inputId}>
            {label}: gerekçe
          </label>
          <Input
            id={inputId}
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            maxLength={300}
            placeholder="Gerekçe (en az 10 karakter)"
            className="h-8 min-w-0 flex-1 text-xs sm:w-56 sm:flex-none"
          />
          <Button type="button" size="xs" variant="danger" disabled={!valid || pending} onClick={submit}>
            {pending ? <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden /> : null}
            Kapat
          </Button>
          <Button type="button" size="xs" variant="outline" onClick={() => setOpen(false)}>
            Vazgeç
          </Button>
        </div>
      ) : (
        <Button
          type="button"
          size="xs"
          variant="outline"
          disabled={pending}
          onClick={() => {
            setResult(null);
            setOpen(true);
          }}
          aria-label={mode === "one" ? `${label}: bu oturumu kapat` : `${label}: tüm oturumları kapat`}
        >
          <LogOut className="h-3.5 w-3.5" aria-hidden />
          {mode === "one" ? "Oturumu kapat" : "Tümünü kapat"}
        </Button>
      )}
      {result ? (
        <p role={result.ok ? "status" : "alert"} className={`max-w-full break-words text-xs font-medium sm:max-w-[22rem] sm:text-right ${result.ok ? "text-mint-700" : "text-danger-600"}`}>
          {result.text}
        </p>
      ) : null}
      {stepUp.dialog}
    </div>
  );
}
