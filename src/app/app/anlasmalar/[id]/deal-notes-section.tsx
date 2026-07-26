"use client";

import { useActionState, useRef } from "react";
import { useRouter } from "next/navigation";
import { MessageSquare, Send, Trash2 } from "lucide-react";
import { addDealNote, deleteDealNote, type DealNote, type DealResult } from "@/app/actions/deals";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { useToast } from "@/components/app/toast-provider";
import { relativeTimeTR } from "@/lib/admin-format";

function initials(name: string) {
  return name
    .split(/\s+/)
    .map((p) => p[0] ?? "")
    .join("")
    .slice(0, 2)
    .toUpperCase();
}

/**
 * Not/yorum akışı — denetim bulgusu: anlaşmaya yorum yazılamıyordu.
 *
 * Kronolojik akış (eski → yeni, sohbet gibi): yazar + göreli zaman + gövde.
 * Silme YALNIZ kendi notunda görünür (RLS + action zaten kilitler, UI da
 * göstermez). Notlar düzenlenemez — akış değiştirilemez bir iz.
 * Enter gönderir, Shift+Enter yeni satır (textarea'da beklenen sohbet deseni).
 */
export function DealNotesSection({
  dealId,
  notes,
  canEdit,
  currentUserId,
}: {
  dealId: string;
  notes: DealNote[];
  canEdit: boolean;
  currentUserId: string;
}) {
  const router = useRouter();
  const { push } = useToast();
  const formRef = useRef<HTMLFormElement>(null);

  const [state, action, pending] = useActionState<DealResult, FormData>(
    async (prev, formData) => {
      const result = await addDealNote(prev, formData);
      if (result.ok) {
        formRef.current?.reset();
        push("Not eklendi", "ok");
        router.refresh();
      }
      return result;
    },
    {},
  );

  return (
    <section className="surface-card rounded-[var(--radius-panel)] p-5">
      <h2 className="flex items-center gap-2 font-display font-bold text-ink-950">
        <MessageSquare className="h-4 w-4 text-brand-600" /> Notlar
        {notes.length > 0 ? (
          <span className="numeric rounded-full bg-canvas px-2 py-0.5 text-xs font-bold text-text-muted">
            {notes.length}
          </span>
        ) : null}
      </h2>
      <p className="mt-1 text-[11px] text-text-faint">
        Ekip içi not akışı — teklif dönüşümü gibi sistem izleri de buraya düşer.
      </p>

      {notes.length === 0 ? (
        <p className="mt-3 rounded-[12px] border border-dashed border-line-strong px-4 py-6 text-center text-sm text-text-muted">
          Henüz not yok. İlk notu siz yazın.
        </p>
      ) : (
        <ul className="mt-3 space-y-2">
          {notes.map((n) => {
            const mine = n.author_id === currentUserId;
            const yazar = n.author_name ?? "Ayrılmış kullanıcı";
            return (
              <li
                key={n.id}
                className="group/not flex items-start gap-3 rounded-[12px] border border-line bg-canvas px-4 py-3"
              >
                <span className="mt-0.5 grid h-7 w-7 shrink-0 place-items-center rounded-full bg-[image:var(--grad-brand)] text-[9px] font-bold text-white">
                  {initials(yazar)}
                </span>
                <div className="min-w-0 flex-1">
                  <p className="flex flex-wrap items-baseline gap-x-2 text-xs">
                    <span className="font-bold text-ink-950">{yazar}</span>
                    <span className="text-text-faint">{relativeTimeTR(n.created_at)}</span>
                  </p>
                  <p className="mt-1 whitespace-pre-wrap break-words text-sm text-ink-950">{n.body}</p>
                </div>
                {mine && canEdit ? (
                  <ConfirmDialog
                    title="Notu sil"
                    description="Bu not silinecek. Bu işlem geri alınamaz."
                    confirmLabel="Sil"
                    formAction={deleteDealNote}
                    hiddenFields={{ note_id: n.id, deal_id: dealId }}
                    trigger={
                      <button
                        type="button"
                        aria-label="Notu sil"
                        className="focus-ring press grid h-7 w-7 min-h-9 min-w-9 shrink-0 place-items-center rounded-[8px] text-text-faint opacity-0 transition hover:bg-danger-500/10 hover:text-danger-600 focus-visible:opacity-100 group-hover/not:opacity-100"
                      >
                        <Trash2 className="h-3.5 w-3.5" />
                      </button>
                    }
                  />
                ) : null}
              </li>
            );
          })}
        </ul>
      )}

      {canEdit ? (
        <form ref={formRef} action={action} className="hairline-t mt-4 flex flex-wrap items-end gap-2 pt-4">
          <input type="hidden" name="deal_id" value={dealId} />
          <label className="min-w-0 flex-1 text-xs font-semibold text-text-muted">
            Yeni not
            <textarea
              name="body"
              rows={2}
              required
              maxLength={2000}
              placeholder="Not yazın… (Enter gönderir, Shift+Enter yeni satır)"
              onKeyDown={(e) => {
                if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) {
                  e.preventDefault();
                  e.currentTarget.form?.requestSubmit();
                }
              }}
              className="mt-1 w-full resize-none rounded-[10px] border border-line bg-canvas px-3 py-2 text-sm outline-none focus:border-brand-300"
            />
          </label>
          <button
            type="submit"
            disabled={pending}
            className="btn-shine focus-ring press inline-flex h-[38px] shrink-0 items-center gap-1.5 rounded-[10px] bg-brand-600 px-4 text-sm font-semibold text-white transition hover:bg-brand-700 disabled:opacity-60"
          >
            <Send className="h-4 w-4" /> {pending ? "Ekleniyor…" : "Ekle"}
          </button>
          {state.error ? (
            <p className="basis-full text-xs font-semibold text-danger-600" role="alert">
              {state.error}
            </p>
          ) : null}
        </form>
      ) : null}
    </section>
  );
}
