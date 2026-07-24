"use client";

import { useActionState } from "react";
import { CheckCircle2, PenLine } from "lucide-react";
import { submitSignatureByToken, type ContractResult } from "@/app/actions/contracts";

const initial: ContractResult = {};

export function SignPanel({ token, signerName }: { token: string; signerName: string }) {
  const [state, action, pending] = useActionState(submitSignatureByToken, initial);

  if (state.ok) {
    return (
      <div className="rounded-[14px] border border-mint-500/30 bg-mint-500/10 px-5 py-6 text-center">
        <CheckCircle2 className="mx-auto h-10 w-10 text-mint-600" />
        <p className="mt-3 font-display text-lg font-bold text-ink-950">İmzanız alındı</p>
        <p className="mt-1 text-sm text-text-muted">
          Teşekkürler {signerName}. Onayınız kaydedildi; taraflar bilgilendirilecektir.
        </p>
      </div>
    );
  }

  return (
    <form action={action}>
      <input type="hidden" name="token" value={token} />
      <label className="flex cursor-pointer items-start gap-2.5 rounded-[12px] border border-line bg-canvas px-4 py-3 text-sm text-ink-950">
        <input type="checkbox" name="consent" required className="mt-0.5 h-4 w-4 accent-brand-600" />
        <span>
          Sözleşme metnini okudum, anladım ve içeriğini kabul ederek elektronik ortamda
          imzalamayı onaylıyorum.
        </span>
      </label>

      {state.error ? (
        <p className="mt-3 rounded-[10px] border border-danger-500/30 bg-danger-500/10 px-3 py-2 text-xs text-danger-600" role="alert">
          {state.error}
        </p>
      ) : null}

      <button
        type="submit"
        disabled={pending}
        className="btn-shine mt-4 inline-flex w-full items-center justify-center gap-2 rounded-[12px] bg-brand-600 px-4 py-3 text-sm font-semibold text-white transition hover:bg-brand-700 disabled:opacity-60"
      >
        <PenLine className="h-4 w-4" />
        {pending ? "İmzalanıyor…" : "Sözleşmeyi imzala"}
      </button>
    </form>
  );
}
