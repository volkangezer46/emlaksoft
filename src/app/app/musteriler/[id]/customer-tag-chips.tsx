"use client";

import { useRef, useState, useTransition } from "react";
import { Plus, Tag, X } from "lucide-react";
import { addCustomerTag, removeCustomerTag } from "@/app/actions/customers";

/**
 * Müşteri 360 hero'sundaki etiket chip'leri + "Etiket ekle" girişi.
 *
 * Yazarken tenant'ın mevcut etiketlerinden öneri düşer (suggestions —
 * server'dan prop'la gelir), Enter yepyeni bir etiket de ekler. Kayıt
 * server action'da yapılır; hero server component olduğundan revalidate
 * sonrası taze etiketler prop olarak geri iner (yerel kopya tutulmaz).
 */
export function CustomerTagChips({
  customerId,
  tags,
  suggestions,
  canEdit,
}: {
  customerId: string;
  tags: string[];
  suggestions: string[];
  canEdit: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [value, setValue] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const inputRef = useRef<HTMLInputElement>(null);

  const lower = (s: string) => s.toLocaleLowerCase("tr-TR");
  const term = value.trim().replace(/\s+/g, " ");
  const existing = new Set(tags.map(lower));
  const matches = suggestions
    .filter((s) => !existing.has(lower(s)) && (!term || lower(s).includes(lower(term))))
    .slice(0, 8);

  const submit = (raw: string) => {
    const clean = raw.trim().replace(/\s+/g, " ");
    if (!clean || pending) return;
    setError(null);
    startTransition(async () => {
      const res = await addCustomerTag(customerId, clean);
      if (res.error) {
        setError(res.error);
        return;
      }
      setValue("");
      inputRef.current?.focus();
    });
  };

  const remove = (tag: string) => {
    if (pending) return;
    setError(null);
    startTransition(async () => {
      const res = await removeCustomerTag(customerId, tag);
      if (res.error) setError(res.error);
    });
  };

  return (
    <div className="mt-2">
      <div className="flex flex-wrap items-center gap-1.5">
        {tags.map((tag) => (
          <span
            key={tag}
            className="inline-flex items-center gap-1 rounded-full bg-cyan-500/15 py-0.5 pl-2.5 pr-1.5 text-[11px] font-semibold text-cyan-300 ring-1 ring-inset ring-cyan-400/25"
          >
            <Tag className="h-3 w-3" />
            {tag}
            {canEdit ? (
              <button
                type="button"
                onClick={() => remove(tag)}
                disabled={pending}
                aria-label={`${tag} etiketini kaldır`}
                className="grid h-4 w-4 place-items-center rounded-full text-cyan-300/70 transition hover:bg-white/10 hover:text-white disabled:opacity-50"
              >
                <X className="h-3 w-3" />
              </button>
            ) : null}
          </span>
        ))}

        {canEdit && !open ? (
          <button
            type="button"
            onClick={() => {
              setOpen(true);
              setError(null);
            }}
            className="inline-flex items-center gap-1 rounded-full border border-dashed border-white/25 px-2.5 py-0.5 text-[11px] font-semibold text-white/60 transition hover:border-cyan-400/60 hover:text-cyan-300"
          >
            <Plus className="h-3 w-3" /> Etiket ekle
          </button>
        ) : null}

        {canEdit && open ? (
          <div className="relative">
            <input
              ref={inputRef}
              value={value}
              onChange={(e) => {
                setValue(e.target.value);
                setError(null);
              }}
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  e.preventDefault();
                  submit(value);
                } else if (e.key === "Escape") {
                  setOpen(false);
                  setValue("");
                  setError(null);
                }
              }}
              autoFocus
              maxLength={30}
              disabled={pending}
              placeholder="Etiket yaz, Enter'a bas…"
              aria-label="Yeni etiket"
              className="w-44 rounded-full border border-white/20 bg-white/10 px-3 py-1 text-[12px] text-white placeholder:text-white/40 outline-none transition focus:border-cyan-400/60 disabled:opacity-60"
            />
            <button
              type="button"
              onClick={() => {
                setOpen(false);
                setValue("");
                setError(null);
              }}
              aria-label="Etiket eklemeyi kapat"
              className="absolute right-1.5 top-1/2 grid h-5 w-5 -translate-y-1/2 place-items-center rounded-full text-white/50 transition hover:bg-white/10 hover:text-white"
            >
              <X className="h-3 w-3" />
            </button>
            {matches.length > 0 ? (
              <ul className="absolute left-0 top-full z-20 mt-1.5 max-h-52 w-52 overflow-auto rounded-[12px] border border-line bg-surface p-1 shadow-[var(--elev-2)]">
                {matches.map((s) => (
                  <li key={s}>
                    <button
                      type="button"
                      onClick={() => submit(s)}
                      disabled={pending}
                      className="flex w-full items-center gap-1.5 rounded-[8px] px-2.5 py-1.5 text-left text-xs font-medium text-ink-950 transition hover:bg-brand-600/10 hover:text-brand-700 disabled:opacity-50"
                    >
                      <Tag className="h-3 w-3 text-text-faint" />
                      {s}
                    </button>
                  </li>
                ))}
              </ul>
            ) : null}
          </div>
        ) : null}

        {tags.length === 0 && !canEdit ? (
          <span className="text-xs text-white/40">Etiket yok</span>
        ) : null}
      </div>
      {error ? (
        <p className="mt-1 text-[11px] font-semibold text-danger-400" role="alert">
          {error}
        </p>
      ) : null}
    </div>
  );
}
