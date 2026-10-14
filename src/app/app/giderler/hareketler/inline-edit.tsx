"use client";

import { useRef, useState } from "react";
import { Check, Lock, NotebookPen, UserRound } from "lucide-react";
import { updateEntryV2 } from "@/app/actions/finance-ledger";
import { useToast } from "@/components/app/toast-provider";
import { Button } from "@/components/ui/button";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { cn } from "@/lib/utils";
import { PartyPicker } from "../cari/party-picker";

/**
 * Hareketler satır içi düzenleme (kategori, not, cari). Değişiklik sayfa yeniden yüklenmeden `updateEntryV2` ile kaydedilir:
 * önce ekranda güncellenir, hata gelirse eski değere döner ve neden bildirimle söylenir. Kilitli dönemde (ay kapanışı)
 * düzenleme kapalıdır; neden kilit simgesinin ipucunda ve ekran okuyucu metninde yazar.
 */

export type CategoryOption = { value: string; label: string };

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Kilit nedeni rozeti: düzenleme kapalıyken neden görünür kalır (yalnız ipucu değil). */
export function LockedReason({ reason }: { reason: string }) {
  return (
    <span className="inline-flex items-center gap-1 text-xs text-text-faint" title={reason}>
      <Lock className="h-3 w-3" aria-hidden="true" />
      <span className="sr-only">{reason}</span>
      <span aria-hidden="true">Kilitli</span>
    </span>
  );
}

function SavedTick({ show }: { show: boolean }) {
  return show ? <Check className="motion-enter h-3.5 w-3.5 shrink-0 text-success-strong" aria-label="Kaydedildi" /> : null;
}

/** Kategori: yerel select (klavye, ekran okuyucu ve mobil seçici bedava). */
export function InlineCategory({
  entryId,
  value,
  options,
  disabledReason,
  label,
}: {
  entryId: string;
  value: string | null;
  options: readonly CategoryOption[];
  disabledReason?: string | null;
  label: string;
}) {
  const { push } = useToast();
  const [current, setCurrent] = useState(value ?? "");
  const [busy, setBusy] = useState(false);
  const [saved, setSaved] = useState(false);
  // Sunucu yeniden çizince (revalidate) gelen değer benimsenir ("adjust state during render").
  const [prevValue, setPrevValue] = useState(value);
  if (prevValue !== value) {
    setPrevValue(value);
    setCurrent(value ?? "");
  }
  const known = options.some((o) => o.value === current);

  if (disabledReason) {
    return (
      <span className="inline-flex items-center gap-1.5">
        <span className="text-text-muted">{options.find((o) => o.value === current)?.label ?? (current || "—")}</span>
        <LockedReason reason={disabledReason} />
      </span>
    );
  }

  async function change(next: string) {
    const prev = current;
    if (!next || next === prev) return;
    setCurrent(next);
    setSaved(false);
    setBusy(true);
    const res = await updateEntryV2(entryId, { category: next });
    setBusy(false);
    if (!res.ok) {
      setCurrent(prev);
      push(res.error, "err");
      return;
    }
    setSaved(true);
  }

  return (
    <span className="inline-flex items-center gap-1">
      <select
        value={current}
        disabled={busy}
        data-inline-edit=""
        aria-label={`${label}: kategori`}
        onChange={(e) => void change(e.target.value)}
        className={cn(
          "h-8 max-w-[11rem] truncate rounded-[var(--radius-control)] border border-transparent bg-transparent px-1.5 text-xs font-medium text-text transition touch:h-11",
          "hover:border-line hover:bg-surface focus:border-brand-400 focus:bg-surface focus:outline-none",
          busy && "opacity-60",
        )}
      >
        {!known ? <option value={current}>{current || "Kategori seçin"}</option> : null}
        {options.map((o) => (
          <option key={o.value} value={o.value}>{o.label}</option>
        ))}
      </select>
      <SavedTick show={saved} />
    </span>
  );
}

/** Not: tıkla -> yaz -> Enter / odak kaybı kaydeder, Esc vazgeçer. */
export function InlineNote({ entryId, value, disabledReason, label }: { entryId: string; value: string | null; disabledReason?: string | null; label: string }) {
  const { push } = useToast();
  const [current, setCurrent] = useState(value ?? "");
  const [prevValue, setPrevValue] = useState(value);
  if (prevValue !== value) {
    setPrevValue(value);
    setCurrent(value ?? "");
  }
  const [editing, setEditing] = useState(false);
  const [saved, setSaved] = useState(false);
  const committing = useRef(false);

  if (disabledReason) return current ? <span className="text-xs text-text-muted">{current}</span> : null;

  async function commit(next: string) {
    if (committing.current) return;
    setEditing(false);
    const prev = current;
    const text = next.trim().slice(0, 1000);
    if (text === prev) return;
    committing.current = true;
    setCurrent(text);
    setSaved(false);
    const res = await updateEntryV2(entryId, { note: text || null });
    committing.current = false;
    if (!res.ok) {
      setCurrent(prev);
      push(res.error, "err");
      return;
    }
    setSaved(true);
  }

  if (editing) {
    return (
      <input
        autoFocus
        defaultValue={current}
        maxLength={1000}
        aria-label={`${label}: not`}
        placeholder="Not yazın, Enter ile kaydedin"
        onKeyDown={(e) => {
          if (e.key === "Enter") {
            e.preventDefault();
            void commit(e.currentTarget.value);
          } else if (e.key === "Escape") {
            e.preventDefault();
            setEditing(false);
          }
        }}
        onBlur={(e) => void commit(e.currentTarget.value)}
        className="h-8 w-full min-w-40 rounded-[var(--radius-control)] border border-brand-400 bg-surface px-2 text-xs text-text focus:outline-none touch:h-11"
      />
    );
  }
  return (
    <span className="inline-flex min-w-0 items-center gap-1">
      <Button
        variant="ghost"
        size="xs"
        icon={NotebookPen}
        onClick={() => setEditing(true)}
        aria-label={current ? `${label}: notu düzenle` : `${label}: not ekle`}
        className="min-w-0 max-w-full justify-start px-1 font-normal"
      >
        <span className="truncate">{current || "Not ekle"}</span>
      </Button>
      <SavedTick show={saved} />
    </span>
  );
}

/**
 * Cari: açılır kutuda PartyPicker (FN4). Seçilen kayıt kimliği `partyId`, yeni yazılan ad `partyName` olarak gider
 * (RPC yoksa oluşturur). Ad ekranda hemen değişir; hata olursa eski ada döner.
 */
export function InlineParty({
  entryId,
  partyName,
  direction,
  disabledReason,
  label,
}: {
  entryId: string;
  partyName: string | null;
  direction: "in" | "out";
  disabledReason?: string | null;
  label: string;
}) {
  const { push } = useToast();
  const [current, setCurrent] = useState(partyName ?? "");
  const [prevName, setPrevName] = useState(partyName);
  if (prevName !== partyName) {
    setPrevName(partyName);
    setCurrent(partyName ?? "");
  }
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [saved, setSaved] = useState(false);
  const [picked, setPicked] = useState("");

  if (disabledReason) return current ? <span className="text-xs text-text-muted">{current}</span> : null;

  async function submit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const fd = new FormData(e.currentTarget);
    const patch = partyPatchOf(fd.get("party"));
    if (!patch) return push("Bir cari seçin ya da adını yazın.", "err");
    const prev = current;
    setBusy(true);
    setSaved(false);
    setCurrent("partyName" in patch ? patch.partyName : picked || prev);
    const res = await updateEntryV2(entryId, patch);
    setBusy(false);
    if (!res.ok) {
      setCurrent(prev);
      push(res.error, "err");
      return;
    }
    setOpen(false);
    setSaved(true);
  }

  return (
    <span className="inline-flex min-w-0 items-center gap-1">
      <Popover open={open} onOpenChange={setOpen}>
        <PopoverTrigger asChild>
          <Button
            variant="ghost"
            size="xs"
            icon={UserRound}
            aria-label={current ? `${label}: cariyi değiştir (${current})` : `${label}: cari ata`}
            className="min-w-0 max-w-full justify-start px-1 font-normal"
          >
            <span className="truncate">{current || "Cari ata"}</span>
          </Button>
        </PopoverTrigger>
        <PopoverContent align="start" className="w-80 p-3">
          <form onSubmit={submit} className="grid gap-2">
            <p className="text-xs font-semibold text-text">Cari (kişi / firma)</p>
            <PartyPicker name="party" kindHint={direction === "in" ? "musteri" : "tedarikci"} allowCreate onValueChange={(p) => setPicked(p?.name ?? "")} aria-label={`${label}: cari`} />
            <div className="flex justify-end gap-2">
              <Button variant="ghost" size="sm" onClick={() => setOpen(false)}>Vazgeç</Button>
              <Button type="submit" variant="primary" size="sm" loading={busy}>Kaydet</Button>
            </div>
          </form>
        </PopoverContent>
      </Popover>
      <SavedTick show={saved} />
    </span>
  );
}

/** PartyPicker form değerinden yama: kimlik -> partyId, serbest ad -> partyName (RPC oluşturur). */
export function partyPatchOf(raw: FormDataEntryValue | null): { partyId: string } | { partyName: string } | null {
  const v = typeof raw === "string" ? raw.trim() : "";
  if (UUID_RE.test(v)) return { partyId: v };
  const name = v.slice(0, 120);
  return name ? { partyName: name } : null;
}
