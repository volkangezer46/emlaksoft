"use client";

import { Keyboard, X } from "lucide-react";
import { KbdCombo } from "@/components/ui/kbd";
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogHeader,
} from "@/components/ui/dialog";

/** Klavye kısayolları penceresi — ilk "?" basışına kadar yüklenmez (lazy gövde). */
export type KisayolSatiri = { tuslar: string; etiket: string };

export function KeyboardShortcutsDialog({
  open,
  onOpenChange,
  satirlar,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  satirlar: KisayolSatiri[];
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent size="sm">
        <DialogHeader
          icon={<Keyboard />}
          title="Klavye kısayolları"
          description="Yazma alanında değilken çalışır."
        />
        <div className="p-6">
          <dl className="space-y-1.5">
            {satirlar.map((k) => (
              <div
                key={k.tuslar}
                className="flex items-center justify-between gap-4 rounded-[var(--radius-control)] px-3 py-2 odd:bg-canvas"
              >
                <dt className="text-sm text-ink-950">{k.etiket}</dt>
                <dd className="shrink-0">
                  <KbdCombo keys={k.tuslar.split(" ")} className="numeric min-w-[22px]" />
                </dd>
              </div>
            ))}
          </dl>

          <p className="mt-4 text-xs leading-relaxed text-text-faint">
            <strong>g</strong> önekli iki tuşluk dizi bilinçli: tek harfli kısayol, bir nota ya da
            arama kutusuna yazarken odak kaybolduğunda sayfayı aniden değiştirip yazılanı
            kaybettirebilir.
          </p>

          <div className="hairline-t mt-4 flex justify-end pt-4">
            <DialogClose asChild>
              <button
                type="button"
                className="focus-ring press inline-flex items-center gap-1.5 rounded-[var(--radius-control)] border border-hairline px-4 py-2.5 text-sm font-medium text-ink-950 transition hover:bg-canvas"
              >
                <X className="h-4 w-4" /> Kapat
              </button>
            </DialogClose>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
