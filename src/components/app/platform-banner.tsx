"use client";

import { useState } from "react";
import { AlertTriangle, Info, Megaphone, OctagonAlert, X } from "lucide-react";
import Link from "@/components/ui/smart-link";
import { Button } from "@/components/ui/button";
import { Dialog, DialogBody, DialogContent, DialogFooter, DialogHeader } from "@/components/ui/dialog";
import { dismissPlatformBanner } from "@/app/actions/office-broadcast";

export type PlatformBannerItem = {
  id: string;
  title: string;
  body: string | null;
  level: "info" | "warning" | "critical";
  display: "banner" | "modal";
  dismissible: boolean;
  href: string | null;
};

const TONE = { info: "tone-info", warning: "tone-warning", critical: "tone-danger" } as const;
const ICON = { info: Info, warning: AlertTriangle, critical: OctagonAlert } as const;

/**
 * Platform banner'ı (AD8): EmlakSoft ekibinin ofis paneline duyurusu (bakım, kesinti, önemli değişiklik).
 * Hedef ofis ve tarih aralığı SUNUCUDA (RLS) süzülür; bu bileşen yalnız çizer. Kapatılabilir olan kalıcı kapanır
 * (kullanıcı başına kayıt, anında gizlenir); kapatılamaz şerit bitiş tarihine kadar kalır. Modal görünüm her sayfa
 * yüklemesinde bir kez açılır; kapatılamaz modal "Anladım" ile yalnız bu görünüm için kapanır.
 */
export function PlatformBanner({ items }: { items: PlatformBannerItem[] }) {
  const [hidden, setHidden] = useState<ReadonlySet<string>>(() => new Set());
  const visible = items.filter((b) => !hidden.has(b.id));
  const strips = visible.filter((b) => b.display === "banner");
  const modal = visible.find((b) => b.display === "modal") ?? null;

  const hide = (b: PlatformBannerItem) => {
    setHidden((prev) => new Set(prev).add(b.id));
    if (b.dismissible) void dismissPlatformBanner(b.id).catch(() => undefined);
  };

  return (
    <>
      {strips.map((b) => {
        const Icon = ICON[b.level] ?? Megaphone;
        return (
          <aside
            key={b.id}
            aria-label="EmlakSoft duyurusu"
            role={b.level === "critical" ? "alert" : undefined}
            className={`${TONE[b.level] ?? "tone-info"} flex flex-wrap items-center justify-center gap-x-3 gap-y-1 border-b border-line px-3 py-1.5 text-xs font-semibold`}
          >
            <span className="inline-flex min-w-0 items-center gap-1.5">
              <Icon className="h-3.5 w-3.5 shrink-0" aria-hidden />
              <span>{b.title}</span>
              {b.body ? <span className="hidden font-normal opacity-90 md:inline">— {b.body}</span> : null}
            </span>
            {b.href ? (
              <Link href={b.href} className="focus-ring rounded-[var(--radius-control)] underline underline-offset-2 hover:no-underline touch:min-h-11">
                Ayrıntı
              </Link>
            ) : null}
            {b.dismissible ? (
              <Button
                variant="ghost"
                size="icon"
                onClick={() => hide(b)}
                aria-label="Duyuruyu kapat"
                className="h-5 w-5 rounded-full text-current hover:bg-black/5 hover:text-current"
              >
                <X className="h-3 w-3" aria-hidden />
              </Button>
            ) : null}
          </aside>
        );
      })}
      {modal ? (
        <Dialog open onOpenChange={(open) => (open ? undefined : hide(modal))}>
          <DialogContent size="md">
            <DialogHeader icon={<Megaphone />} title={modal.title} description="EmlakSoft duyurusu" tone={modal.level === "critical" ? "danger" : "default"} />
            {modal.body ? (
              <DialogBody>
                <p className="whitespace-pre-line text-sm text-text-muted">{modal.body}</p>
              </DialogBody>
            ) : null}
            <DialogFooter>
              {modal.href ? (
                <Link href={modal.href} onClick={() => hide(modal)} className="focus-ring inline-flex min-h-11 items-center rounded-[var(--radius-control)] px-4 text-sm font-semibold text-brand-600 hover:underline">
                  Ayrıntı
                </Link>
              ) : null}
              <Button variant="navy" size="lg" onClick={() => hide(modal)} className="min-h-11 px-4 font-bold">
                {modal.dismissible ? "Kapat" : "Anladım"}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      ) : null}
    </>
  );
}
