"use client";

import { useActionState, useEffect, useRef } from "react";
import { useRouter } from "next/navigation";
import { Loader2, Plus, Trash2 } from "lucide-react";
import {
  createTicketMacro,
  deleteTicketMacro,
  type AdminTicketOpsResult,
} from "@/app/actions/admin-ticket-ops";
import { Button } from "@/components/ui/button";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";

function DeleteMacroButton({ id, title }: { id: string; title: string }) {
  const router = useRouter();
  const [state, action, pending] = useActionState<AdminTicketOpsResult, FormData>(
    async (_previous, formData) => deleteTicketMacro(formData),
    {},
  );
  useEffect(() => {
    if (state.ok) router.refresh();
  }, [router, state.ok]);

  return (
    <div className="shrink-0 text-right">
      <ConfirmDialog
        trigger={
          <button
            type="button"
            disabled={pending}
            aria-label={`“${title}” makrosunu sil`}
            className="focus-ring rounded-md p-1.5 text-text-faint transition hover:bg-danger-500/10 hover:text-danger-600 disabled:opacity-50"
          >
            {pending ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Trash2 className="h-3.5 w-3.5" />}
          </button>
        }
        title="Hazır yanıt silinsin mi?"
        description={`“${title}” hazır yanıtı kalıcı olarak kaldırılacak.`}
        confirmLabel="Hazır yanıtı sil"
        tone="danger"
        formAction={action}
        hiddenFields={{ id }}
      />
      {state.error ? <p className="mt-1 max-w-32 text-xs font-semibold text-danger-600" role="alert">{state.error}</p> : null}
    </div>
  );
}

export function TicketMacroManager({ macros }: { macros: { id: string; title: string; body: string }[] }) {
  const router = useRouter();
  const formRef = useRef<HTMLFormElement>(null);
  const [state, action, pending] = useActionState<AdminTicketOpsResult, FormData>(
    async (_previous, formData) => {
      const result = await createTicketMacro(formData);
      if (result.ok) {
        formRef.current?.reset();
        router.refresh();
      }
      return result;
    },
    {},
  );

  return (
    <details className="group rounded-[var(--radius-card)] border border-line bg-surface p-4">
      <summary className="flex cursor-pointer list-none items-center justify-between text-sm font-bold text-ink-950">
        Hazır yanıtlar <span className="text-xs font-semibold text-text-faint">{macros.length} makro</span>
      </summary>
      <div className="mt-3 space-y-3">
        {macros.length ? (
          <ul className="space-y-1.5">
            {macros.map((macro) => (
              <li key={macro.id} className="flex items-start gap-2 rounded-[var(--radius-control)] border border-line bg-canvas/55 px-2.5 py-2">
                <div className="min-w-0 flex-1">
                  <p className="text-xs font-semibold text-ink-950">{macro.title}</p>
                  <p className="mt-0.5 line-clamp-2 text-xs text-text-muted">{macro.body}</p>
                </div>
                <DeleteMacroButton id={macro.id} title={macro.title} />
              </li>
            ))}
          </ul>
        ) : <p className="text-xs text-text-faint">Henüz hazır yanıt yok.</p>}
        <form ref={formRef} action={action} className="space-y-2">
          <input aria-label="Makro başlığı" type="text" name="title" required maxLength={120} placeholder="Makro başlığı" className="w-full rounded-[var(--radius-control)] border border-line bg-canvas px-2.5 py-2 text-xs outline-none focus:border-brand-400" />
          <textarea aria-label="Makro metni" name="body" required minLength={3} maxLength={5000} rows={3} placeholder="Hazır yanıt metni…" className="w-full resize-y rounded-[var(--radius-control)] border border-line bg-canvas px-2.5 py-2 text-xs outline-none focus:border-brand-400" />
          <Button type="submit" size="sm" icon={Plus} loading={pending} className="w-full">Makro ekle</Button>
          {state.error ? <p className="text-xs font-semibold text-danger-600" role="alert">{state.error}</p> : null}
          {state.ok ? <p className="text-xs font-semibold text-mint-700" role="status">Hazır yanıt eklendi.</p> : null}
        </form>
      </div>
    </details>
  );
}
