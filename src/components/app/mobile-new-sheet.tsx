"use client";

import Link from "@/components/ui/smart-link";
import { X } from "lucide-react";
import { Dialog, DialogClose, DialogDescription, DialogSheetContent, DialogTitle } from "@/components/ui/dialog";
import { getAppActions, type PaletteEntry } from "@/lib/palette-core";
import type { AppModule } from "@/lib/permissions";

/**
 * Mobil alt çubuğun "+ Yeni" eylem sayfası: en sık kayıtlar tek dokunuşla (müşteri, ilan, talep, randevu, görev).
 * Liste rol izinlerine, paket kilidine ve kapalı modüle göre `getAppActions` ile süzülür (komut paleti ve üst çubuk
 * "Yeni" menüsüyle aynı kaynak); yetkisiz eylem görünmez. Hedefler ≥56 px yüksekliktedir.
 */
const SHEET_ACTIONS: readonly { href: string; label: string }[] = [
  { href: "/app/musteriler/yeni", label: "Yeni müşteri" },
  { href: "/app/portfoyler/yeni", label: "Yeni ilan" },
  { href: "/app/talepler/yeni", label: "Yeni talep" },
  { href: "/app/randevular/yeni", label: "Yeni randevu" },
  { href: "/app/gorevler/yeni", label: "Yeni görev" },
];

/** Çağrı merkezi için ilk eylem görüşme kaydıdır. */
const CALL_ACTION = { href: "/app/arama", label: "Görüşme kaydet" } as const;

/** Rolün "+ Yeni" sayfasındaki eylemleri (yetki, paket kilidi ve kapalı modül süzgeciyle). */
export function mobileNewActions(
  role: string | null | undefined,
  creatable: readonly AppModule[],
  locked: readonly string[],
  closed: readonly string[],
): PaletteEntry[] {
  const all = getAppActions(creatable, "", locked, closed);
  const wanted = role === "call_center" ? [CALL_ACTION, ...SHEET_ACTIONS] : SHEET_ACTIONS;
  return wanted.flatMap((w) => {
    const hit = all.find((a) => a.href === w.href);
    return hit ? [{ ...hit, label: w.label }] : [];
  });
}

export function MobileNewSheet({
  open,
  onOpenChange,
  actions,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  actions: readonly PaletteEntry[];
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogSheetContent aria-describedby="mobile-new-desc">
        <div className="flex items-center justify-between gap-3 px-5 pb-2 pt-4">
          <div className="min-w-0">
            <DialogTitle className="font-display text-lg font-bold text-ink-950">Ne eklemek istiyorsun?</DialogTitle>
            <DialogDescription id="mobile-new-desc" className="text-sm text-text-muted">
              Bir seçim yap, form açılsın.
            </DialogDescription>
          </div>
          <DialogClose
            className="focus-ring grid h-11 w-11 shrink-0 place-items-center rounded-[var(--radius-control)] text-text-muted hover:bg-surface-hover"
            aria-label="Kapat"
          >
            <X className="h-5 w-5" aria-hidden />
          </DialogClose>
        </div>
        <ul className="grid grid-cols-2 gap-2 px-4 pb-2">
          {actions.map((a) => (
            <li key={a.href}>
              <Link
                href={a.href}
                onClick={() => onOpenChange(false)}
                className="focus-ring press flex min-h-14 items-center gap-3 rounded-[var(--radius-card)] border border-line bg-canvas px-3 text-sm font-semibold text-ink-950 transition hover:border-brand-300 hover:bg-surface"
              >
                <span className="grid h-9 w-9 shrink-0 place-items-center rounded-[var(--radius-control)] bg-brand-600/10 text-brand-600">
                  <a.icon className="h-4 w-4" aria-hidden />
                </span>
                <span className="min-w-0 flex-1">{a.label}</span>
              </Link>
            </li>
          ))}
        </ul>
      </DialogSheetContent>
    </Dialog>
  );
}
