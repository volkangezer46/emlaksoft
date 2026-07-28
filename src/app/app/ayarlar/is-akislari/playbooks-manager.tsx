"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import {
  ArrowDown,
  ArrowUp,
  Bolt,
  CalendarClock,
  CheckCircle2,
  Filter,
  Loader2,
  Pencil,
  Plus,
  Sparkles,
  Trash2,
  Workflow,
  X,
} from "lucide-react";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import {
  PLAYBOOK_ASSIGN_LABELS,
  PLAYBOOK_FILTER_HINTS,
  PLAYBOOK_KIND_LABELS,
  PLAYBOOK_PRIORITY_LABELS,
  PLAYBOOK_TRIGGER_EVENTS,
  PLAYBOOK_TRIGGER_LABELS,
  offsetLabel,
} from "@/lib/playbook-labels";
import type { PlaybookTriggerEvent } from "@/lib/playbook-engine";
import {
  applyPlaybookTemplate,
  createPlaybook,
  deletePlaybookForm,
  togglePlaybookActive,
  updatePlaybook,
  type PlaybookResult,
} from "@/app/actions/playbooks";

export type StaffOption = { id: string; full_name: string };

export type StepDraft = {
  title: string;
  kind: string;
  priority: string;
  offset_days: number;
  assign_to: string;
  assignee_id: string | null;
  note: string | null;
};

export type PlaybookListRow = {
  id: string;
  name: string;
  description: string | null;
  trigger_event: string;
  triggerLabel: string;
  filterKey: string;
  filterValue: string;
  is_active: boolean;
  runCount: number;
  steps: StepDraft[];
};

export type TemplateCard = {
  key: string;
  name: string;
  description: string;
  triggerLabel: string;
  stepCount: number;
  lastOffset: number;
};

const init: PlaybookResult = {};

const fieldClass =
  "focus-ring w-full rounded-[11px] border border-line bg-canvas px-3 py-2 text-sm text-ink-950 placeholder:text-text-faint";

function emptyStep(): StepDraft {
  return { title: "", kind: "followup", priority: "normal", offset_days: 0, assign_to: "owner", assignee_id: null, note: null };
}

const PRIORITY_BADGE: Record<string, string> = {
  low: "bg-zinc-100 text-zinc-500",
  normal: "bg-brand-600/10 text-brand-700",
  high: "bg-danger-500/10 text-danger-500",
};

export function PlaybooksManager({
  playbooks,
  staff,
  templates,
  canEdit,
}: {
  playbooks: PlaybookListRow[];
  staff: StaffOption[];
  templates: TemplateCard[];
  canEdit: boolean;
}) {
  const router = useRouter();
  const [editing, setEditing] = useState<PlaybookListRow | null>(null);
  const [formOpen, setFormOpen] = useState(false);
  const [steps, setSteps] = useState<StepDraft[]>([emptyStep()]);
  const [trigger, setTrigger] = useState<PlaybookTriggerEvent>("yeni_portfoy");

  const [formError, setFormError] = useState<string | null>(null);
  const [formPending, startForm] = useTransition();
  const [rowPending, startRowAction] = useTransition();

  const pending = formPending;
  const errorMsg = formError;

  /*
   * useActionState + useEffect yerine transition deseni: effect icinde
   * senkron setState react-hooks/set-state-in-effect kuralini bozuyordu
   * (projedeki diger dialoglarla ayni cozum).
   */
  const submitAction = (fd: FormData) =>
    startForm(async () => {
      const res = editing ? await updatePlaybook(init, fd) : await createPlaybook(init, fd);
      if (res.ok) {
        setFormError(null);
        setFormOpen(false);
        setEditing(null);
        setSteps([emptyStep()]);
        router.refresh();
      } else {
        setFormError(res.error ?? "İş akışı kaydedilemedi.");
      }
    });

  function openNew() {
    setEditing(null);
    setTrigger("yeni_portfoy");
    setSteps([emptyStep()]);
    setFormOpen(true);
  }

  function openEdit(row: PlaybookListRow) {
    setEditing(row);
    setTrigger(row.trigger_event as PlaybookTriggerEvent);
    setSteps(row.steps.length > 0 ? row.steps.map((s) => ({ ...s })) : [emptyStep()]);
    setFormOpen(true);
  }

  function patchStep(index: number, patch: Partial<StepDraft>) {
    setSteps((prev) => prev.map((s, i) => (i === index ? { ...s, ...patch } : s)));
  }

  function moveStep(index: number, dir: -1 | 1) {
    setSteps((prev) => {
      const target = index + dir;
      if (target < 0 || target >= prev.length) return prev;
      const next = [...prev];
      [next[index], next[target]] = [next[target], next[index]];
      return next;
    });
  }

  function applyTemplate(key: string) {
    startRowAction(async () => {
      const fd = new FormData();
      fd.set("template_key", key);
      await applyPlaybookTemplate(fd);
      router.refresh();
    });
  }

  function toggleActive(row: PlaybookListRow) {
    startRowAction(async () => {
      await togglePlaybookActive(row.id, !row.is_active);
      router.refresh();
    });
  }

  const filterHints = PLAYBOOK_FILTER_HINTS[trigger] ?? [];

  return (
    <div className="space-y-6">
      {/* Hazır şablonlar */}
      {canEdit ? (
        <section className="rounded-[20px] border border-dashed border-brand-300/40 bg-brand-600/[0.02] p-5">
          <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
            <h2 className="flex items-center gap-2 font-display font-bold text-ink-950">
              <Sparkles className="h-4 w-4 text-brand-600" /> Hazır şablondan başla
            </h2>
            <button
              type="button"
              onClick={openNew}
              className="btn-shine focus-ring press inline-flex items-center gap-1.5 rounded-[10px] bg-brand-600 px-3.5 py-2 text-sm font-semibold text-white"
            >
              <Plus className="h-4 w-4" /> Sıfırdan iş akışı
            </button>
          </div>
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {templates.map((t) => (
              <div key={t.key} className="flex flex-col rounded-[13px] border border-line bg-surface p-3.5">
                <p className="text-sm font-bold text-ink-950">{t.name}</p>
                <p className="mt-1 flex-1 text-[11px] leading-relaxed text-text-muted">{t.description}</p>
                <div className="mt-2.5 flex flex-wrap items-center gap-1.5 text-[11px]">
                  <span className="inline-flex items-center gap-1 rounded-full bg-amber-400/15 px-2 py-0.5 font-semibold text-amber-700">
                    <Bolt className="h-3 w-3" /> {t.triggerLabel}
                  </span>
                  <span className="inline-flex items-center gap-1 rounded-full bg-mint-500/12 px-2 py-0.5 font-semibold text-mint-700">
                    <Workflow className="h-3 w-3" /> {t.stepCount} adım
                  </span>
                  <span className="inline-flex items-center gap-1 rounded-full bg-ink-950/5 px-2 py-0.5 font-semibold text-text-muted">
                    <CalendarClock className="h-3 w-3" /> {t.lastOffset} güne yayılır
                  </span>
                </div>
                <button
                  type="button"
                  onClick={() => applyTemplate(t.key)}
                  disabled={rowPending}
                  className="focus-ring press mt-3 inline-flex items-center justify-center gap-1.5 rounded-[9px] border border-brand-300 px-3 py-1.5 text-xs font-bold text-brand-600 transition hover:bg-brand-600 hover:text-white disabled:opacity-60"
                >
                  <Plus className="h-3.5 w-3.5" /> Kopyala (pasif açılır)
                </button>
              </div>
            ))}
          </div>
        </section>
      ) : null}

      {/* Editör */}
      {canEdit && formOpen ? (
        <section className="dashboard-panel rounded-[20px] border border-line bg-surface p-4 md:p-6">
          <div className="flex items-center justify-between gap-3 border-b border-line pb-4">
            <div className="flex items-center gap-3">
              <span className="grid h-11 w-11 place-items-center rounded-[13px] bg-brand-600/10 text-brand-600">
                {editing ? <Pencil className="h-5 w-5" /> : <Workflow className="h-5 w-5" />}
              </span>
              <div>
                <h2 className="font-display font-bold text-ink-950">
                  {editing ? "İş akışını düzenle" : "Yeni iş akışı"}
                </h2>
                <p className="text-xs text-text-muted">
                  Tetikleyici olay gerçekleştiğinde aşağıdaki adımlar sırayla görev olarak açılır.
                </p>
              </div>
            </div>
            <button
              type="button"
              onClick={() => { setFormOpen(false); setEditing(null); }}
              className="focus-ring press inline-flex items-center gap-1 rounded-[9px] border border-line px-2.5 py-1.5 text-xs font-semibold text-text-muted transition hover:border-brand-300 hover:text-brand-600"
            >
              <X className="h-3.5 w-3.5" /> Vazgeç
            </button>
          </div>

          <form key={editing?.id ?? "new"} action={submitAction} className="mt-5 space-y-5">
            {editing ? <input type="hidden" name="id" value={editing.id} /> : null}
            <input type="hidden" name="steps" value={JSON.stringify(steps)} readOnly />

            <div className="grid gap-4 md:grid-cols-2">
              <div>
                <label htmlFor="pb-name" className="text-xs font-bold text-text-muted">İş akışı adı</label>
                <input
                  id="pb-name"
                  name="name"
                  required
                  maxLength={160}
                  defaultValue={editing?.name ?? ""}
                  placeholder="Örn. Yeni satılık portföy — ilk 14 gün"
                  className={`${fieldClass} mt-1.5`}
                />
              </div>
              <div>
                <label htmlFor="pb-trigger" className="text-xs font-bold text-text-muted">Tetikleyici olay</label>
                <select
                  id="pb-trigger"
                  name="trigger_event"
                  value={trigger}
                  onChange={(e) => setTrigger(e.target.value as PlaybookTriggerEvent)}
                  className={`${fieldClass} mt-1.5 appearance-none`}
                >
                  {PLAYBOOK_TRIGGER_EVENTS.map((ev) => (
                    <option key={ev} value={ev}>{PLAYBOOK_TRIGGER_LABELS[ev]}</option>
                  ))}
                </select>
              </div>
            </div>

            <div>
              <label htmlFor="pb-desc" className="text-xs font-bold text-text-muted">Açıklama (opsiyonel)</label>
              <input
                id="pb-desc"
                name="description"
                maxLength={600}
                defaultValue={editing?.description ?? ""}
                placeholder="Bu akış ne zaman ve neden çalışır?"
                className={`${fieldClass} mt-1.5`}
              />
            </div>

            {/* Basit eşitlik filtresi */}
            <div className="rounded-[13px] border border-line bg-canvas p-3.5">
              <p className="flex items-center gap-1.5 text-xs font-bold text-text-muted">
                <Filter className="h-3.5 w-3.5 text-brand-600" /> Koşul (opsiyonel)
              </p>
              <p className="mt-1 text-[11px] text-text-faint">
                Yalnız belirli kayıtlarda çalışsın: alan adı ve değeri girin. Boş bırakılırsa akış olayın her
                örneğinde çalışır. Örnek: <code>transaction_type</code> = <code>Satılık</code>.
              </p>
              <div className="mt-2.5 grid gap-2.5 sm:grid-cols-2">
                <input
                  name="filter_key"
                  list="pb-filter-keys"
                  defaultValue={editing?.filterKey ?? ""}
                  placeholder="Alan (örn. transaction_type)"
                  className={fieldClass}
                  aria-label="Koşul alanı"
                />
                <input
                  name="filter_value"
                  list="pb-filter-values"
                  defaultValue={editing?.filterValue ?? ""}
                  placeholder="Değer (örn. Satılık)"
                  className={fieldClass}
                  aria-label="Koşul değeri"
                />
              </div>
              <datalist id="pb-filter-keys">
                {filterHints.map((h) => <option key={h.key} value={h.key}>{h.label}</option>)}
              </datalist>
              <datalist id="pb-filter-values">
                {filterHints.flatMap((h) => h.samples).map((v) => <option key={v} value={v} />)}
              </datalist>
              {filterHints.length === 0 ? (
                <p className="mt-2 text-[11px] text-text-faint">Bu olay için filtrelenebilir alan yok.</p>
              ) : null}
            </div>

            {/* Adımlar */}
            <div>
              <div className="flex items-center justify-between">
                <p className="text-xs font-bold text-text-muted">Adımlar ({steps.length})</p>
                <button
                  type="button"
                  onClick={() => setSteps((prev) => [...prev, emptyStep()])}
                  className="focus-ring press inline-flex items-center gap-1 rounded-[9px] border border-line px-2.5 py-1.5 text-xs font-semibold text-brand-600 transition hover:border-brand-300"
                >
                  <Plus className="h-3.5 w-3.5" /> Adım ekle
                </button>
              </div>

              <ul className="mt-2.5 space-y-2.5">
                {steps.map((s, i) => (
                  <li key={i} className="rounded-[13px] border border-line bg-canvas p-3">
                    <div className="flex items-start gap-2">
                      <span className="mt-2 grid h-6 w-6 shrink-0 place-items-center rounded-full bg-brand-600/10 text-[11px] font-bold text-brand-600">
                        {i + 1}
                      </span>
                      <div className="min-w-0 flex-1 space-y-2">
                        <input
                          value={s.title}
                          onChange={(e) => patchStep(i, { title: e.target.value })}
                          maxLength={200}
                          placeholder="Görev başlığı — örn. Tapu fotokopisi iste"
                          className={fieldClass}
                          aria-label={`${i + 1}. adım başlığı`}
                        />
                        <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
                          <select
                            value={s.kind}
                            onChange={(e) => patchStep(i, { kind: e.target.value })}
                            className={`${fieldClass} appearance-none`}
                            aria-label={`${i + 1}. adım görev türü`}
                          >
                            {Object.entries(PLAYBOOK_KIND_LABELS).map(([v, l]) => (
                              <option key={v} value={v}>{l}</option>
                            ))}
                          </select>
                          <select
                            value={s.priority}
                            onChange={(e) => patchStep(i, { priority: e.target.value })}
                            className={`${fieldClass} appearance-none`}
                            aria-label={`${i + 1}. adım önceliği`}
                          >
                            {Object.entries(PLAYBOOK_PRIORITY_LABELS).map(([v, l]) => (
                              <option key={v} value={v}>{l}</option>
                            ))}
                          </select>
                          <div className="flex items-center gap-1.5">
                            <input
                              type="number"
                              min={0}
                              max={365}
                              value={s.offset_days}
                              onChange={(e) => patchStep(i, { offset_days: Number(e.target.value) })}
                              className={fieldClass}
                              aria-label={`${i + 1}. adım kaç gün sonra`}
                            />
                            <span className="shrink-0 text-[11px] font-semibold text-text-faint">gün sonra</span>
                          </div>
                          <select
                            value={s.assign_to}
                            onChange={(e) =>
                              patchStep(i, { assign_to: e.target.value, assignee_id: e.target.value === "specific" ? s.assignee_id : null })
                            }
                            className={`${fieldClass} appearance-none`}
                            aria-label={`${i + 1}. adım kime atansın`}
                          >
                            {Object.entries(PLAYBOOK_ASSIGN_LABELS).map(([v, l]) => (
                              <option key={v} value={v}>{l}</option>
                            ))}
                          </select>
                        </div>
                        {s.assign_to === "specific" ? (
                          <select
                            value={s.assignee_id ?? ""}
                            onChange={(e) => patchStep(i, { assignee_id: e.target.value || null })}
                            className={`${fieldClass} appearance-none`}
                            aria-label={`${i + 1}. adım için kişi`}
                          >
                            <option value="">Kişi seçin…</option>
                            {staff.map((p) => (
                              <option key={p.id} value={p.id}>{p.full_name}</option>
                            ))}
                          </select>
                        ) : null}
                        <input
                          value={s.note ?? ""}
                          onChange={(e) => patchStep(i, { note: e.target.value || null })}
                          maxLength={500}
                          placeholder="Not (opsiyonel) — göreve açıklama olarak eklenir"
                          className={fieldClass}
                          aria-label={`${i + 1}. adım notu`}
                        />
                      </div>
                      <div className="flex shrink-0 flex-col gap-1">
                        <button
                          type="button"
                          onClick={() => moveStep(i, -1)}
                          disabled={i === 0}
                          title="Yukarı taşı"
                          className="focus-ring press grid h-7 w-7 place-items-center rounded-[8px] border border-line text-text-muted transition hover:border-brand-300 hover:text-brand-600 disabled:opacity-30"
                        >
                          <ArrowUp className="h-3.5 w-3.5" />
                        </button>
                        <button
                          type="button"
                          onClick={() => moveStep(i, 1)}
                          disabled={i === steps.length - 1}
                          title="Aşağı taşı"
                          className="focus-ring press grid h-7 w-7 place-items-center rounded-[8px] border border-line text-text-muted transition hover:border-brand-300 hover:text-brand-600 disabled:opacity-30"
                        >
                          <ArrowDown className="h-3.5 w-3.5" />
                        </button>
                        <button
                          type="button"
                          onClick={() => setSteps((prev) => (prev.length > 1 ? prev.filter((_, k) => k !== i) : prev))}
                          disabled={steps.length === 1}
                          title="Adımı sil"
                          className="focus-ring press grid h-7 w-7 place-items-center rounded-[8px] border border-line text-text-muted transition hover:border-danger-500/40 hover:text-danger-500 disabled:opacity-30"
                        >
                          <Trash2 className="h-3.5 w-3.5" />
                        </button>
                      </div>
                    </div>
                  </li>
                ))}
              </ul>
            </div>

            <label className="flex cursor-pointer items-center gap-2.5 rounded-[11px] border border-line bg-canvas px-3.5 py-2.5">
              <input
                type="checkbox"
                name="is_active"
                defaultChecked={editing?.is_active ?? false}
                className="h-4 w-4 accent-[var(--brand-600)]"
              />
              <span className="text-sm font-semibold text-ink-950">Yayında</span>
              <span className="text-xs text-text-muted">— kapalıyken olay gerçekleşse bile görev açılmaz</span>
            </label>

            {errorMsg ? (
              <p className="rounded-[10px] border border-danger-500/25 bg-danger-500/8 px-3 py-2 text-xs font-semibold text-danger-500">
                {errorMsg}
              </p>
            ) : null}

            <button
              type="submit"
              disabled={pending}
              className="focus-ring press inline-flex w-full items-center justify-center gap-2 rounded-[11px] bg-brand-600 px-4 py-2.5 text-sm font-bold text-white transition hover:bg-brand-700 disabled:opacity-60 sm:w-auto"
            >
              {pending ? <Loader2 className="h-4 w-4 animate-spin" /> : <CheckCircle2 className="h-4 w-4" />}
              {editing ? "Değişiklikleri kaydet" : "İş akışını oluştur"}
            </button>
          </form>
        </section>
      ) : null}

      {/* Liste */}
      <section className="overflow-hidden rounded-[20px] border border-line bg-surface">
        <div className="flex flex-wrap items-center justify-between gap-2 border-b border-line px-5 py-3.5">
          <h2 className="flex items-center gap-2 text-sm font-bold text-ink-950">
            <Workflow className="h-4 w-4 text-brand-600" /> Kayıtlı iş akışları
          </h2>
          <span className="text-xs text-text-faint">{playbooks.length} akış</span>
        </div>

        {playbooks.length === 0 ? (
          <div className="flex flex-col items-center justify-center gap-2 py-16 text-center">
            <span className="grid h-12 w-12 place-items-center rounded-full bg-brand-600/10 text-brand-600">
              <Workflow className="h-6 w-6" />
            </span>
            <p className="font-semibold text-ink-950">Henüz iş akışı yok</p>
            <p className="max-w-sm text-sm text-text-muted">
              Yukarıdaki hazır şablonlardan birini kopyalayın — adımları kendinize göre düzenleyip yayına alın.
            </p>
          </div>
        ) : (
          <ul className="divide-y divide-line">
            {playbooks.map((p) => (
              <li key={p.id} className="px-5 py-4">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div className="min-w-0 flex-1">
                    <p className="flex items-center gap-2 font-semibold text-ink-950">
                      <span className="truncate">{p.name}</span>
                      <span
                        className={`shrink-0 rounded-full px-2 py-0.5 text-[11px] font-bold ${
                          p.is_active ? "bg-mint-50 text-mint-700" : "bg-zinc-100 text-zinc-500"
                        }`}
                      >
                        {p.is_active ? "Yayında" : "Pasif"}
                      </span>
                    </p>
                    {p.description ? (
                      <p className="mt-0.5 line-clamp-1 text-xs text-text-muted">{p.description}</p>
                    ) : null}
                    <div className="mt-1.5 flex flex-wrap items-center gap-1.5 text-[11px]">
                      <span className="inline-flex items-center gap-1 rounded-full bg-amber-400/15 px-2 py-0.5 font-semibold text-amber-700">
                        <Bolt className="h-3 w-3" /> {p.triggerLabel}
                      </span>
                      <span aria-hidden className="text-text-faint">→</span>
                      <span
                        className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 font-semibold ${
                          p.filterKey ? "bg-brand-600/10 text-brand-700" : "bg-ink-950/5 text-text-faint"
                        }`}
                      >
                        <Filter className="h-3 w-3" />
                        {p.filterKey ? `${p.filterKey} = ${p.filterValue}` : "Koşulsuz"}
                      </span>
                      <span aria-hidden className="text-text-faint">→</span>
                      <span className="inline-flex items-center gap-1 rounded-full bg-mint-500/12 px-2 py-0.5 font-semibold text-mint-700">
                        <Workflow className="h-3 w-3" /> {p.steps.length} adım
                      </span>
                      <span className="inline-flex items-center gap-1 rounded-full bg-ink-950/5 px-2 py-0.5 font-semibold text-text-muted">
                        <CheckCircle2 className="h-3 w-3" /> {p.runCount} çalışma
                      </span>
                    </div>
                  </div>

                  {canEdit ? (
                    <div className="flex shrink-0 items-center gap-1.5">
                      <button
                        type="button"
                        onClick={() => toggleActive(p)}
                        disabled={rowPending}
                        className={`focus-ring press rounded-[9px] border px-2.5 py-1.5 text-xs font-bold transition disabled:opacity-50 ${
                          p.is_active
                            ? "border-line text-text-muted hover:border-brand-300 hover:text-brand-600"
                            : "border-mint-500/40 text-mint-700 hover:bg-mint-500/10"
                        }`}
                      >
                        {p.is_active ? "Durdur" : "Yayına al"}
                      </button>
                      <button
                        type="button"
                        onClick={() => openEdit(p)}
                        title="Düzenle"
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
                        title="İş akışı silinsin mi?"
                        description={`"${p.name}" akışı ve ${p.steps.length} adımı kalıcı olarak silinir. Daha önce açılmış görevler silinmez.`}
                        confirmLabel="Kalıcı sil"
                        formAction={deletePlaybookForm}
                        hiddenFields={{ id: p.id }}
                      />
                    </div>
                  ) : null}
                </div>

                {/* Adım önizlemesi — hangi görev kaçıncı gün açılacak */}
                {p.steps.length > 0 ? (
                  <ol className="mt-3 grid gap-1.5 sm:grid-cols-2 lg:grid-cols-3">
                    {p.steps.map((s, i) => (
                      <li key={i} className="flex items-center gap-2 rounded-[10px] border border-line bg-canvas px-2.5 py-1.5">
                        <span className="grid h-5 w-5 shrink-0 place-items-center rounded-full bg-brand-600/10 text-[10px] font-bold text-brand-600">
                          {i + 1}
                        </span>
                        <span className="min-w-0 flex-1 truncate text-xs font-semibold text-ink-950">{s.title}</span>
                        <span className={`shrink-0 rounded-full px-1.5 py-0.5 text-[10px] font-bold ${PRIORITY_BADGE[s.priority] ?? PRIORITY_BADGE.normal}`}>
                          {PLAYBOOK_KIND_LABELS[s.kind] ?? s.kind}
                        </span>
                        <span className="shrink-0 text-[10px] font-semibold text-text-faint">{offsetLabel(s.offset_days)}</span>
                      </li>
                    ))}
                  </ol>
                ) : (
                  <p className="mt-3 rounded-[10px] border border-dashed border-line px-3 py-2 text-xs text-text-faint">
                    Adım yok — bu akış yayına alınamaz.
                  </p>
                )}
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
