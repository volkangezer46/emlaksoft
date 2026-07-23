"use client";

import { useActionState } from "react";
import Link from "next/link";
import { Check, Sparkles } from "lucide-react";
import { requestDemo, type DemoResult } from "@/app/actions/demo";
import { PhoneInput } from "@/components/ui/phone-input";

const initial: DemoResult = {};

export function DemoForm() {
  const [state, action, pending] = useActionState(requestDemo, initial);

  if (state.ok) {
    return (
      <div className="rounded-[16px] border border-mint-500/30 bg-mint-500/10 px-6 py-10 text-center">
        <Check className="mx-auto h-8 w-8 text-mint-600" />
        <p className="mt-3 font-display text-lg font-bold text-ink-950">Talebiniz alındı</p>
        <p className="mt-1 text-sm text-text-muted">Ekibimiz en kısa sürede sizi arayacak.</p>
        <Link href="/" className="mt-5 inline-block text-sm font-semibold text-brand-600 hover:underline">
          Ana sayfaya dön
        </Link>
      </div>
    );
  }

  return (
    <form action={action} className="space-y-4 text-left">
      <div>
        <label className="mb-1.5 block text-sm text-text-muted" htmlFor="full_name">Ad soyad *</label>
        <input id="full_name" name="full_name" required className="w-full rounded-[10px] border border-line bg-canvas px-3 py-2.5 text-sm outline-none focus:border-brand-400" placeholder="Örn. Volkan Gezer" />
      </div>
      <div>
        <label className="mb-1.5 block text-sm text-text-muted" htmlFor="phone">Telefon *</label>
        <PhoneInput id="phone" name="phone" required />
      </div>
      <div>
        <label className="mb-1.5 block text-sm text-text-muted" htmlFor="company">Firma / ofis</label>
        <input id="company" name="company" className="w-full rounded-[10px] border border-line bg-canvas px-3 py-2.5 text-sm outline-none focus:border-brand-400" placeholder="Gezertaşar Emlak" />
      </div>
      {state.error ? <p className="text-sm text-danger-500" role="alert">{state.error}</p> : null}
      <button
        type="submit"
        disabled={pending}
        className="btn-shine inline-flex w-full items-center justify-center gap-2 rounded-[10px] bg-brand-600 px-4 py-2.5 text-sm font-semibold text-white disabled:opacity-60"
      >
        <Sparkles className="h-4 w-4" />
        {pending ? "Gönderiliyor…" : "Demo planla"}
      </button>
    </form>
  );
}
