"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { CalendarClock, Check, Loader2, Pencil, X } from "lucide-react";
import { setDealExpectedClose } from "@/app/actions/deal-forecast";
import { useToast } from "@/components/app/toast-provider";

function formatDay(key: string) {
  const [y, m, d] = key.split("-");
  return `${Number(d)}.${m}.${y}`;
}

/**
 * Beklenen kapanış tarihi — anlaşma hero'sunda satır içi düzenleme (SP1). Okuma: tarih + durum ("gecikti" kırmızı,
 * "7 gün içinde" amber). Düzenleme: tarih alanı + Kaydet / Temizle / Vazgeç (≥44 px dokunma hedefi). Yetkisizde salt okunur.
 */
export function ExpectedCloseField({
  dealId,
  value,
  status,
  canEdit,
}: {
  dealId: string;
  value: string | null;
  status: "gecikti" | "yakin" | "ileride" | null;
  canEdit: boolean;
}) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(value ?? "");
  const [pending, start] = useTransition();
  const { push } = useToast();
  const router = useRouter();

  const save = (next: string) =>
    start(async () => {
      const fd = new FormData();
      fd.set("deal_id", dealId);
      fd.set("expected_close_date", next);
      const res = await setDealExpectedClose(fd);
      if (res.error) {
        push(res.error, "err");
        return;
      }
      push(next ? "Beklenen kapanış kaydedildi" : "Beklenen kapanış temizlendi", "ok");
      setEditing(false);
      router.refresh();
    });

  const tone =
    status === "gecikti"
      ? "border-danger-400/60 bg-danger-500/30 text-white"
      : status === "yakin"
        ? "border-amber-300/60 bg-amber-400/25 text-white"
        : "border-white/25 bg-white/10 text-white/85";

  if (editing) {
    return (
      <form
        className="flex flex-wrap items-center gap-1.5"
        onSubmit={(e) => {
          e.preventDefault();
          save(draft);
        }}
      >
        <label className="sr-only" htmlFor={`kapanis-${dealId}`}>
          Beklenen kapanış tarihi
        </label>
        <input
          id={`kapanis-${dealId}`}
          type="date"
          lang="tr-TR"
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          className="min-h-9 rounded-[var(--radius-control)] border border-white/30 bg-white px-2 text-sm text-ink-950 touch:min-h-11 touch:text-base"
        />
        <button
          type="submit"
          disabled={pending}
          aria-label="Kaydet"
          className="focus-ring grid h-9 w-9 place-items-center rounded-[var(--radius-control)] bg-white text-ink-950 disabled:opacity-60 touch:h-11 touch:w-11"
        >
          {pending ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" /> : <Check className="h-4 w-4" aria-hidden="true" />}
        </button>
        {value ? (
          <button
            type="button"
            disabled={pending}
            onClick={() => save("")}
            className="focus-ring min-h-9 rounded-[var(--radius-control)] px-2 text-xs font-semibold text-white/80 hover:text-white touch:min-h-11"
          >
            Temizle
          </button>
        ) : null}
        <button
          type="button"
          aria-label="Vazgeç"
          onClick={() => {
            setDraft(value ?? "");
            setEditing(false);
          }}
          className="focus-ring grid h-9 w-9 place-items-center rounded-[var(--radius-control)] text-white/80 hover:text-white touch:h-11 touch:w-11"
        >
          <X className="h-4 w-4" aria-hidden="true" />
        </button>
      </form>
    );
  }

  const text = value
    ? `Beklenen kapanış ${formatDay(value)}${status === "gecikti" ? " · gecikti" : status === "yakin" ? " · yaklaşıyor" : ""}`
    : "Beklenen kapanış girilmedi";
  if (!canEdit) {
    return <span className={`inline-flex min-h-8 items-center gap-1.5 rounded-full border px-3 text-xs font-bold ${tone}`}><CalendarClock className="h-3.5 w-3.5" aria-hidden="true" /> {text}</span>;
  }
  return (
    <button
      type="button"
      onClick={() => setEditing(true)}
      className={`focus-ring inline-flex min-h-8 items-center gap-1.5 rounded-full border px-3 text-xs font-bold transition hover:bg-white/20 touch:min-h-11 ${tone}`}
      aria-label={`${text} — düzenle`}
    >
      <CalendarClock className="h-3.5 w-3.5" aria-hidden="true" /> {text}
      <Pencil className="h-3 w-3 opacity-70" aria-hidden="true" />
    </button>
  );
}
