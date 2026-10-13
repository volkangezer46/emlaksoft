"use client";

import { useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { ArrowDownLeft, ArrowUpRight, CalendarClock, Link2, Loader2, Search } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Dialog, DialogBody, DialogContent, DialogFooter, DialogHeader } from "@/components/ui/dialog";
import { useToast } from "@/components/app/toast-provider";
import { linkFinanceAttachment, searchFinanceLinkTargets, type LinkTarget } from "@/app/actions/expense-receipts";
import { cn } from "@/lib/utils";

/**
 * Fiş kutusundaki eki bir harekete ya da açık kaleme bağlama penceresi (FN5). Bağlanınca ek kutudan çıkar ve
 * Hareketler'deki ek sayısı artar (finance_attachment_link RPC; sayfa yenilenir).
 */

const money = (n: number) => new Intl.NumberFormat("tr-TR", { style: "currency", currency: "TRY", maximumFractionDigits: 2 }).format(n);
const dateTr = (iso: string | null) => {
  if (!iso) return "";
  const [y, m, d] = iso.slice(0, 10).split("-");
  return y && m && d ? `${d}.${m}.${y}` : iso;
};
const isIn = (dir: string) => dir === "in" || dir === "receivable";

export function LinkAttachmentButton({ id, name }: { id: string; name: string }) {
  const router = useRouter();
  const { push } = useToast();
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState("");
  const [items, setItems] = useState<LinkTarget[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [selected, setSelected] = useState<string | null>(null);
  const [saving, startSave] = useTransition();
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const seq = useRef(0);

  async function search(text: string) {
    const mine = ++seq.current;
    setLoading(true);
    const res = await searchFinanceLinkTargets(text);
    if (mine !== seq.current) return;
    setLoading(false);
    if (res.ok) {
      setItems(res.items);
      setError(null);
    } else {
      setItems([]);
      setError(res.error);
    }
  }

  function onOpenChange(next: boolean) {
    setOpen(next);
    if (next) {
      setQ("");
      setSelected(null);
      void search("");
    }
  }

  function onQuery(text: string) {
    setQ(text);
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => void search(text), 250);
  }

  const chosen = items?.find((t) => `${t.kind}:${t.id}` === selected) ?? null;

  function save() {
    if (!chosen) return;
    startSave(async () => {
      const res = await linkFinanceAttachment({
        id,
        entryId: chosen.kind === "entry" ? chosen.id : null,
        openItemId: chosen.kind === "open_item" ? chosen.id : null,
      });
      if (!res.ok) {
        push(res.error, "err");
        return;
      }
      push(chosen.kind === "entry" ? "Belge harekete bağlandı." : "Belge açık kaleme bağlandı.", "ok");
      setOpen(false);
      router.refresh();
    });
  }

  const entries = items?.filter((t) => t.kind === "entry") ?? [];
  const openItems = items?.filter((t) => t.kind === "open_item") ?? [];

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <Button type="button" size="sm" variant="secondary" icon={Link2} onClick={() => onOpenChange(true)} className="touch:h-11">
        Bağla
      </Button>
      <DialogContent size="md">
        <DialogHeader title="Belgeyi bağla" description={name} />
        <DialogBody className="space-y-3">
          <label className="relative block">
            <span className="sr-only">Hareket ya da açık kalem ara</span>
            <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-text-faint" aria-hidden="true" />
            <Input value={q} onChange={(e) => onQuery(e.target.value)} placeholder="Başlık ya da karşı taraf ara" className="pl-9" autoFocus />
          </label>
          {error ? (
            <p role="alert" className="text-sm font-semibold text-danger-600">{error}</p>
          ) : items === null || (loading && items.length === 0) ? (
            <div className="grid h-40 place-items-center text-text-muted">
              <Loader2 className="h-5 w-5 animate-spin" aria-hidden="true" />
            </div>
          ) : items.length === 0 ? (
            <p className="py-8 text-center text-sm text-text-muted">Eşleşen hareket ya da açık kalem yok.</p>
          ) : (
            <div className={cn("max-h-[50dvh] space-y-3 overflow-y-auto pr-1 transition-opacity", loading && "opacity-60")} role="radiogroup" aria-label="Bağlanacak kayıt">
              {entries.length > 0 ? <Group title="Hareketler" items={entries} selected={selected} onSelect={setSelected} /> : null}
              {openItems.length > 0 ? <Group title="Açık kalemler (vadeli)" items={openItems} selected={selected} onSelect={setSelected} /> : null}
            </div>
          )}
        </DialogBody>
        <DialogFooter>
          <Button type="button" variant="ghost" onClick={() => setOpen(false)}>
            Vazgeç
          </Button>
          <Button type="button" icon={Link2} loading={saving} disabled={!chosen} onClick={save}>
            Bağla
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function Group({ title, items, selected, onSelect }: { title: string; items: LinkTarget[]; selected: string | null; onSelect: (key: string) => void }) {
  return (
    <div>
      <p className="mb-1 text-xs font-semibold uppercase tracking-wide text-text-faint">{title}</p>
      <ul className="space-y-1">
        {items.map((t) => {
          const key = `${t.kind}:${t.id}`;
          const active = key === selected;
          const incoming = isIn(t.direction);
          return (
            <li key={key}>
              <button
                type="button"
                role="radio"
                aria-checked={active}
                onClick={() => onSelect(key)}
                className={cn(
                  "focus-ring press flex min-h-11 w-full items-center gap-3 rounded-[var(--radius-control)] border px-3 py-2 text-left text-xs transition",
                  active ? "border-brand-500 bg-brand-500/8" : "border-line bg-surface hover:bg-surface-hover",
                )}
              >
                <span className={cn("grid h-7 w-7 shrink-0 place-items-center rounded-full", incoming ? "tone-success" : "tone-danger")}>
                  {t.kind === "open_item" ? <CalendarClock className="h-3.5 w-3.5" aria-hidden="true" /> : incoming ? <ArrowDownLeft className="h-3.5 w-3.5" aria-hidden="true" /> : <ArrowUpRight className="h-3.5 w-3.5" aria-hidden="true" />}
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block truncate font-semibold text-ink-950">{t.title}</span>
                  <span className="block truncate text-text-muted">
                    {[t.party, t.kind === "open_item" ? (t.date ? `Vade ${dateTr(t.date)}` : null) : dateTr(t.date)].filter(Boolean).join(" · ")}
                  </span>
                </span>
                <span className={cn("numeric shrink-0 font-semibold", incoming ? "text-success-600" : "text-ink-950")}>{money(t.amount)}</span>
              </button>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
