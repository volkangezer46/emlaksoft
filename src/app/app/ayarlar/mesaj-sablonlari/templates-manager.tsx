"use client";

import { useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Eye, EyeOff, Loader2, MessageSquareText, Pencil, Plus, Sparkles, Trash2, X } from "lucide-react";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import {
  CATEGORY_BADGE,
  CATEGORY_LABELS,
  SAMPLE_VARS,
  TEMPLATE_BODY_MAX,
  TEMPLATE_CATEGORIES,
  TEMPLATE_TITLE_MAX,
  VARIABLE_HELP,
  renderTemplate,
  type TemplateCategory,
} from "@/lib/message-templates";
import {
  createMessageTemplate,
  deleteMessageTemplateForm,
  seedDefaultTemplates,
  toggleMessageTemplate,
  updateMessageTemplate,
  type MessageTemplateRow,
  type TemplateResult,
} from "@/app/actions/message-templates";

const init: TemplateResult = {};

export function TemplatesManager({ templates }: { templates: MessageTemplateRow[] }) {
  const router = useRouter();
  const formRef = useRef<HTMLFormElement>(null);
  const bodyRef = useRef<HTMLTextAreaElement>(null);

  const [editing, setEditing] = useState<MessageTemplateRow | null>(null);
  const [bodyDraft, setBodyDraft] = useState("");
  const [createError, setCreateError] = useState<string | null>(null);
  const [createPending, startCreate] = useTransition();
  const [updateError, setUpdateError] = useState<string | null>(null);
  const [updatePending, startUpdate] = useTransition();
  const [rowPending, startRow] = useTransition();

  const errorMsg = editing ? updateError : createError;
  const pending = editing ? updatePending : createPending;

  /*
   * useActionState + useEffect yerine transition deseni: effect icinde
   * senkron setState react-hooks/set-state-in-effect kuralini bozuyordu
   * (projedeki diger dialoglarla ayni cozum).
   */
  const createAction = (fd: FormData) =>
    startCreate(async () => {
      const res = await createMessageTemplate(init, fd);
      if (res.ok) {
        setCreateError(null);
        formRef.current?.reset();
        setBodyDraft("");
        router.refresh();
      } else {
        setCreateError(res.error ?? "Şablon kaydedilemedi.");
      }
    });

  function startEdit(row: MessageTemplateRow) {
    setEditing(row);
    setBodyDraft(row.body);
    setUpdateError(null);
  }

  function cancelEdit() {
    setEditing(null);
    setBodyDraft("");
    setUpdateError(null);
  }

  function handleUpdate(fd: FormData) {
    startUpdate(async () => {
      const res = await updateMessageTemplate(init, fd);
      if (res.error) {
        setUpdateError(res.error);
      } else {
        setUpdateError(null);
        setEditing(null);
        setBodyDraft("");
        router.refresh();
      }
    });
  }

  /** Çipe tıklandığında değişkeni imleç konumuna yazar (seçim varsa değiştirir). */
  function insertToken(token: string) {
    const el = bodyRef.current;
    if (!el) return;
    const start = el.selectionStart ?? bodyDraft.length;
    const end = el.selectionEnd ?? start;
    const next = `${bodyDraft.slice(0, start)}${token}${bodyDraft.slice(end)}`;
    setBodyDraft(next.slice(0, TEMPLATE_BODY_MAX));
    // İmleci eklenen değişkenin sonuna taşı — arka arkaya çip tıklaması akıcı olsun
    requestAnimationFrame(() => {
      el.focus();
      const caret = Math.min(start + token.length, TEMPLATE_BODY_MAX);
      el.setSelectionRange(caret, caret);
    });
  }

  const preview = renderTemplate(bodyDraft, SAMPLE_VARS);

  return (
    <div className="grid gap-4 lg:grid-cols-[1fr_1fr]">
      {/* Form */}
      <section className="dashboard-panel h-fit rounded-[20px] border border-line bg-surface p-4 md:p-6">
        <div className="flex items-center justify-between gap-3 border-b border-line pb-4">
          <div className="flex items-center gap-3">
            <span className="grid h-11 w-11 place-items-center rounded-[13px] bg-mint-500/12 text-mint-600">
              {editing ? <Pencil className="h-5 w-5" /> : <MessageSquareText className="h-5 w-5" />}
            </span>
            <div>
              <h2 className="font-display font-bold text-ink-950">{editing ? "Şablonu düzenle" : "Yeni şablon"}</h2>
              <p className="text-xs text-text-muted">
                {editing ? "Değişiklik tüm ekibin menüsüne yansır." : "Kaydedilen şablon WhatsApp menüsünde görünür."}
              </p>
            </div>
          </div>
          {editing ? (
            <button
              type="button"
              onClick={cancelEdit}
              className="focus-ring press inline-flex items-center gap-1 rounded-[9px] border border-line px-2.5 py-1.5 text-xs font-semibold text-text-muted transition hover:border-brand-300 hover:text-brand-600"
            >
              <X className="h-3.5 w-3.5" /> Vazgeç
            </button>
          ) : null}
        </div>

        <form
          ref={formRef}
          key={editing?.id ?? "new"}
          action={editing ? handleUpdate : createAction}
          className="mt-5 space-y-4"
        >
          {editing ? <input type="hidden" name="id" value={editing.id} /> : null}

          <div className="grid gap-4 sm:grid-cols-[1.6fr_1fr]">
            <div>
              <label htmlFor="tpl-title" className="text-xs font-bold text-text-muted">Şablon başlığı</label>
              <input
                id="tpl-title"
                name="title"
                required
                maxLength={TEMPLATE_TITLE_MAX}
                defaultValue={editing?.title ?? ""}
                placeholder="Örn. Randevu teyidi"
                className="focus-ring mt-1.5 w-full rounded-[11px] border border-line bg-canvas px-3.5 py-2.5 text-sm text-ink-950 placeholder:text-text-faint"
              />
            </div>
            <div>
              <label htmlFor="tpl-category" className="text-xs font-bold text-text-muted">Kategori</label>
              <select
                id="tpl-category"
                name="category"
                defaultValue={editing?.category ?? "genel"}
                className="focus-ring mt-1.5 w-full rounded-[11px] border border-line bg-canvas px-3.5 py-2.5 text-sm text-ink-950"
              >
                {TEMPLATE_CATEGORIES.map((c) => (
                  <option key={c} value={c}>{CATEGORY_LABELS[c]}</option>
                ))}
              </select>
            </div>
          </div>

          <div>
            <div className="flex items-end justify-between gap-2">
              <label htmlFor="tpl-body" className="text-xs font-bold text-text-muted">Mesaj metni</label>
              <span className={`numeric text-[11px] ${bodyDraft.length > TEMPLATE_BODY_MAX - 60 ? "text-amber-600" : "text-text-faint"}`}>
                {bodyDraft.length}/{TEMPLATE_BODY_MAX}
              </span>
            </div>
            <textarea
              id="tpl-body"
              name="body"
              ref={bodyRef}
              required
              rows={8}
              maxLength={TEMPLATE_BODY_MAX}
              value={bodyDraft}
              onChange={(e) => setBodyDraft(e.target.value)}
              placeholder={"Merhaba {musteri}, ben {ofis}'ten {danisman}…"}
              className="focus-ring mt-1.5 w-full resize-y rounded-[11px] border border-line bg-canvas px-3.5 py-2.5 text-sm leading-relaxed text-ink-950 placeholder:text-text-faint"
            />
          </div>

          {/* Değişken çipleri — tıklayınca imleç konumuna eklenir */}
          <div>
            <p className="text-xs font-bold text-text-muted">Değişken ekle</p>
            <div className="mt-2 flex flex-wrap gap-1.5">
              {VARIABLE_HELP.map((v) => (
                <button
                  key={v.key}
                  type="button"
                  title={v.desc}
                  onClick={() => insertToken(v.token)}
                  className="focus-ring press rounded-full border border-line bg-canvas px-2.5 py-1 text-[11px] font-semibold text-brand-600 transition hover:border-brand-300 hover:bg-brand-600/8"
                >
                  {v.label}
                </button>
              ))}
            </div>
          </div>

          <div>
            <label htmlFor="tpl-sort" className="text-xs font-bold text-text-muted">Sıra (küçük olan önce)</label>
            <input
              id="tpl-sort"
              name="sort_order"
              type="number"
              min={0}
              max={9999}
              defaultValue={editing?.sort_order ?? 0}
              className="focus-ring mt-1.5 w-28 rounded-[11px] border border-line bg-canvas px-3.5 py-2.5 text-sm text-ink-950"
            />
          </div>

          {/* Canlı önizleme — örnek verilerle gerçek render */}
          <div className="rounded-[14px] border border-line bg-canvas p-3.5">
            <p className="text-[11px] font-bold uppercase tracking-[0.08em] text-text-faint">Önizleme (örnek verilerle)</p>
            {preview ? (
              <p className="mt-2 whitespace-pre-wrap rounded-[11px] bg-mint-500/8 px-3 py-2.5 text-sm leading-relaxed text-ink-950">
                {preview}
              </p>
            ) : (
              <p className="mt-2 text-xs text-text-faint">Metin yazdıkça önizleme burada oluşur.</p>
            )}
          </div>

          {errorMsg ? (
            <p className="rounded-[10px] border border-danger-500/25 bg-danger-500/8 px-3 py-2 text-xs font-semibold text-danger-500">
              {errorMsg}
            </p>
          ) : null}

          <button
            type="submit"
            disabled={pending}
            className="focus-ring press inline-flex w-full items-center justify-center gap-2 rounded-[11px] bg-brand-600 px-4 py-2.5 text-sm font-bold text-white transition hover:bg-brand-700 disabled:opacity-60"
          >
            {pending ? <Loader2 className="h-4 w-4 animate-spin" /> : editing ? <Pencil className="h-4 w-4" /> : <Plus className="h-4 w-4" />}
            {editing ? "Değişiklikleri kaydet" : "Şablonu kaydet"}
          </button>
        </form>
      </section>

      {/* Liste */}
      <section className="dashboard-panel rounded-[20px] border border-line bg-surface p-4 md:p-6">
        <div className="flex items-center justify-between gap-3 border-b border-line pb-4">
          <div>
            <h2 className="font-display font-bold text-ink-950">Şablon kütüphanesi</h2>
            <p className="text-xs text-text-muted">Pasif şablonlar danışman menüsünde görünmez.</p>
          </div>
          <span className="rounded-full bg-brand-600/10 px-2.5 py-1 text-xs font-bold text-brand-600">{templates.length}</span>
        </div>

        {templates.length === 0 ? (
          <div className="mt-8 flex flex-col items-center gap-3 pb-4 text-center">
            <span className="grid h-12 w-12 place-items-center rounded-full bg-mint-500/12 text-mint-600">
              <MessageSquareText className="h-6 w-6" />
            </span>
            <p className="text-sm font-semibold text-ink-950">Henüz şablon yok</p>
            <p className="max-w-xs text-xs text-text-muted">
              Hazır setle başlayın: ilan paylaşımı, randevu teyidi, evrak isteme gibi 10 gerçek metin
              tek tıkla eklenir; hepsini sonra düzenleyebilirsiniz.
            </p>
            <button
              type="button"
              disabled={rowPending}
              onClick={() =>
                startRow(async () => {
                  await seedDefaultTemplates();
                  router.refresh();
                })
              }
              className="focus-ring press inline-flex items-center gap-2 rounded-[11px] bg-ink-950 px-4 py-2.5 text-sm font-bold text-white transition hover:bg-ink-800 disabled:opacity-60"
            >
              {rowPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Sparkles className="h-4 w-4" />}
              Varsayılan şablonları ekle
            </button>
          </div>
        ) : (
          <ul className="mt-4 space-y-3">
            {templates.map((t) => {
              const badge = CATEGORY_BADGE[t.category as TemplateCategory] ?? CATEGORY_BADGE.genel;
              return (
                <li
                  key={t.id}
                  className={`rounded-[14px] border border-line bg-canvas p-4 transition hover:border-brand-300 ${t.is_active ? "" : "opacity-60"}`}
                >
                  <div className="flex flex-wrap items-start justify-between gap-2">
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-sm font-bold text-ink-950">{t.title}</p>
                      <p className="mt-1 line-clamp-2 whitespace-pre-wrap text-xs leading-relaxed text-text-muted">{t.body}</p>
                    </div>
                    <div className="flex shrink-0 items-center gap-1.5">
                      <button
                        type="button"
                        title={t.is_active ? "Pasife al" : "Aktifleştir"}
                        disabled={rowPending}
                        onClick={() =>
                          startRow(async () => {
                            await toggleMessageTemplate(t.id, !t.is_active);
                            router.refresh();
                          })
                        }
                        className="focus-ring press grid h-8 w-8 place-items-center rounded-[9px] border border-line text-text-muted transition hover:border-brand-300 hover:text-brand-600 disabled:opacity-50"
                      >
                        {t.is_active ? <Eye className="h-3.5 w-3.5" /> : <EyeOff className="h-3.5 w-3.5" />}
                      </button>
                      <button
                        type="button"
                        title="Düzenle"
                        onClick={() => startEdit(t)}
                        className="focus-ring press grid h-8 w-8 place-items-center rounded-[9px] border border-line text-text-muted transition hover:border-brand-300 hover:text-brand-600"
                      >
                        <Pencil className="h-3.5 w-3.5" />
                      </button>
                      <ConfirmDialog
                        trigger={
                          <button
                            type="button"
                            title="Sil"
                            className="focus-ring press grid h-8 w-8 place-items-center rounded-[9px] border border-line text-text-muted transition hover:border-danger-500/40 hover:text-danger-500"
                          >
                            <Trash2 className="h-3.5 w-3.5" />
                          </button>
                        }
                        title="Şablon silinsin mi?"
                        description={`"${t.title}" şablonu kalıcı olarak silinir. Gönderilmiş mesajlar etkilenmez.`}
                        confirmLabel="Kalıcı sil"
                        formAction={deleteMessageTemplateForm}
                        hiddenFields={{ id: t.id }}
                      />
                    </div>
                  </div>
                  <div className="mt-2.5 flex flex-wrap items-center gap-2 text-[11px] text-text-faint">
                    <span className={`rounded-full px-2 py-0.5 font-bold ${badge}`}>
                      {CATEGORY_LABELS[t.category as TemplateCategory] ?? "Genel"}
                    </span>
                    <span className={`rounded-full px-2 py-0.5 font-bold ${t.is_active ? "bg-mint-500/12 text-mint-600" : "bg-ink-950/8 text-text-muted"}`}>
                      {t.is_active ? "Aktif" : "Pasif"}
                    </span>
                    <span>Sıra {t.sort_order}</span>
                    <span className="numeric ml-auto rounded-full bg-ink-950/5 px-2 py-0.5 font-bold text-text-muted">
                      {t.usage_count} kez kullanıldı
                    </span>
                  </div>
                </li>
              );
            })}
          </ul>
        )}

        {templates.length > 0 ? (
          <div className="mt-4 border-t border-line pt-4">
            <button
              type="button"
              disabled={rowPending}
              onClick={() =>
                startRow(async () => {
                  await seedDefaultTemplates();
                  router.refresh();
                })
              }
              className="focus-ring press inline-flex items-center gap-2 rounded-[10px] border border-line bg-canvas px-3.5 py-2 text-xs font-semibold text-brand-600 transition hover:border-brand-300 disabled:opacity-60"
            >
              {rowPending ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Sparkles className="h-3.5 w-3.5" />}
              Eksik varsayılan şablonları ekle
            </button>
          </div>
        ) : null}
      </section>
    </div>
  );
}
