"use client";

import { useId, type ReactNode } from "react";
import { AlertTriangle, ArrowDown, ArrowUp, Eye, EyeOff, Plus, Trash2 } from "lucide-react";
import { Input, Textarea } from "@/components/ui/input";
import type { Issue } from "@/lib/site-menu/schema";
import type { SiteContent } from "@/lib/site-content/schema";
import { moveInArray } from "@/lib/site-menu/editor-model";
import { btn, iconBtn } from "../site-menu/editor-ui";

/** Taslağı yerinde değiştiren güncelleyici (kopya üzerinde çalışır). */
export type Update = (fn: (draft: SiteContent) => void) => void;

const issueAt = (issues: readonly Issue[], path: string, level: Issue["level"]) => issues.find((i) => i.path === path && i.level === level);

export function Txt({
  label,
  value,
  onChange,
  max,
  issues,
  path,
  multiline = false,
  readOnly,
  hint,
  list,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  max: number;
  issues: readonly Issue[];
  path: string;
  multiline?: boolean;
  readOnly: boolean;
  hint?: ReactNode;
  list?: string;
}) {
  const id = useId();
  const err = issueAt(issues, path, "error");
  const warn = issueAt(issues, path, "warn");
  const shown = err ?? warn;
  const common = { id, value, maxLength: max, readOnly, "aria-invalid": err ? true : undefined, "aria-describedby": shown ? `${id}-i` : undefined } as const;
  return (
    <div className="min-w-0">
      <label htmlFor={id} className="mb-1 flex items-baseline justify-between gap-2 text-xs font-semibold text-ink-950">
        <span>{label}</span>
        <span className={`font-normal ${value.length > max * 0.9 ? "text-amber-700" : "text-text-faint"}`}>{value.length}/{max}</span>
      </label>
      {multiline ? (
        <Textarea {...common} rows={3} onChange={(e) => onChange(e.target.value)} />
      ) : (
        <Input {...common} list={list} onChange={(e) => onChange(e.target.value)} />
      )}
      {shown ? (
        <span id={`${id}-i`} role={err ? "alert" : "status"} className={`mt-1 flex items-start gap-1 text-xs font-semibold ${err ? "text-danger-500" : "text-amber-700"}`}>
          <AlertTriangle className="mt-px h-3.5 w-3.5 shrink-0" aria-hidden="true" />
          {shown.message}
        </span>
      ) : hint ? (
        <span className="mt-1 block text-xs text-text-faint">{hint}</span>
      ) : null}
    </div>
  );
}

export function Card({ title, children, aside }: { title: string; children: ReactNode; aside?: ReactNode }) {
  return (
    <section className="rounded-[var(--radius-panel)] border border-line bg-surface p-4">
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <h3 className="font-display text-base font-extrabold text-ink-950">{title}</h3>
        {aside}
      </div>
      <div className="grid gap-3 sm:grid-cols-2">{children}</div>
    </section>
  );
}

export const Full = ({ children }: { children: ReactNode }) => <div className="sm:col-span-2">{children}</div>;

/** Bağlantı + metin çifti (düğme). */
export function CtaFields({
  label,
  value,
  onChange,
  issues,
  path,
  readOnly,
}: {
  label: string;
  value: { label: string; href: string };
  onChange: (v: { label: string; href: string }) => void;
  issues: readonly Issue[];
  path: string;
  readOnly: boolean;
}) {
  return (
    <>
      <Txt label={`${label}: düğme metni`} value={value.label} max={40} onChange={(v) => onChange({ ...value, label: v })} issues={issues} path={`${path}.label`} readOnly={readOnly} />
      <Txt label={`${label}: bağlantı`} value={value.href} max={300} onChange={(v) => onChange({ ...value, href: v })} issues={issues} path={`${path}.href`} readOnly={readOnly} list="site-menu-targets" />
    </>
  );
}

/** Sıralanabilir, gizlenebilir (ve isteğe bağlı eklenip silinebilir) liste kabuğu. */
export function ListShell<T extends { id: string; hidden: boolean }>({
  title,
  items,
  setItems,
  readOnly,
  summary,
  render,
  onAdd,
  addLabel,
  max,
}: {
  title: string;
  items: T[];
  setItems: (next: T[]) => void;
  readOnly: boolean;
  summary: (it: T) => string;
  render: (it: T, i: number) => ReactNode;
  onAdd?: () => void;
  addLabel?: string;
  max?: number;
}) {
  return (
    <section className="rounded-[var(--radius-panel)] border border-line bg-surface p-4">
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <h3 className="font-display text-base font-extrabold text-ink-950">{title}</h3>
        {onAdd && !readOnly ? (
          <button type="button" className={btn} disabled={max !== undefined && items.length >= max} onClick={onAdd}>
            <Plus className="h-3.5 w-3.5" aria-hidden="true" />
            {addLabel ?? "Ekle"}
          </button>
        ) : null}
      </div>
      <ol className="space-y-3">
        {items.map((it, i) => (
          <li key={it.id} className={`rounded-[var(--radius-card)] border border-line p-3 ${it.hidden ? "opacity-60" : ""}`}>
            <div className="mb-2 flex items-center justify-between gap-2">
              <p className="truncate text-xs font-bold text-text-muted">{i + 1}. {summary(it) || "(boş)"}{it.hidden ? " · gizli" : ""}</p>
              {!readOnly ? (
                <div className="flex shrink-0 gap-1">
                  <button type="button" className={iconBtn} aria-label="Yukarı taşı" disabled={i === 0} onClick={() => setItems(moveInArray(items, i, i - 1))}><ArrowUp className="h-4 w-4" aria-hidden="true" /></button>
                  <button type="button" className={iconBtn} aria-label="Aşağı taşı" disabled={i === items.length - 1} onClick={() => setItems(moveInArray(items, i, i + 1))}><ArrowDown className="h-4 w-4" aria-hidden="true" /></button>
                  <button type="button" className={iconBtn} aria-label={it.hidden ? "Göster" : "Gizle"} aria-pressed={it.hidden} onClick={() => setItems(items.map((x, n) => (n === i ? { ...x, hidden: !x.hidden } : x)))}>
                    {it.hidden ? <EyeOff className="h-4 w-4" aria-hidden="true" /> : <Eye className="h-4 w-4" aria-hidden="true" />}
                  </button>
                  {onAdd ? <button type="button" className={iconBtn} aria-label="Sil" onClick={() => setItems(items.filter((_, n) => n !== i))}><Trash2 className="h-4 w-4" aria-hidden="true" /></button> : null}
                </div>
              ) : null}
            </div>
            <div className="grid gap-3 sm:grid-cols-2">{render(it, i)}</div>
          </li>
        ))}
        {items.length === 0 ? <li className="text-sm text-text-muted">Kayıt yok.</li> : null}
      </ol>
    </section>
  );
}

/** Sonraki boş kimlik: `f12` gibi (sayısal sonek artar). */
export function nextId(prefix: string, taken: readonly string[]): string {
  let n = 1;
  for (const t of taken) {
    const m = new RegExp(`^${prefix}(\\d+)$`).exec(t);
    if (m) n = Math.max(n, Number(m[1]) + 1);
  }
  return `${prefix}${n}`;
}
