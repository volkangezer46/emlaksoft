"use client";

import Link from "next/link";
import { useActionState, useState } from "react";
import { ArrowRight, Eye, EyeOff, Loader2, Lock, Mail, ShieldCheck } from "lucide-react";
import { signIn, type AuthResult } from "@/app/actions/auth";
import { AuthShell } from "@/components/auth/auth-shell";
import { DemoQuickLogin } from "./demo-quick-login";

const initial: AuthResult = {};

export function LoginForm({ next, demoEnabled }: { next: string; demoEnabled: boolean }) {
  const [state, action, pending] = useActionState(signIn, initial);
  const [showPassword, setShowPassword] = useState(false);

  return (
    <AuthShell
      panelTitle="Ofisinizi yönetmenin en hızlı yolu"
      panelDesc="Müşteriden komisyona, portal takibinden e-imzaya — günlük tüm ofis operasyonu tek güvenli panelde."
    >
      <div className="mt-8 lg:mt-0">
        <h1 className="font-display text-3xl font-extrabold text-ink-950">Tekrar hoş geldiniz</h1>
        <p className="mt-2 text-sm text-text-muted">
          Ofis çalışma alanınıza veya EmlakSoft personel paneline aynı kapıdan girin.
        </p>

        <form action={action} className="mt-8 space-y-4">
          <input type="hidden" name="next" value={next} />

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

          <div>
            <label className="mb-1.5 block text-sm font-semibold text-ink-900" htmlFor="password">
              Şifre
            </label>
            <div className="relative">
              <Lock className="pointer-events-none absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-text-faint" />
              <input
                id="password"
                name="password"
                type={showPassword ? "text" : "password"}
                required
                autoComplete="current-password"
                className="w-full rounded-[12px] border border-line bg-surface py-3 pl-10 pr-11 text-sm outline-none transition focus:border-brand-400 focus:ring-4 focus:ring-brand-600/10"
                placeholder="••••••••"
              />
              <button
                type="button"
                onClick={() => setShowPassword((v) => !v)}
                className="absolute right-2 top-1/2 grid h-8 w-8 -translate-y-1/2 place-items-center rounded-[8px] text-text-faint transition hover:bg-canvas hover:text-ink-800"
                aria-label={showPassword ? "Şifreyi gizle" : "Şifreyi göster"}
              >
                {showPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
              </button>
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
                <Loader2 className="h-4 w-4 animate-spin" /> Giriş yapılıyor…
              </>
            ) : (
              <>
                Giriş yap <ArrowRight className="h-4 w-4 transition group-hover:translate-x-0.5" />
              </>
            )}
          </button>

          <p className="flex items-center justify-center gap-1.5 text-[11px] text-text-faint">
            <ShieldCheck className="h-3.5 w-3.5 text-mint-600" /> 256-bit TLS ile şifreli bağlantı
          </p>
        </form>

        {demoEnabled ? <DemoQuickLogin /> : null}

        <p className="mt-8 border-t border-line pt-6 text-center text-sm text-text-muted">
          Hesabınız yok mu?{" "}
          <Link href="/kayit" className="font-semibold text-brand-600 hover:underline">
            14 gün ücretsiz deneyin
          </Link>
        </p>
      </div>
    </AuthShell>
  );
}
