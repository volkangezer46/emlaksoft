"use client";

import { useState } from "react";
import { Eye, ExternalLink, FileText, Loader2 } from "lucide-react";
import { Button, buttonClass } from "@/components/ui/button";
import { Dialog, DialogBody, DialogContent, DialogFooter, DialogHeader } from "@/components/ui/dialog";
import { financeAttachmentPreview, type AttachmentPreview } from "@/app/actions/expense-receipts";

/**
 * Belge önizleme (FN5): açılınca sunucudan 2 dakikalık GEÇİCİ imzalı bağlantı istenir (yol kendi ofis önekiyle
 * doğrulanır). Görsel pencerede, PDF yeni sekmede açılır. Bağlantı saklanmaz; her açılışta yenisi alınır.
 */
export function AttachmentPreviewButton({ id, name, label = "Önizle" }: { id: string; name: string; label?: string }) {
  const [open, setOpen] = useState(false);
  const [state, setState] = useState<AttachmentPreview | null>(null);
  const [loading, setLoading] = useState(false);

  async function load() {
    setLoading(true);
    setState(null);
    const res = await financeAttachmentPreview(id);
    setState(res);
    setLoading(false);
  }

  function onOpenChange(next: boolean) {
    setOpen(next);
    if (next) void load();
    else setState(null);
  }

  const isImage = state?.ok && state.type.startsWith("image/");

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <Button type="button" size="sm" variant="ghost" icon={Eye} onClick={() => onOpenChange(true)} className="touch:h-11" aria-label={`${name} önizle`}>
        {label}
      </Button>
      <DialogContent size="lg">
        <DialogHeader title={name} description="Belge önizlemesi" />
        <DialogBody>
          {loading ? (
            <div className="grid h-64 place-items-center text-text-muted">
              <Loader2 className="h-6 w-6 animate-spin" aria-hidden="true" />
              <span className="sr-only">Önizleme hazırlanıyor</span>
            </div>
          ) : state && !state.ok ? (
            <p role="alert" className="rounded-[var(--radius-card)] border border-danger-400/40 bg-danger-500/8 px-4 py-3 text-sm font-semibold text-danger-600">
              {state.error}
            </p>
          ) : state?.ok && isImage ? (
            <div className="flex max-h-[70dvh] justify-center overflow-auto rounded-[var(--radius-card)] bg-surface-sunken p-2">
              {/* eslint-disable-next-line @next/next/no-img-element -- özel kova, geçici imzalı bağlantı (next/image önbelleğe almamalı) */}
              <img src={state.url} alt={name} className="h-auto max-w-full rounded object-contain" referrerPolicy="no-referrer" />
            </div>
          ) : state?.ok ? (
            <div className="flex flex-col items-center gap-3 py-10 text-center">
              <FileText className="h-10 w-10 text-text-faint" aria-hidden="true" />
              <p className="text-sm text-text-muted">PDF belgesi yeni sekmede açılır.</p>
            </div>
          ) : null}
          {state?.ok ? <p className="mt-2 text-xs text-text-faint">Bağlantı güvenlik için 2 dakika geçerlidir.</p> : null}
        </DialogBody>
        <DialogFooter>
          {state?.ok ? (
            <a href={state.url} target="_blank" rel="noopener noreferrer" referrerPolicy="no-referrer" className={buttonClass({ variant: "secondary" })}>
              <ExternalLink className="h-4 w-4" aria-hidden="true" />
              Yeni sekmede aç
            </a>
          ) : null}
          <Button type="button" variant="ghost" onClick={() => onOpenChange(false)}>
            Kapat
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
