"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import { Sparkles, X } from "lucide-react";
import Link from "@/components/ui/smart-link";
import { openWhatsNew, type WhatsNewEntry } from "@/app/actions/office-broadcast";
import { Dialog, DialogClose, DialogDescription, DialogDrawerContent, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { WhatsNewButton } from "./whats-new";

const CATEGORY: Record<string, { label: string; cls: string }> = {
  yeni: { label: "Yeni", cls: "bg-mint-500/15 text-mint-600" },
  iyilestirme: { label: "İyileştirme", cls: "bg-brand-600/15 text-brand-600" },
  duzeltme: { label: "Düzeltme", cls: "bg-amber-400/15 text-amber-700" },
};

const dateFmt = new Intl.DateTimeFormat("tr-TR", { day: "numeric", month: "long", year: "numeric", timeZone: "Europe/Istanbul" });

/**
 * "Yenilikler" çekmecesi (AD8) — tembel parça. Kabuk (`whats-new.tsx`) düğmeyi ve okunmamış sayıyı taşır; bu parça
 * ilk tıkta (ya da boşta önceden) iner, AÇIK başlar ve girdileri yükler; "son görülme" sunucuda şimdiye çekilir.
 * Sonraki açılışlarda da aynı akış: rozet anında söner, girdiler tazelenir.
 */
export function WhatsNewPanel({
  unread,
  setUnread,
  openSignal = 0,
  className,
}: {
  unread: number;
  setUnread: (n: number) => void;
  /** Avatar menüsünden açma sinyali (artınca çekmece açılır; ilk bağlanışta zaten açık). */
  openSignal?: number;
  className?: string;
}) {
  const [open, setOpen] = useState(true);
  const [entries, setEntries] = useState<WhatsNewEntry[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();

  const load = () =>
    start(async () => {
      const r = await openWhatsNew();
      setEntries(r.entries);
      setError(r.error ?? null);
    });

  // Parça ilk tıkta açık bağlanır: ilk yüklemeyi başlat (kabuk rozeti tıkta zaten söndürdü).
  useEffect(() => {
    load();
  }, []);

  const onOpenChange = (v: boolean) => {
    setOpen(v);
    if (!v) return;
    setUnread(0);
    load();
  };

  // Avatar menüsünden açma: yalnız sinyal değişince (ilk bağlanışta çekmece zaten açık ve yükleniyor).
  const seenSignal = useRef(openSignal);
  useEffect(() => {
    if (openSignal === seenSignal.current) return;
    seenSignal.current = openSignal;
    onOpenChange(true);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- yalnız sinyal artışı tetikler; onOpenChange her render'da yeni
  }, [openSignal]);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogTrigger asChild>
        <WhatsNewButton unread={unread} className={className} />
      </DialogTrigger>
      <DialogDrawerContent responsiveClassName="" className="left-auto right-0 flex w-[min(92vw,420px)] flex-col border-l border-line bg-surface">
          <div className="flex items-center justify-between border-b border-line px-5 py-4">
            <DialogTitle className="flex items-center gap-2 font-display text-base font-bold text-ink-950">
              <Sparkles className="h-4 w-4 text-brand-600" aria-hidden /> Yenilikler
            </DialogTitle>
            <DialogClose aria-label="Kapat" className="focus-ring grid h-9 w-9 place-items-center rounded-full text-text-muted hover:bg-ink-950/5 touch:min-h-11 touch:min-w-11">
              <X className="h-4 w-4" aria-hidden />
            </DialogClose>
          </div>
          <DialogDescription className="sr-only">EmlakSoft&apos;a eklenen yeni özellikler, iyileştirmeler ve düzeltmeler.</DialogDescription>
          <div className="flex-1 overflow-y-auto overscroll-contain px-5 py-4">
            {error ? (
              <p role="alert" className="text-sm font-semibold text-danger-600">{error}</p>
            ) : entries === null || (pending && entries.length === 0) ? (
              <div className="space-y-3" aria-hidden>
                {Array.from({ length: 4 }).map((_, i) => (
                  <div key={i} className="h-16 animate-pulse rounded-[var(--radius-card)] bg-ink-950/8" />
                ))}
              </div>
            ) : entries.length === 0 ? (
              <p className="py-10 text-center text-sm text-text-muted">Henüz yenilik yayınlanmadı. Yeni özellikler burada duyurulacak.</p>
            ) : (
              <ol className="space-y-4">
                {entries.map((e) => (
                  <li key={e.id} className="rounded-[var(--radius-card)] border border-line p-3">
                    <div className="flex flex-wrap items-center gap-2 text-xs">
                      <span className={`rounded-full px-2 py-0.5 font-bold ${CATEGORY[e.category]?.cls ?? "bg-canvas text-text-muted"}`}>{CATEGORY[e.category]?.label ?? e.category}</span>
                      <span className="text-text-faint">{dateFmt.format(new Date(e.published_at))}</span>
                      {e.unread ? <span className="h-1.5 w-1.5 rounded-full bg-brand-600" aria-label="okunmamış" /> : null}
                    </div>
                    <p className="mt-1.5 text-sm font-semibold text-ink-950">{e.title}</p>
                    {e.body ? <p className="mt-1 whitespace-pre-line text-sm text-text-muted">{e.body}</p> : null}
                    {e.href ? (
                      <Link href={e.href} onClick={() => setOpen(false)} className="mt-2 inline-flex min-h-9 touch:min-h-11 items-center text-sm font-semibold text-brand-600 hover:underline">
                        Göz at →
                      </Link>
                    ) : null}
                  </li>
                ))}
              </ol>
            )}
          </div>
      </DialogDrawerContent>
    </Dialog>
  );
}
