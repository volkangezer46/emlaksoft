"use client";

import { startTransition, useActionState, useEffect, useRef } from "react";
import { ArrowRight, Loader2, LogOut, MessageSquareText, RotateCcw, ShieldCheck } from "lucide-react";
import { AuthShell } from "@/components/auth/auth-shell";
import { cancelLoginVerification, resendLoginCode, verifyLoginCode, type VerifyResult } from "./actions";

const initial: VerifyResult = {};

export function VerifyForm({
  next,
  maskedPhone,
  autoSend = false,
}: {
  next: string;
  maskedPhone: string;
  /** Google ile girişte kod henüz gönderilmedi: sayfa açılınca bir kez gönderilir (sunucuda hız sınırlı). */
  autoSend?: boolean;
}) {
  const [state, action, pending] = useActionState(verifyLoginCode, initial);
  const [resendState, resendAction, resendPending] = useActionState(resendLoginCode, initial);
  const autoSent = useRef(false);

  // Google girişinde SMS'i signIn değil bu sayfa başlatır (tek sefer; yenilemede tekrar göndermemek için
  // `kaynak` parametresi adresten silinir).
  useEffect(() => {
    if (!autoSend || autoSent.current) return;
    autoSent.current = true;
    startTransition(() => resendAction(new FormData()));
    const url = new URL(window.location.href);
    url.searchParams.delete("kaynak");
    window.history.replaceState(null, "", `${url.pathname}${url.search}`);
  }, [autoSend, resendAction]);

  return (
    <AuthShell
      panelTitle="Hesabınız iki adımlı doğrulamayla korunuyor"
      panelDesc={`${autoSend ? "Google hesabınız" : "Şifreniz"} doğrulandı. Son adım olarak telefonunuza gönderilen 6 haneli kodu girin.`}
    >
      <div className="mt-8 lg:mt-0">
        <span className="inline-flex items-center gap-2 rounded-full bg-mint-500/12 px-3 py-1.5 text-xs font-semibold text-mint-600">
          <MessageSquareText className="h-3.5 w-3.5" /> SMS doğrulama
        </span>
        <h1 className="mt-4 font-display text-3xl font-extrabold text-ink-950">Giriş kodunu girin</h1>
        <p className="mt-2 text-sm text-text-muted">
          <span className="font-semibold text-ink-900">{maskedPhone}</span> numaralı telefona 6 haneli bir
          doğrulama kodu gönderdik. Kod 5 dakika geçerlidir.
        </p>

        <form action={action} className="mt-8 space-y-4">
          <input type="hidden" name="next" value={next} />

          <div>
            <label className="mb-1.5 block text-sm font-semibold text-ink-900" htmlFor="code">
              Doğrulama kodu
            </label>
            <input
              id="code"
              name="code"
              type="text"
              inputMode="numeric"
              autoComplete="one-time-code"
              pattern="[0-9]{6}"
              maxLength={6}
              required
              autoFocus
              className="w-full rounded-[var(--radius-card)] border border-line bg-surface px-3.5 py-3 text-center font-display text-2xl font-extrabold tracking-[0.4em] outline-none transition focus:border-brand-400 focus:ring-4 focus:ring-brand-600/10"
              placeholder="••••••"
            />
          </div>

          {state.error ? (
            <p className="rounded-[var(--radius-control)] border border-danger-500/25 bg-danger-500/8 px-3.5 py-2.5 text-sm font-medium text-danger-600" role="alert">
              {state.error}
            </p>
          ) : null}
          {resendState.resent ? (
            <p className="rounded-[var(--radius-control)] border border-mint-500/25 bg-mint-500/8 px-3.5 py-2.5 text-sm font-medium text-mint-600" role="status">
              Yeni kod gönderildi. Telefonunuzu kontrol edin.
            </p>
          ) : resendState.error ? (
            <p className="rounded-[var(--radius-control)] border border-danger-500/25 bg-danger-500/8 px-3.5 py-2.5 text-sm font-medium text-danger-600" role="alert">
              {resendState.error}
            </p>
          ) : null}

          <button
            type="submit"
            disabled={pending}
            className="btn-shine group flex w-full items-center justify-center gap-2 rounded-[var(--radius-card)] bg-[image:var(--grad-brand)] px-4 py-3 text-sm font-semibold text-white shadow-[var(--shadow-glow-brand)] transition hover:brightness-[1.06] disabled:opacity-60"
          >
            {pending ? (
              <>
                <Loader2 className="h-4 w-4 animate-spin" /> Doğrulanıyor…
              </>
            ) : (
              <>
                Doğrula ve giriş yap <ArrowRight className="h-4 w-4 transition group-hover:translate-x-0.5" />
              </>
            )}
          </button>

          <p className="flex items-center justify-center gap-1.5 text-xs text-text-faint">
            <ShieldCheck className="h-3.5 w-3.5 text-mint-600" /> Kod kimseyle paylaşılmaz — EmlakSoft asla kod sormaz
          </p>
        </form>

        <div className="mt-6 flex items-center justify-between border-t border-line pt-5 text-sm">
          <form action={resendAction}>
            <button
              type="submit"
              disabled={resendPending}
              className="inline-flex items-center gap-1.5 font-semibold text-brand-600 hover:underline disabled:opacity-60"
            >
              {resendPending ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <RotateCcw className="h-3.5 w-3.5" />}
              Kodu tekrar gönder
            </button>
          </form>
          <form action={cancelLoginVerification}>
            <button
              type="submit"
              className="inline-flex items-center gap-1.5 font-semibold text-text-muted hover:text-ink-950"
            >
              <LogOut className="h-3.5 w-3.5" /> Vazgeç, çıkış yap
            </button>
          </form>
        </div>
      </div>
    </AuthShell>
  );
}
