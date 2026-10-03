"use client";

import { useActionState, useRef } from "react";
import Link from "next/link";
import { ArrowRight, Check, Sparkles } from "lucide-react";
import { requestDemo, type DemoResult } from "@/app/actions/demo";
import { PhoneInput } from "@/components/ui/phone-input";
import { EmailInput } from "@/components/ui/email-input";

const initial: DemoResult = {};

export function DemoForm() {
  const [state, action, pending] = useActionState(requestDemo, initial);
  const requestIdRef = useRef<HTMLInputElement>(null);

  if (state.ok) {
    return (
      <div className="rounded-[var(--radius-card)] border border-mint-500/30 bg-mint-500/10 px-6 py-10 text-center">
        <Check className="mx-auto h-8 w-8 text-mint-600" />
        <p className="mt-3 font-display text-lg font-bold text-ink-950">Talebiniz alındı</p>
        <p className="mt-1 text-sm text-text-muted">Ekibimiz en kısa sürede sizi arayacak.</p>
        {state.referenceCode ? (
          <p className="mt-3 text-xs font-semibold text-brand-700">
            Takip numaranız: <span className="font-mono">{state.referenceCode}</span>
          </p>
        ) : null}
        <div className="mt-6 rounded-[var(--radius-card)] border border-line bg-surface px-4 py-4 text-left">
          <p className="text-sm font-bold text-ink-950">Beklerken kendiniz deneyin</p>
          <p className="mt-0.5 text-xs text-text-muted">
            14 gün ücretsiz, kredi kartsız · ofisinizi hemen kurup gezinmeye başlayın.
          </p>
          <Link
            href="/kayit"
            className="btn-shine mt-3 inline-flex items-center gap-1.5 rounded-[var(--radius-control)] bg-brand-600 px-4 py-2 text-xs font-semibold text-white transition hover:bg-brand-700"
          >
            Ücretsiz hesap oluştur <ArrowRight className="h-3.5 w-3.5" />
          </Link>
        </div>
        <Link
          href="/"
          className="mt-5 inline-block text-sm font-semibold text-brand-600 hover:underline"
        >
          Ana sayfaya dön
        </Link>
      </div>
    );
  }

  return (
    <form
      action={action}
      onSubmit={() => {
        if (requestIdRef.current && !requestIdRef.current.value) {
          requestIdRef.current.value = crypto.randomUUID();
        }
      }}
      className="space-y-4 text-left"
    >
      <input ref={requestIdRef} type="hidden" name="request_id" />
      <input
        type="text"
        name="website"
        tabIndex={-1}
        autoComplete="off"
        aria-hidden="true"
        className="absolute left-[-9999px] h-0 w-0 opacity-0"
      />
      <div>
        <label className="mb-1.5 block text-sm text-text-muted" htmlFor="full_name">
          Ad soyad *
        </label>
        <input
          id="full_name"
          name="full_name"
          required
          maxLength={120}
          autoComplete="name"
          className="w-full rounded-[var(--radius-control)] border border-line bg-canvas px-3 py-2.5 text-sm outline-none focus:border-brand-400"
          placeholder="Örn. Volkan Gezer"
        />
      </div>
      <div>
        <label className="mb-1.5 block text-sm text-text-muted" htmlFor="phone">
          Telefon *
        </label>
        <PhoneInput id="phone" name="phone" required />
      </div>
      <div>
        <label className="mb-1.5 block text-sm text-text-muted" htmlFor="email">
          E-posta <span className="text-text-faint">(opsiyonel)</span>
        </label>
        <EmailInput
          id="email"
          name="email"
          maxLength={254}
          autoComplete="email"
          className="w-full rounded-[var(--radius-control)] border border-line bg-canvas px-3 py-2.5 text-sm outline-none focus:border-brand-400"
          placeholder="ornek@ofis.com"
        />
      </div>
      <div>
        <label className="mb-1.5 block text-sm text-text-muted" htmlFor="company">
          Firma / ofis
        </label>
        <input
          id="company"
          name="company"
          maxLength={160}
          autoComplete="organization"
          className="w-full rounded-[var(--radius-control)] border border-line bg-canvas px-3 py-2.5 text-sm outline-none focus:border-brand-400"
          placeholder="Örn. Gezertaşar Emlak"
        />
      </div>
      <label className="flex cursor-pointer items-start gap-2.5 rounded-[var(--radius-control)] border border-line bg-canvas px-3 py-2.5 text-xs leading-relaxed text-text-muted transition hover:border-brand-300">
        <input
          type="checkbox"
          name="consent"
          value="1"
          required
          className="mt-0.5 h-4 w-4 shrink-0 accent-brand-600"
        />
        <span>
          İletişim bilgilerimin demo ve tanıtım amacıyla işlenmesini kabul ediyorum.{" "}
          <Link
            href="/kvkk-aydinlatma"
            target="_blank"
            rel="noopener noreferrer"
            className="font-semibold text-brand-600 hover:underline"
          >
            KVKK Aydınlatma Metni
          </Link>
        </span>
      </label>
      {state.error ? (
        <p className="text-sm text-danger-500" role="alert">
          {state.error}
        </p>
      ) : null}
      <button
        type="submit"
        disabled={pending}
        className="btn-shine inline-flex w-full items-center justify-center gap-2 rounded-[var(--radius-control)] bg-brand-600 px-4 py-2.5 text-sm font-semibold text-white disabled:opacity-60"
      >
        <Sparkles className="h-4 w-4" />
        {pending ? "Gönderiliyor…" : "Demo planla"}
      </button>
    </form>
  );
}
