"use client";

import { useMemo, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { AtSign, ChevronDown, NotebookPen, Pin, PinOff, Send } from "lucide-react";
import { Button } from "@/components/ui/button";
import { FilterChip } from "@/components/ui/filter-chip";
import { useToast } from "@/components/app/toast-provider";
import { now } from "@/lib/clock";
import {
  countNotes,
  filterNotes,
  matchMembers,
  mentionQueryAt,
  NOTE_FILTERS,
  NOTE_MAX_LENGTH,
  resolveMentions,
  sortNotes,
  splitMentions,
  type CustomerNote,
  type NoteFilter,
  type NoteMember,
} from "@/lib/customer-notes";
import { createCustomerNote, setCustomerNotePinned } from "@/app/actions/customer-notes";

const PAGE = 8;
const TEMP = "tmp-note-";
let seq = 0;

function when(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  return new Intl.DateTimeFormat("tr-TR", { timeZone: "Europe/Istanbul", dateStyle: "medium", timeStyle: "short" }).format(d);
}

function initials(name: string) {
  return name.split(/\s+/).map((p) => p[0] ?? "").join("").slice(0, 2).toLocaleUpperCase("tr-TR");
}

/**
 * Müşteri 360 "Notlar" (CRM-G9): sabitlenebilen, @anmalı, filtrelenebilen not listesi. Not yazarken "@" ile ekip
 * arkadaşı seçilir (klavye: ↑ ↓ Enter, Esc kapatır); anılan kişiye müşteri kartına giden bildirim gider. Sabitlenen
 * notlar (en çok 3) listenin başında ve künyenin altındaki şeritte görünür. Eski serbest metin "Genel açıklama" olarak
 * ayrıca gösterilir (not listesine bir kez "Önceki notlar" olarak aktarılmıştır).
 */
export function CustomerNotesPanel({
  customerId,
  notes: serverNotes,
  members,
  userId,
  canCreate,
  canPin,
  pinAvailable,
  generalNote,
  initialFilter = "tum",
}: {
  customerId: string;
  notes: CustomerNote[];
  members: NoteMember[];
  userId: string;
  canCreate: boolean;
  canPin: boolean;
  pinAvailable: boolean;
  generalNote: string | null;
  initialFilter?: NoteFilter;
}) {
  const router = useRouter();
  const { push } = useToast();
  const [filter, setFilter] = useState<NoteFilter>(initialFilter);
  const [limit, setLimit] = useState(PAGE);
  const [pending, setPending] = useState<CustomerNote[]>([]);
  const [pinOverride, setPinOverride] = useState<Record<string, string | null>>({});
  const [, startPin] = useTransition();

  // Sunucu listesi + bekleyen iyimser notlar (sunucuda görünen iyimser kayıt düşer); sabitleme iyimser uygulanır.
  const notes = useMemo(() => {
    const merged = [...pending.filter((p) => !serverNotes.some((s) => s.body === p.body && s.author_id === p.author_id)), ...serverNotes];
    return sortNotes(merged.map((n) => (n.id in pinOverride ? { ...n, pinned_at: pinOverride[n.id] ?? null } : n)));
  }, [pending, serverNotes, pinOverride]);
  const counts = countNotes(notes, userId);
  const visible = filterNotes(notes, filter, userId);
  const memberNames = useMemo(() => members.map((m) => m.name), [members]);
  const imported = notes.find((n) => n.origin === "customers.notes");
  const showGeneral = !!generalNote?.trim() && generalNote.trim() !== imported?.body.trim();

  function choose(next: NoteFilter) {
    setFilter(next);
    setLimit(PAGE);
    try {
      const url = new URL(window.location.href);
      if (next === "tum") url.searchParams.delete("notlar");
      else url.searchParams.set("notlar", next);
      window.history.replaceState(window.history.state, "", url.toString());
    } catch {
      /* URL güncellenemezse süzgeç yine çalışır */
    }
  }

  function togglePin(n: CustomerNote) {
    const next = n.pinned_at ? null : new Date(now()).toISOString();
    setPinOverride((p) => ({ ...p, [n.id]: next }));
    startPin(async () => {
      const res = await setCustomerNotePinned(n.id, next !== null);
      if (res.ok) {
        push(next ? "Not sabitlendi" : "Sabitleme kaldırıldı", "ok");
        router.refresh();
      } else {
        setPinOverride((p) => ({ ...p, [n.id]: n.pinned_at }));
        push(res.error ?? "İşlem tamamlanamadı.", "err");
      }
    });
  }

  return (
    <section id="notlar" aria-labelledby="notlar-baslik" className="scroll-mt-24 rounded-[var(--radius-panel)] border border-line bg-surface p-4 shadow-[var(--shadow-xs)] sm:p-5">
      <h2 id="notlar-baslik" className="flex items-center gap-2 font-display font-bold text-ink-950">
        <NotebookPen className="h-4 w-4 text-amber-500" aria-hidden /> Notlar
      </h2>

      {canCreate ? (
        <NoteComposer
          customerId={customerId}
          members={members}
          onOptimistic={(n) => setPending((p) => [n, ...p])}
          onSettled={(tempId, ok) => {
            setPending((p) => (ok ? p : p.filter((x) => x.id !== tempId)));
            if (ok) router.refresh();
          }}
          userId={userId}
        />
      ) : null}

      {showGeneral ? (
        <details className="group mt-3 rounded-[var(--radius-card)] border border-line bg-canvas/50 px-3 py-2">
          <summary className="flex cursor-pointer list-none items-center justify-between gap-2 text-sm font-semibold text-ink-950 touch:min-h-11">
            Genel açıklama
            <ChevronDown className="h-4 w-4 text-text-faint transition group-open:rotate-180" aria-hidden />
          </summary>
          <p className="mt-2 whitespace-pre-line text-sm leading-relaxed text-text-muted">{generalNote}</p>
        </details>
      ) : null}

      {notes.length > 0 ? (
        <div role="tablist" aria-label="Not süzgeci" className="-mx-1 mt-4 flex gap-1.5 overflow-x-auto px-1 pb-1">
          {NOTE_FILTERS.map((f) => {
            const active = filter === f.key;
            const n = counts[f.key];
            if (f.key !== "tum" && n === 0 && !active) return null;
            return (
              <FilterChip key={f.key} role="tab" aria-selected={active} active={active} count={n} onClick={() => choose(f.key)} className="shrink-0">
                {f.label}
              </FilterChip>
            );
          })}
        </div>
      ) : null}

      {visible.length === 0 ? (
        <p className="mt-3 text-sm text-text-muted">
          {notes.length === 0
            ? "Henüz not yok. Görüşme özeti, kritik bilgi ya da ekip arkadaşınıza @ ile not bırakın."
            : filter === "bana"
              ? "Sizden bahseden not yok."
              : filter === "sabit"
                ? "Sabitlenmiş not yok. Önemli bir notu sabitleyin; künyenin altında görünsün."
                : "Bu süzgeçte not yok."}
        </p>
      ) : (
        <ul className="mt-3 space-y-2" aria-label="Notlar">
          {visible.slice(0, limit).map((n) => {
            const author = n.author_name?.trim() || (n.origin ? "Önceki kayıt" : "Ekip");
            const tmp = n.id.startsWith(TEMP);
            const mine = n.mentioned_user_ids.includes(userId);
            return (
              <li
                key={n.id}
                className={`rounded-[var(--radius-card)] border px-3 py-2.5 ${n.pinned_at ? "border-amber-400/40 bg-amber-400/[0.06]" : mine ? "border-brand-300/60 bg-brand-600/[0.04]" : "border-line bg-canvas/50"} ${tmp ? "opacity-70" : ""}`}
              >
                <div className="flex items-start gap-2.5">
                  <span className="mt-0.5 grid h-7 w-7 shrink-0 place-items-center rounded-full bg-ink-950/5 text-[0.7rem] font-extrabold text-text-muted" aria-hidden>
                    {initials(author)}
                  </span>
                  <div className="min-w-0 flex-1">
                    <p className="flex flex-wrap items-center gap-x-2 gap-y-0.5 text-xs text-text-faint">
                      <span className="font-semibold text-ink-950">{author}</span>
                      <span>{tmp ? "kaydediliyor…" : when(n.created_at)}</span>
                      {n.pinned_at ? (
                        <span className="inline-flex items-center gap-0.5 rounded-full bg-amber-400/15 px-1.5 py-px font-bold text-amber-700">
                          <Pin className="h-3 w-3" aria-hidden /> Sabit
                        </span>
                      ) : null}
                      {n.origin === "customers.notes" ? (
                        <span className="rounded-full bg-canvas px-1.5 py-px font-semibold text-text-muted">Önceki notlar</span>
                      ) : null}
                    </p>
                    <p className="mt-1 whitespace-pre-line break-words text-sm leading-relaxed text-ink-950">
                      {splitMentions(n.body, memberNames).map((part, i) =>
                        part.mention ? (
                          <span key={i} className="rounded bg-brand-600/10 px-0.5 font-semibold text-brand-700">{part.text}</span>
                        ) : (
                          <span key={i}>{part.text}</span>
                        ),
                      )}
                    </p>
                  </div>
                  {canPin && pinAvailable && !tmp ? (
                    <Button
                      variant="ghost"
                      size="icon"
                      icon={n.pinned_at ? PinOff : Pin}
                      onClick={() => togglePin(n)}
                      aria-pressed={!!n.pinned_at}
                      aria-label={n.pinned_at ? "Sabitlemeyi kaldır" : "Notu sabitle"}
                      title={n.pinned_at ? "Sabitlemeyi kaldır" : "Notu sabitle (en çok 3)"}
                      className={`shrink-0 ${n.pinned_at ? "text-amber-600" : ""}`}
                    />
                  ) : null}
                </div>
              </li>
            );
          })}
        </ul>
      )}

      {visible.length > limit ? (
        <Button variant="ghost" size="sm" className="mt-2 w-full" icon={ChevronDown} onClick={() => setLimit((l) => l + PAGE * 2)}>
          {visible.length - limit} not daha göster
        </Button>
      ) : null}
    </section>
  );
}

function NoteComposer({
  customerId,
  members,
  userId,
  onOptimistic,
  onSettled,
}: {
  customerId: string;
  members: NoteMember[];
  userId: string;
  onOptimistic: (n: CustomerNote) => void;
  onSettled: (tempId: string, ok: boolean) => void;
}) {
  const { push } = useToast();
  const ref = useRef<HTMLTextAreaElement>(null);
  const [text, setText] = useState("");
  const [picked, setPicked] = useState<string[]>([]);
  const [query, setQuery] = useState<{ start: number; query: string } | null>(null);
  const [active, setActive] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [saving, startSave] = useTransition();
  const options = query ? matchMembers(members, query.query) : [];
  const open = !!query && options.length > 0;

  function sync(value: string, caret: number) {
    setText(value);
    setQuery(mentionQueryAt(value, caret));
    setActive(0);
  }

  function insert(m: NoteMember) {
    if (!query) return;
    const caret = ref.current?.selectionStart ?? text.length;
    const before = text.slice(0, query.start);
    const after = text.slice(caret);
    const token = `@${m.name} `;
    const next = `${before}${token}${after}`;
    setText(next);
    setPicked((p) => (p.includes(m.id) ? p : [...p, m.id]));
    setQuery(null);
    requestAnimationFrame(() => {
      const pos = before.length + token.length;
      ref.current?.focus();
      ref.current?.setSelectionRange(pos, pos);
    });
  }

  function submit() {
    const body = text.trim();
    if (!body) {
      setError("Not boş olamaz.");
      return;
    }
    if (saving) return;
    setError(null);
    const mentions = resolveMentions(body, picked, members);
    const tempId = `${TEMP}${++seq}`;
    const me = members.find((m) => m.id === userId);
    onOptimistic({
      id: tempId,
      body,
      subject: null,
      created_at: new Date(now()).toISOString(),
      pinned_at: null,
      mentioned_user_ids: mentions,
      author_id: userId,
      author_name: me?.name ?? "Siz",
      origin: null,
    });
    setText("");
    setPicked([]);
    startSave(async () => {
      try {
        const res = await createCustomerNote(customerId, body, mentions);
        if (res.ok) {
          push(res.notified ? `Not eklendi · ${res.notified} kişiye bildirim gitti` : "Not eklendi", "ok");
          onSettled(tempId, true);
        } else {
          onSettled(tempId, false);
          setText(body);
          setError(res.error ?? "Not kaydedilemedi.");
        }
      } catch {
        onSettled(tempId, false);
        setText(body);
        setError("Bağlantı hatası: not kaydedilemedi. Lütfen tekrar deneyin.");
      }
    });
  }

  return (
    <div className="relative mt-3">
      <label htmlFor={`note-composer-${customerId}`} className="sr-only">Not yazın</label>
      <textarea
        ref={ref}
        id={`note-composer-${customerId}`}
        value={text}
        rows={2}
        maxLength={NOTE_MAX_LENGTH}
        placeholder="Not yazın… Ekip arkadaşınızı anmak için @ yazın."
        role="combobox"
        aria-expanded={open}
        aria-controls={`note-mentions-${customerId}`}
        aria-autocomplete="list"
        aria-activedescendant={open ? `note-mention-${customerId}-${active}` : undefined}
        onChange={(e) => sync(e.target.value, e.target.selectionStart ?? e.target.value.length)}
        onClick={(e) => setQuery(mentionQueryAt(e.currentTarget.value, e.currentTarget.selectionStart ?? 0))}
        onKeyDown={(e) => {
          if (open) {
            if (e.key === "ArrowDown") { e.preventDefault(); setActive((a) => (a + 1) % options.length); return; }
            if (e.key === "ArrowUp") { e.preventDefault(); setActive((a) => (a - 1 + options.length) % options.length); return; }
            if (e.key === "Enter" || e.key === "Tab") { e.preventDefault(); insert(options[active]!); return; }
            if (e.key === "Escape") { e.preventDefault(); setQuery(null); return; }
          }
          if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) {
            e.preventDefault();
            submit();
          }
        }}
        className="w-full resize-y rounded-[var(--radius-control)] border border-line bg-canvas px-3 py-2 text-sm outline-none focus:border-brand-300 touch:text-base"
      />
      {open ? (
        <ul
          id={`note-mentions-${customerId}`}
          role="listbox"
          aria-label="Ekip arkadaşı seçin"
          className="popover-in absolute left-0 right-0 z-20 mt-1 max-h-56 overflow-y-auto rounded-[var(--radius-card)] border border-line bg-surface p-1 shadow-[var(--shadow-lg)] sm:right-auto sm:w-72"
        >
          {options.map((m, i) => (
            <li
              key={m.id}
              id={`note-mention-${customerId}-${i}`}
              role="option"
              aria-selected={i === active}
              onMouseDown={(e) => { e.preventDefault(); insert(m); }}
              className={`flex cursor-pointer items-center gap-2 rounded-[var(--radius-control)] px-2.5 py-2 text-sm touch:min-h-11 ${i === active ? "bg-surface-selected text-brand-700" : "text-ink-950"}`}
            >
              <AtSign className="h-3.5 w-3.5 text-text-faint" aria-hidden />
              {m.name}
              {m.id === userId ? <span className="text-xs text-text-faint">(siz)</span> : null}
            </li>
          ))}
        </ul>
      ) : null}
      {error ? (
        <p role="alert" className="mt-2 rounded-[var(--radius-control)] bg-danger-500/8 px-3 py-2 text-xs font-medium text-danger-600">{error}</p>
      ) : null}
      <div className="mt-2 flex flex-wrap items-center justify-between gap-2">
        <p className="text-xs text-text-faint">
          {picked.length > 0 ? `${resolveMentions(text, picked, members).length} kişiye bildirim gidecek` : "Ctrl + Enter ile kaydedin"}
        </p>
        <Button size="sm" icon={Send} loading={saving} onClick={submit} disabled={!text.trim()}>
          Notu kaydet
        </Button>
      </div>
    </div>
  );
}
