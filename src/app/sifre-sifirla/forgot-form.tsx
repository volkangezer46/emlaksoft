"use client";

import Link from "next/link";
import { useActionState } from "react";
import { ArrowLeft, KeyRound, Loader2, Mail, MailCheck, Send } from "lucide-react";
import { requestPasswordReset, type PasswordResetResult } from "@/app/actions/password-reset";
import { AuthShell } from "@/components/auth/auth-shell";

const initial: PasswordResetResult = {};

export function ForgotPasswordForm() {
  const [state, action, pending] = useActionState(requestPasswordReset, initial);

  return (
    <AuthShell
      panelTitle="Hesabınıza güvenle yeniden erişin"
      panelDesc="E-posta adresinize tek kullanımlık bir sıfırlama bağlantısı gönderilir; şifreniz yalnızca sizin belirlediğiniz yenisiyle değişir."
    >
      <div className="mt-8 lg:mt-0">
        <span className="grid h-12 w-12 place-items-center rounded-[14px] bg-brand-600/10 text-brand-600">
          <KeyRound className="h-6 w-6" />
        </span>
        <h1 className="mt-4 font-display text-3xl font-extrabold text-ink-950">Şifrenizi mi unuttunuz?</h1>
        <p className="mt-2 text-sm text-text-muted">
          Kayıtlı e-posta adresinizi girin; şifre sıfırlama bağlantısını gönderelim.
        </p>

        {state.ok ? (
          <div className="mt-8 rounded-[16px] border border-mint-500/30 bg-mint-500/10 px-6 py-8 text-center">
            <MailCheck className="mx-auto h-10 w-10 text-mint-600" />
            <p className="mt-3 font-display text-lg font-bold text-ink-950">Bağlantı gönderildi</p>
            {/* Nötr mesaj — e-postanın kayıtlı olup olmadığı bilinçli olarak söylenmez */}
            <p className="mt-1 text-sm text-text-muted">
              Girdiğiniz adres sistemimizde kayıtlıysa şifre sıfırlama bağlantısı birkaç dakika
              içinde e-posta kutunuza düşer. Spam klasörünü de kontrol etmeyi unutmayın.
            </p>
            <Link href="/giris" className="mt-5 inline-flex items-center gap-1.5 text-sm font-semibold text-brand-600 hover:underline">
              <ArrowLeft className="h-4 w-4" /> Girişe dön
            </Link>
          </div>
        ) : (
          <form action={action} className="mt-8 space-y-4">
            <div>
              <label className="mb-1.5 block text-sm font-semibold text-ink-900" htmlFor="email">
                E-posta
              </label>
              <div className="relative">
                <Mail className="pointer-events-none absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-text-faint" />
                <input
                  id="email"
                  name="email"
                  type="email"
                  required
                  autoComplete="email"
                  autoFocus
                  className="w-full rounded-[12px] border border-line bg-surface py-3 pl-10 pr-3.5 text-sm outline-none transition focus:border-brand-400 focus:ring-4 focus:ring-brand-600/10"
                  placeholder="ornek@ofis.com"
                />
              </div>
            </div>

            {state.error ? (
              <p className="rounded-[10px] border border-danger-500/25 bg-danger-500/8 px-3.5 py-2.5 text-sm font-medium text-danger-600" role="alert">
                {state.error}
              </p>
            ) : null}

            <button
              type="submit"
              disabled={pending}
              className="btn-shine group flex w-full items-center justify-center gap-2 rounded-[12px] bg-[image:var(--grad-brand)] px-4 py-3 text-sm font-semibold text-white shadow-[var(--shadow-glow-brand)] transition hover:brightness-[1.06] disabled:opacity-60"
            >
              {pending ? (
                <>
                  <Loader2 className="h-4 w-4 animate-spin" /> Gönderiliyor…
                </>
              ) : (
                <>
                  <Send className="h-4 w-4" /> Sıfırlama bağlantısı gönder
                </>
              )}
            </button>
          </form>
        )}

        <p className="mt-8 border-t border-line pt-6 text-center text-sm text-text-muted">
          Şifrenizi hatırladınız mı?{" "}
          <Link href="/giris" className="font-semibold text-brand-600 hover:underline">
            Giriş yap
          </Link>
        </p>
      </div>
    </AuthShell>
  );
}
