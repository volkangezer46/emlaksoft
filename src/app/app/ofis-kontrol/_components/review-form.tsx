"use client";

import { useActionState } from "react";
import { reviewAlert, type OversightResult } from "@/app/actions/oversight";

/** "İncelendi" işareti: isteğe bağlı kısa not + tek tık (satır içi, popup değil). */
export function ReviewForm({ alertKey, disabled }: { alertKey: string; disabled?: boolean }) {
  const [state, action, pending] = useActionState<OversightResult, FormData>(reviewAlert, {});
  return (
    <form action={action} className="flex flex-wrap items-center gap-2">
      <input type="hidden" name="key" value={alertKey} />
      <input
        name="note"
        maxLength={500}
        placeholder="Not (isteğe bağlı)"
        aria-label="İnceleme notu"
        disabled={disabled || pending}
        className="min-w-40 rounded-[var(--radius-control)] border border-line bg-canvas px-2.5 py-1 text-xs outline-none focus:border-brand-400"
      />
      <button
        type="submit"
        disabled={disabled || pending}
        title={disabled ? "İnceleme kaydı için veritabanı güncellemesi bekleniyor" : undefined}
        className="focus-ring press rounded-[var(--radius-control)] border border-line px-2.5 py-1 text-xs font-semibold text-text-muted transition hover:border-mint-500 hover:text-mint-700 disabled:cursor-not-allowed disabled:opacity-50"
      >
        {pending ? "Kaydediliyor…" : "İncelendi olarak işaretle"}
      </button>
      {state.error ? (
        <span role="alert" className="text-xs font-semibold text-danger-600">
          {state.error}
        </span>
      ) : null}
    </form>
  );
}
