"use client";

import { useActionState, useEffect, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Check, Globe, Loader2, Lock, Pencil, Plus, Trash2, X } from "lucide-react";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { addDefinition, toggleDefinition, deleteDefinition, renameDefinition, type DefinitionResult } from "@/app/actions/definitions";

export type DefRow = {
  id: string;
  tenant_id: string | null;
  category: string;
  value: string;
  label: string;
  color: string | null;
  sort_order: number;
  is_active: boolean;
};

type Category = { key: string; label: string; items: DefRow[] };

const init: DefinitionResult = {};

export function DefinitionsManager({ categories, tenantId }: { categories: Category[]; tenantId: string | null }) {
  const [active, setActive] = useState(categories[0]?.key ?? "");
  const current = categories.find((c) => c.key === active) ?? categories[0];

  return (
    <div className="space-y-4">
      {/* Kategori sekmeleri */}
      <div className="flex flex-wrap gap-2">
        {categories.map((c) => (
          <button
            key={c.key}
            type="button"
            onClick={() => setActive(c.key)}
            className={`rounded-[11px] px-3.5 py-2 text-sm font-semibold transition ${active === c.key ? "bg-brand-600 text-white" : "border border-line bg-surface text-text-muted hover:border-brand-400 hover:text-brand-600"}`}
          >
            {c.label}
          </button>
        ))}
      </div>

      {current ? <CategoryPanel category={current} tenantId={tenantId} /> : null}
    </div>
  );
}

function CategoryPanel({ category, tenantId }: { category: Category; tenantId: string | null }) {
  const router = useRouter();
  const formRef = useRef<HTMLFormElement>(null);
  const [state, action, pending] = useActionState(addDefinition, init);
  const [busy, setBusy] = useState<string | null>(null);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editLabel, setEditLabel] = useState("");
  const [rowError, setRowError] = useState<string | null>(null);
  const [, startTransition] = useTransition();

  useEffect(() => {
    if (state.ok) {
      formRef.current?.reset();
      router.refresh();
    }
  }, [state, router]);

  function onToggle(id: string, next: boolean) {
    setBusy(id);
    startTransition(async () => {
      await toggleDefinition(id, next);
      setBusy(null);
      router.refresh();
    });
  }
  async function onDelete(id: string) {
    setBusy(id);
    setRowError(null);
    const res = await deleteDefinition(id);
    setBusy(null);
    if (res.error) setRowError(res.error);
    router.refresh();
  }
  function startEdit(d: DefRow) {
    setEditingId(d.id);
    setEditLabel(d.label);
    setRowError(null);
  }
  function onRename(id: string) {
    const next = editLabel.trim();
    if (!next) return;
    setBusy(id);
    setRowError(null);
    startTransition(async () => {
      const res = await renameDefinition(id, next);
      setBusy(null);
      if (res.error) {
        setRowError(res.error);
      } else {
        setEditingId(null);
      }
      router.refresh();
    });
  }

  return (
    <div className="rounded-[18px] border border-line bg-surface p-5 shadow-[var(--shadow-xs)]">
      {rowError ? <p className="mb-3 text-sm text-danger-500" role="alert">{rowError}</p> : null}
      <div className="space-y-2">
        {category.items.length === 0 ? (
          <p className="py-6 text-center text-sm text-text-muted">Bu kategoride tanım yok.</p>
        ) : (
          category.items.map((d) => {
            const isGlobal = d.tenant_id == null;
            const isOwn = d.tenant_id === tenantId;
            return (
              <div key={d.id} className={`flex items-center gap-3 rounded-[12px] border border-line px-4 py-2.5 ${!d.is_active ? "opacity-55" : ""}`}>
                <span className="grid h-7 w-7 shrink-0 place-items-center rounded-[8px] bg-canvas text-text-faint" title={isGlobal ? "Sistem varsayılanı" : "Ofise özel"}>
                  {isGlobal ? <Globe className="h-3.5 w-3.5" /> : <Lock className="h-3.5 w-3.5 text-brand-600" />}
                </span>
                {editingId === d.id ? (
                  <div className="flex min-w-0 flex-1 items-center gap-1.5">
                    <input
                      value={editLabel}
                      onChange={(e) => setEditLabel(e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === "Enter") { e.preventDefault(); onRename(d.id); }
                        if (e.key === "Escape") setEditingId(null);
                      }}
                      autoFocus
                      aria-label="Yeni etiket"
                      className="w-full min-w-0 flex-1 rounded-[8px] border border-brand-400 bg-canvas px-2.5 py-1.5 text-sm outline-none"
                    />
                    <button type="button" onClick={() => onRename(d.id)} disabled={busy === d.id || !editLabel.trim()} aria-label="Kaydet" className="grid h-7 w-7 min-h-9 min-w-9 shrink-0 place-items-center rounded-[8px] bg-brand-600 text-white transition hover:bg-brand-700 disabled:opacity-50">
                      {busy === d.id ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Check className="h-3.5 w-3.5" />}
                    </button>
                    <button type="button" onClick={() => setEditingId(null)} aria-label="Vazgeç" className="grid h-7 w-7 min-h-9 min-w-9 shrink-0 place-items-center rounded-[8px] text-text-faint transition hover:bg-canvas hover:text-ink-950">
                      <X className="h-3.5 w-3.5" />
                    </button>
                  </div>
                ) : (
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-semibold text-ink-950">{d.label}</p>
                    {d.value !== d.label ? <p className="truncate text-[11px] text-text-faint">değer: {d.value}</p> : null}
                  </div>
                )}
                {isGlobal ? (
                  <span className="rounded-full bg-canvas px-2 py-0.5 text-[11px] font-semibold text-text-muted">Sistem</span>
                ) : isOwn ? (
                  <div className="flex items-center gap-1.5">
                    {editingId !== d.id ? (
                      <button type="button" onClick={() => startEdit(d)} disabled={busy === d.id} aria-label="Yeniden adlandır" className="grid h-7 w-7 min-h-9 min-w-9 place-items-center rounded-[8px] text-text-faint transition hover:bg-canvas hover:text-brand-600 disabled:opacity-50">
                        <Pencil className="h-3.5 w-3.5" />
                      </button>
                    ) : null}
                    <button
                      type="button"
                      onClick={() => onToggle(d.id, !d.is_active)}
                      disabled={busy === d.id}
                      className={`rounded-[8px] border px-2.5 py-1 text-[11px] font-semibold transition disabled:opacity-50 ${d.is_active ? "border-line text-text-muted hover:border-amber-400 hover:text-amber-600" : "border-mint-500/30 text-mint-600"}`}
                    >
                      {busy === d.id ? <Loader2 className="h-3 w-3 animate-spin" /> : d.is_active ? "Gizle" : "Göster"}
                    </button>
                    <ConfirmDialog
                      title="Tanımı sil"
                      description={`"${d.label}" seçeneği kalıcı olarak silinecek. Bu tanımı kullanan kayıtlar etkilenmez ama seçenek listelerden kalkar.`}
                      confirmLabel="Sil"
                      onConfirm={() => onDelete(d.id)}
                      trigger={
                        <button type="button" disabled={busy === d.id} aria-label="Sil" className="grid h-7 w-7 min-h-9 min-w-9 place-items-center rounded-[8px] text-text-faint transition hover:bg-danger-500/10 hover:text-danger-500 disabled:opacity-50">
                          <Trash2 className="h-3.5 w-3.5" />
                        </button>
                      }
                    />
                  </div>
                ) : null}
              </div>
            );
          })
        )}
      </div>

      {/* Yeni ekle */}
      <form ref={formRef} action={action} className="mt-4 flex flex-wrap items-end gap-2 border-t border-line pt-4">
        <input type="hidden" name="category" value={category.key} />
        <div className="min-w-[160px] flex-1">
          <label className="mb-1 block text-xs text-text-muted" htmlFor={`label-${category.key}`}>Yeni seçenek (etiket)</label>
          <input id={`label-${category.key}`} name="label" required placeholder="Ör. Turizm yatırımcısı" className="w-full rounded-[10px] border border-line bg-canvas px-3 py-2 text-sm outline-none focus:border-brand-400" />
        </div>
        <div className="w-40">
          <label className="mb-1 block text-xs text-text-muted" htmlFor={`value-${category.key}`}>Değer <span className="text-text-faint">(ops.)</span></label>
          <input id={`value-${category.key}`} name="value" placeholder="boşsa etiket" className="w-full rounded-[10px] border border-line bg-canvas px-3 py-2 text-sm outline-none focus:border-brand-400" />
        </div>
        <button type="submit" disabled={pending} className="inline-flex items-center gap-1.5 rounded-[10px] bg-brand-600 px-4 py-2 text-sm font-semibold text-white transition hover:bg-brand-700 disabled:opacity-60">
          {pending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Plus className="h-4 w-4" />} Ekle
        </button>
        {state.error ? <p className="w-full text-sm text-danger-500">{state.error}</p> : null}
      </form>
    </div>
  );
}
