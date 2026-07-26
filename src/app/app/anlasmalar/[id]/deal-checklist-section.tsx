"use client";

import { useActionState, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import {
  BadgeCheck,
  CheckSquare,
  FileCheck2,
  Plus,
  Square,
  StickyNote,
  Trash2,
} from "lucide-react";
import {
  addItem,
  createFromTemplate,
  deleteItem,
  toggleItem,
  updateItemNote,
  type ChecklistItem,
  type ChecklistResult,
} from "@/app/actions/deal-checklist";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { useToast } from "@/components/app/toast-provider";

/**
 * Evrak dosyası — kapanışta gereken belgelerin kontrol listesi.
 *
 * İlerleme YALNIZ zorunlu maddelerden hesaplanır (opsiyoneller hatırlatıcı).
 * Tüm zorunlular tamamlanınca "Dosya tamam" rozeti çıkar. Boş listede
 * anlaşmanın işlem türüne uyan şablon tek tıkla yüklenir.
 */
export function DealChecklistSection({
  dealId,
  dealType,
  items,
  canEdit,
}: {
  dealId: string;
  dealType: string;
  items: ChecklistItem[];
  canEdit: boolean;
}) {
  const router = useRouter();
  const { push } = useToast();
  const [togglePending, startToggle] = useTransition();
  const [busyId, setBusyId] = useState<string | null>(null);
  const [noteFor, setNoteFor] = useState<string | null>(null);
  const addFormRef = useRef<HTMLFormElement>(null);

  const [templateState, templateAction, templatePending] = useActionState<ChecklistResult, FormData>(
    async (prev, fd) => {
      const result = await createFromTemplate(prev, fd);
      if (result.ok) {
        push("Evrak listesi oluşturuldu", "ok");
        router.refresh();
      }
      return result;
    },
    {},
  );

  const [addState, addAction, addPending] = useActionState<ChecklistResult, FormData>(
    async (prev, fd) => {
      const result = await addItem(prev, fd);
      if (result.ok) {
        addFormRef.current?.reset();
        router.refresh();
      }
      return result;
    },
    {},
  );

  const [noteState, noteAction, notePending] = useActionState<ChecklistResult, FormData>(
    async (prev, fd) => {
      const result = await updateItemNote(prev, fd);
      if (result.ok) {
        setNoteFor(null);
        push("Not kaydedildi", "ok");
        router.refresh();
      }
      return result;
    },
    {},
  );

  function toggle(itemId: string) {
    setBusyId(itemId);
    startToggle(async () => {
      const res = await toggleItem(itemId, dealId);
      if (res.error) push(res.error, "err");
      router.refresh();
      setBusyId(null);
    });
  }

  const required = items.filter((i) => i.is_required);
  const requiredDone = required.filter((i) => i.is_done).length;
  const pct = required.length > 0 ? Math.round((requiredDone / required.length) * 100) : 0;
  const complete = required.length > 0 && requiredDone === required.length;

  return (
    <section className="surface-card rounded-[var(--radius-panel)] p-5">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="flex items-center gap-2 font-display font-bold text-ink-950">
          <FileCheck2 className="h-4 w-4 text-brand-600" /> Evrak dosyası
          {complete ? (
            <span className="inline-flex items-center gap-1 rounded-full bg-mint-500/12 px-2.5 py-0.5 text-[11px] font-bold text-mint-700 ring-1 ring-inset ring-mint-600/25">
              <BadgeCheck className="h-3.5 w-3.5" /> Dosya tamam ✓
            </span>
          ) : null}
        </h2>
        {required.length > 0 ? (
          <p className="numeric text-xs font-semibold text-text-muted">
            {requiredDone}/{required.length} zorunlu evrak tamam
          </p>
        ) : null}
      </div>
      <p className="mt-1 text-[11px] text-text-faint">
        Kapanışta gereken belgeler — tapu, kimlik, DASK vb. Yüzde yalnız zorunlu evraklardan hesaplanır.
      </p>

      {/* İlerleme çubuğu — mint dolgu */}
      {required.length > 0 ? (
        <div
          className="mt-3 flex h-2 overflow-hidden rounded-full bg-canvas"
          role="progressbar"
          aria-valuenow={pct}
          aria-valuemin={0}
          aria-valuemax={100}
          aria-label="Zorunlu evrak tamamlanma yüzdesi"
        >
          <div
            className="rounded-full bg-mint-500 transition-[width] duration-300"
            style={{ width: `${pct}%` }}
          />
        </div>
      ) : null}

      {items.length === 0 ? (
        <div className="mt-3 rounded-[12px] border border-dashed border-line-strong px-4 py-8 text-center">
          <p className="text-sm text-text-muted">
            Henüz evrak listesi yok. {dealType === "rent" ? "Kiralama" : "Satış"} kapanışının
            standart evraklarıyla başlayın.
          </p>
          {canEdit ? (
            <form action={templateAction} className="mt-4 inline-block">
              <input type="hidden" name="deal_id" value={dealId} />
              <input type="hidden" name="deal_type" value={dealType === "rent" ? "rent" : "sale"} />
              <button
                type="submit"
                disabled={templatePending}
                className="btn-shine focus-ring press inline-flex items-center gap-1.5 rounded-[10px] bg-brand-600 px-4 py-2.5 text-sm font-semibold text-white transition hover:bg-brand-700 disabled:opacity-60"
              >
                <FileCheck2 className="h-4 w-4" />
                {templatePending
                  ? "Oluşturuluyor…"
                  : `Şablondan oluştur (${dealType === "rent" ? "Kiralık" : "Satılık"})`}
              </button>
              {templateState.error ? (
                <p className="mt-2 text-xs font-semibold text-danger-600" role="alert">
                  {templateState.error}
                </p>
              ) : null}
            </form>
          ) : null}
        </div>
      ) : (
        <ul className="mt-3 space-y-2">
          {items.map((item) => {
            const busy = busyId === item.id && togglePending;
            return (
              <li
                key={item.id}
                className="rounded-[12px] border border-line bg-canvas px-4 py-2.5"
              >
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <div className="flex min-w-0 flex-1 items-center gap-2.5">
                    {canEdit ? (
                      <button
                        type="button"
                        disabled={busy}
                        onClick={() => toggle(item.id)}
                        aria-pressed={item.is_done}
                        aria-label={item.is_done ? `${item.label} — tamamlandı, geri al` : `${item.label} — tamamlandı işaretle`}
                        className={`focus-ring press shrink-0 rounded-[6px] transition disabled:opacity-50 ${
                          item.is_done ? "text-mint-600" : "text-text-faint hover:text-brand-600"
                        }`}
                      >
                        {item.is_done ? <CheckSquare className="h-5 w-5" /> : <Square className="h-5 w-5" />}
                      </button>
                    ) : (
                      <span className={`shrink-0 ${item.is_done ? "text-mint-600" : "text-text-faint"}`}>
                        {item.is_done ? <CheckSquare className="h-5 w-5" /> : <Square className="h-5 w-5" />}
                      </span>
                    )}
                    <span
                      className={`min-w-0 truncate text-sm font-medium ${
                        item.is_done ? "text-text-faint line-through" : "text-ink-950"
                      }`}
                    >
                      {item.label}
                    </span>
                    {item.is_required ? (
                      <span className="shrink-0 rounded-md bg-amber-50 px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-wide text-amber-700 ring-1 ring-inset ring-amber-600/20">
                        Zorunlu
                      </span>
                    ) : (
                      <span className="shrink-0 rounded-md bg-zinc-100 px-1.5 py-0.5 text-[10px] font-semibold text-zinc-500 ring-1 ring-inset ring-zinc-500/10">
                        Opsiyonel
                      </span>
                    )}
                  </div>
                  <div className="flex shrink-0 items-center gap-1.5">
                    {item.is_done && item.done_by_name ? (
                      <span className="text-[11px] text-text-faint" title={item.done_at ?? undefined}>
                        {item.done_by_name}
                      </span>
                    ) : null}
                    {canEdit ? (
                      <button
                        type="button"
                        onClick={() => setNoteFor((v) => (v === item.id ? null : item.id))}
                        aria-expanded={noteFor === item.id}
                        title={item.note ? "Notu düzenle" : "Not ekle"}
                        className={`focus-ring press grid h-7 w-7 place-items-center rounded-[8px] transition hover:bg-brand-600/10 hover:text-brand-600 ${
                          item.note ? "text-brand-600" : "text-text-faint"
                        }`}
                      >
                        <StickyNote className="h-3.5 w-3.5" />
                      </button>
                    ) : null}
                    {canEdit ? (
                      <ConfirmDialog
                        title="Evrak maddesini sil"
                        description={`"${item.label}" maddesi evrak listesinden silinecek. Bu işlem geri alınamaz.`}
                        confirmLabel="Sil"
                        formAction={deleteItem}
                        hiddenFields={{ item_id: item.id, deal_id: dealId }}
                        trigger={
                          <button
                            type="button"
                            aria-label={`${item.label} maddesini sil`}
                            className="focus-ring press grid h-7 w-7 place-items-center rounded-[8px] text-text-faint transition hover:bg-danger-500/10 hover:text-danger-600"
                          >
                            <Trash2 className="h-3.5 w-3.5" />
                          </button>
                        }
                      />
                    ) : null}
                  </div>
                </div>

                {/* Kayıtlı not (form kapalıyken görünür) */}
                {item.note && noteFor !== item.id ? (
                  <p className="mt-1.5 pl-[30px] text-xs text-text-muted">{item.note}</p>
                ) : null}

                {/* Inline not formu */}
                {canEdit && noteFor === item.id ? (
                  <form action={noteAction} className="mt-2 flex flex-wrap items-center gap-2 pl-[30px]">
                    <input type="hidden" name="item_id" value={item.id} />
                    <input type="hidden" name="deal_id" value={dealId} />
                    <input
                      name="note"
                      type="text"
                      maxLength={500}
                      defaultValue={item.note ?? ""}
                      placeholder="Kısa not… (boş bırakmak notu siler)"
                      autoFocus
                      className="min-w-0 flex-1 rounded-[8px] border border-line bg-surface px-2.5 py-1.5 text-xs outline-none focus:border-brand-300"
                    />
                    <button
                      type="submit"
                      disabled={notePending}
                      className="focus-ring press rounded-[8px] bg-brand-600 px-3 py-1.5 text-xs font-semibold text-white transition hover:bg-brand-700 disabled:opacity-60"
                    >
                      {notePending ? "Kaydediliyor…" : "Kaydet"}
                    </button>
                    <button
                      type="button"
                      onClick={() => setNoteFor(null)}
                      className="rounded-[8px] px-2 py-1.5 text-xs font-semibold text-text-muted hover:bg-canvas"
                    >
                      Vazgeç
                    </button>
                    {noteState.error ? (
                      <p className="basis-full text-xs font-semibold text-danger-600" role="alert">
                        {noteState.error}
                      </p>
                    ) : null}
                  </form>
                ) : null}
              </li>
            );
          })}
        </ul>
      )}

      {/* Yeni madde ekleme */}
      {canEdit && items.length > 0 ? (
        <form
          ref={addFormRef}
          action={addAction}
          className="hairline-t mt-4 flex flex-wrap items-end gap-2 pt-4"
        >
          <input type="hidden" name="deal_id" value={dealId} />
          <label className="min-w-0 flex-1 text-xs font-semibold text-text-muted">
            Yeni evrak
            <input
              name="label"
              type="text"
              required
              maxLength={200}
              placeholder="Örn. tapu randevu belgesi"
              className="mt-1 w-full rounded-[10px] border border-line bg-canvas px-3 py-2 text-sm outline-none focus:border-brand-300"
            />
          </label>
          <label className="flex h-[38px] shrink-0 cursor-pointer items-center gap-1.5 rounded-[10px] border border-line px-3 text-xs font-semibold text-text-muted">
            <input type="checkbox" name="is_required" value="1" defaultChecked className="accent-brand-600" />
            Zorunlu
          </label>
          <button
            type="submit"
            disabled={addPending}
            className="btn-shine focus-ring press inline-flex h-[38px] shrink-0 items-center gap-1.5 rounded-[10px] bg-brand-600 px-4 text-sm font-semibold text-white transition hover:bg-brand-700 disabled:opacity-60"
          >
            <Plus className="h-4 w-4" /> {addPending ? "Ekleniyor…" : "Ekle"}
          </button>
          {addState.error ? (
            <p className="basis-full text-xs font-semibold text-danger-600" role="alert">
              {addState.error}
            </p>
          ) : null}
        </form>
      ) : null}
    </section>
  );
}
