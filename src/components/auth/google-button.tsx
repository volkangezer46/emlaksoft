"use client";

import { useState } from "react";
import { Loader2 } from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import { GOOGLE_CALLBACK_PATH, safeNextPath } from "@/lib/auth/google-auth";

/** Google'ın resmi çok renkli "G" işareti (marka kılavuzu: değiştirilmez, 18 px). */
export function GoogleGIcon({ className = "h-[18px] w-[18px]" }: { className?: string }) {
  return (
    <svg viewBox="0 0 48 48" aria-hidden="true" focusable="false" className={className}>
      <path
        fill="#EA4335"
        d="M24 9.5c3.54 0 6.71 1.22 9.21 3.6l6.85-6.85C35.9 2.38 30.47 0 24 0 14.62 0 6.51 5.38 2.56 13.22l7.98 6.19C12.43 13.72 17.74 9.5 24 9.5z"
      />
      <path
        fill="#4285F4"
        d="M46.98 24.55c0-1.57-.15-3.09-.38-4.55H24v9.02h12.94c-.58 2.96-2.26 5.48-4.78 7.18l7.73 6c4.51-4.18 7.09-10.36 7.09-17.65z"
      />
      <path
        fill="#FBBC05"
        d="M10.53 28.59c-.48-1.45-.76-2.99-.76-4.59s.27-3.14.76-4.59l-7.98-6.19C.92 16.46 0 20.12 0 24c0 3.88.92 7.54 2.56 10.78l7.97-6.19z"
      />
      <path
        fill="#34A853"
        d="M24 48c6.48 0 11.93-2.13 15.89-5.81l-7.73-6c-2.15 1.45-4.92 2.3-8.16 2.3-6.26 0-11.57-4.22-13.47-9.91l-7.98 6.19C6.51 42.62 14.62 48 24 48z"
      />
    </svg>
  );
}

/** Callback adresi: aynı origin + göreli `next` (açık yönlendirme yok) + akış türü. */
export function googleRedirectTo(origin: string, next: string, flow: "login" | "link" = "login"): string {
  const u = new URL(GOOGLE_CALLBACK_PATH, origin);
  u.searchParams.set("next", safeNextPath(next));
  if (flow === "link") u.searchParams.set("akis", "link");
  return u.toString();
}

/**
 * "Google ile devam et" — Google marka kurallarına uygun (beyaz zemin, gri çerçeve, resmi G, koyu metin).
 * Supabase OAuth (PKCE; doğrulayıcı çerezde, state Supabase'de) başlatır; tarayıcı Google'a gider.
 * Görünürlük bayrağını (NEXT_PUBLIC_GOOGLE_AUTH_ENABLED) çağıran sayfa denetler.
 */
export function GoogleAuthButton({
  next = "/app",
  label = "Google ile devam et",
  className = "",
}: {
  next?: string;
  label?: string;
  className?: string;
}) {
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function start() {
    if (pending) return;
    setPending(true);
    setError(null);
    try {
      const { error: oauthError } = await createClient().auth.signInWithOAuth({
        provider: "google",
        options: {
          redirectTo: googleRedirectTo(window.location.origin, next),
          queryParams: { prompt: "select_account" },
        },
      });
      if (oauthError) throw oauthError;
      // Başarılıysa tarayıcı Google'a yönlenir; düğme yükleniyor durumunda kalır.
    } catch (e) {
      console.error("google oauth start", e);
      setError("Google ile bağlantı başlatılamadı. Lütfen tekrar deneyin.");
      setPending(false);
    }
  }

  return (
    <div className={className}>
      <button
        type="button"
        onClick={start}
        disabled={pending}
        aria-busy={pending || undefined}
        className="flex min-h-[46px] w-full items-center justify-center gap-3 rounded-[var(--radius-card)] border border-[#747775] bg-white px-4 py-2.5 text-sm font-medium text-[#1f1f1f] shadow-[var(--shadow-xs)] transition hover:bg-[#f8f9fa] hover:shadow-[var(--elev-2)] focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-brand-600/20 disabled:cursor-wait disabled:opacity-70"
        style={{ fontFamily: "Roboto, var(--font-sans, system-ui), sans-serif" }}
      >
        {pending ? <Loader2 className="h-[18px] w-[18px] animate-spin text-[#1f1f1f]" aria-hidden="true" /> : <GoogleGIcon />}
        <span>{pending ? "Google'a yönlendiriliyor…" : label}</span>
      </button>
      {error ? (
        <p role="alert" className="mt-2 text-xs font-medium text-danger-600">
          {error}
        </p>
      ) : null}
    </div>
  );
}

/** E-posta formuyla Google düğmesi arasındaki "veya" ayırıcısı. */
export function AuthDivider({ label = "veya e-posta ile" }: { label?: string }) {
  return (
    <div className="my-5 flex items-center gap-3 text-xs font-medium text-text-faint" role="separator" aria-label={label}>
      <span className="h-px flex-1 bg-line" />
      <span>{label}</span>
      <span className="h-px flex-1 bg-line" />
    </div>
  );
}
