"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import {
  ArrowRight,
  CheckCircle2,
  Eye,
  EyeOff,
  Loader2,
  Lock,
  ShieldAlert,
  ShieldCheck,
} from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import { AuthShell } from "@/components/auth/auth-shell";
import { PasswordStrengthMeter } from "@/components/auth/password-strength";

type Phase = "checking" | "ready" | "invalid" | "done";

const inputCls =
  "w-full rounded-[12px] border border-line bg-surface py-3 pl-10 pr-11 text-sm outline-none transition focus:border-brand-400 focus:ring-4 focus:ring-brand-600/10";

export function ResetPasswordForm() {
  const supabase = useMemo(() => createClient(), []);
  const [phase, setPhase] = useState<Phase>("checking");
  const [pw, setPw] = useState("");
  const [pw2, setPw2] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  // Recovery oturumu kontrolü: kod takası (?code=) istemci tarafında otomatik
  // yapılır; oturum düşmezse bağlantı geçersiz/süresi dolmuş demektir.
  useEffect(() => {
    let active = true;
    // Supabase hata parametreleri (otp_expired vb.) hash'te veya query'de gelir
    const urlHasError = /error(_code|_description)?=/.test(
      window.location.hash + window.location.search,
    );

    const markReady = () => {
      if (active && !urlHasError) setPhase((p) => (p === "checking" ? "ready" : p));
    };

    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((_event, session) => {
      if (session) markReady();
    });
    supabase.auth.getSession().then(({ data }) => {
      if (!active) return;
      if (urlHasError) setPhase((p) => (p === "checking" ? "invalid" : p));
      else if (data.session) markReady();
    });
    // Kod takası birkaç saniye içinde sonuçlanmazsa bağlantıyı geçersiz say
    const timer = setTimeout(() => {
      if (active) setPhase((p) => (p === "checking" ? "invalid" : p));
    }, 5000);

    return () => {
      active = false;
      subscription.unsubscribe();
      clearTimeout(timer);
    };
  }, [supabase]);

  async function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError(null);
    if (pw.length < 8) {
      setError("Şifre en az 8 karakter olmalı.");
      return;
    }
    if (pw !== pw2) {
      setError("Şifreler eşleşmiyor. İki alana da aynı şifreyi yazın.");
      return;
    }
    setPending(true);
    const { error: updateError } = await supabase.auth.updateUser({ password: pw });
    setPending(false);
    if (updateError) {
      const msg = updateError.message ?? "";
      if (msg.includes("different from the old")) {
        setError("Yeni şifreniz eski şifrenizle aynı olamaz.");
      } else if (msg.includes("session missing") || msg.toLowerCase().includes("expired")) {
        setPhase("invalid");
      } else {
        setError("Şifre güncellenemedi. Bağlantının süresi dolmuş olabilir; yeni bağlantı isteyin.");
      }
      return;
    }
    setPhase("done");
  }

  return (
    <AuthShell
      panelTitle="Yeni şifrenizi belirleyin"
      panelDesc="Sıfırlama bağlantısı doğrulandıktan sonra hesabınıza yalnızca yeni şifrenizle girilir. Güçlü ve size özel bir şifre seçin."
    >
      <div className="mt-8 lg:mt-0">
        {phase === "checking" ? (
          <div className="rounded-[16px] border border-line bg-surface px-6 py-12 text-center">
            <Loader2 className="mx-auto h-8 w-8 animate-spin text-brand-600" />
            <p className="mt-4 text-sm font-semibold text-ink-950">Bağlantı doğrulanıyor…</p>
            <p className="mt-1 text-sm text-text-muted">Lütfen birkaç saniye bekleyin.</p>
          </div>
        ) : phase === "invalid" ? (
          <div className="rounded-[16px] border border-danger-500/25 bg-danger-500/8 px-6 py-10 text-center">
            <ShieldAlert className="mx-auto h-10 w-10 text-danger-500" />
            <p className="mt-3 font-display text-lg font-bold text-ink-950">
              Bağlantı geçersiz veya süresi dolmuş
            </p>
            <p className="mt-1 text-sm text-text-muted">
              Sıfırlama bağlantıları tek kullanımlıktır ve kısa süre geçerlidir. Bağlantıyı,
              isteği yaptığınız tarayıcıda açtığınızdan emin olun ya da yeni bağlantı isteyin.
            </p>
            <Link
              href="/sifre-sifirla"
              className="btn-shine mt-5 inline-flex items-center justify-center gap-2 rounded-[12px] bg-brand-600 px-5 py-2.5 text-sm font-semibold text-white transition hover:bg-brand-700"
            >
              Yeni bağlantı iste <ArrowRight className="h-4 w-4" />
            </Link>
          </div>
        ) : phase === "done" ? (
          <div className="rounded-[16px] border border-mint-500/30 bg-mint-500/10 px-6 py-10 text-center">
            <CheckCircle2 className="mx-auto h-10 w-10 text-mint-600" />
            <p className="mt-3 font-display text-lg font-bold text-ink-950">Şifreniz güncellendi</p>
            <p className="mt-1 text-sm text-text-muted">
              Artık yeni şifrenizle giriş yapabilirsiniz. Oturumunuz açık; panele devam edin.
            </p>
            <Link
              href="/app"
              className="btn-shine mt-5 inline-flex items-center justify-center gap-2 rounded-[12px] bg-brand-600 px-5 py-2.5 text-sm font-semibold text-white transition hover:bg-brand-700"
            >
              Panele devam et <ArrowRight className="h-4 w-4" />
            </Link>
          </div>
        ) : (
          <>
            <h1 className="font-display text-3xl font-extrabold text-ink-950">Yeni şifre belirleyin</h1>
            <p className="mt-2 text-sm text-text-muted">
              Hesabınız doğrulandı. Aşağıya yeni şifrenizi girin; işlem sonrası tüm girişler bu
              şifreyle yapılır.
            </p>

            <form onSubmit={onSubmit} className="mt-8 space-y-4">
              <div>
                <label className="mb-1.5 block text-sm font-semibold text-ink-900" htmlFor="password">
                  Yeni şifre
                </label>
                <div className="relative">
                  <Lock className="pointer-events-none absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-text-faint" />
                  <input
                    id="password"
                    type={showPassword ? "text" : "password"}
                    required
                    minLength={8}
                    autoComplete="new-password"
                    autoFocus
                    placeholder="En az 8 karakter"
                    value={pw}
                    onChange={(e) => setPw(e.target.value)}
                    className={inputCls}
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
                <PasswordStrengthMeter password={pw} />
              </div>

              <div>
                <label className="mb-1.5 block text-sm font-semibold text-ink-900" htmlFor="password2">
                  Yeni şifre (tekrar)
                </label>
                <div className="relative">
                  <Lock className="pointer-events-none absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-text-faint" />
                  <input
                    id="password2"
                    type={showPassword ? "text" : "password"}
                    required
                    minLength={8}
                    autoComplete="new-password"
                    placeholder="Şifrenizi tekrar yazın"
                    value={pw2}
                    onChange={(e) => setPw2(e.target.value)}
                    className={inputCls}
                  />
                </div>
              </div>

              {error ? (
                <p className="rounded-[10px] border border-danger-500/25 bg-danger-500/8 px-3.5 py-2.5 text-sm font-medium text-danger-600" role="alert">
                  {error}
                </p>
              ) : null}

              <button
                type="submit"
                disabled={pending}
                className="btn-shine group flex w-full items-center justify-center gap-2 rounded-[12px] bg-[image:var(--grad-brand)] px-4 py-3 text-sm font-semibold text-white shadow-[var(--shadow-glow-brand)] transition hover:brightness-[1.06] disabled:opacity-60"
              >
                {pending ? (
                  <>
                    <Loader2 className="h-4 w-4 animate-spin" /> Güncelleniyor…
                  </>
                ) : (
                  <>
                    Şifreyi güncelle <ArrowRight className="h-4 w-4 transition group-hover:translate-x-0.5" />
                  </>
                )}
              </button>

              <p className="flex items-center justify-center gap-1.5 text-[11px] text-text-faint">
                <ShieldCheck className="h-3.5 w-3.5 text-mint-600" /> 256-bit TLS ile şifreli bağlantı
              </p>
            </form>
          </>
        )}
      </div>
    </AuthShell>
  );
}
