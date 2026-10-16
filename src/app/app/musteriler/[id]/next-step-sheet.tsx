"use client";

import { useEffect, useRef, useState } from "react";
import { usePathname, useRouter } from "next/navigation";
import Link from "@/components/ui/smart-link";
import { Building2, CalendarDays, CheckCircle2, PhoneCall, Search } from "lucide-react";
import { CallOutcomeTarget } from "@/components/app/call-outcome";
import { Button } from "@/components/ui/button";

const STEP =
  "focus-ring press flex min-h-14 w-full items-center gap-3 rounded-[var(--radius-control)] border border-line bg-surface px-4 text-left text-base font-semibold text-ink-950 transition hover:bg-surface-hover";

/**
 * Yeni müşteri kaydından sonra açılan "Sonraki adım" sayfası (C11): Şimdi ara · Randevu ver · Ne arıyor? (talep).
 * Mülk sahibi/satıcıda "Ne arıyor?" yerine "portföy ekle" gelir. "Sonra" ve "Şimdi ara" kapatırken `?yeni=1`
 * adresten silinir (yenileme sayfayı yeniden açmaz). "Şimdi ara" arama sonucu şeridini de açar.
 */
export function NextStepSheet({
  customerId,
  name,
  phone,
  telHref,
  appointmentHref,
  demandHref,
  propertyHref,
}: {
  customerId: string;
  name: string;
  phone: string | null;
  telHref: string | null;
  /** Yetki yoksa null (düğme çizilmez). */
  appointmentHref: string | null;
  demandHref: string | null;
  propertyHref: string | null;
}) {
  const router = useRouter();
  const pathname = usePathname();
  const [open, setOpen] = useState(true);
  const firstRef = useRef<HTMLElement | null>(null);

  useEffect(() => {
    firstRef.current?.focus();
  }, []);

  function close() {
    setOpen(false);
    router.replace(pathname, { scroll: false });
  }

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") close();
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
    // close yalnız router/pathname'e bağlı; açık kaldıkça bir kez bağlanır.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  if (!open) return null;
  const first = name.trim().split(/\s+/)[0] || name;

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-ink-950/45 sm:items-center" onClick={close}>
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="sonraki-adim-baslik"
        data-next-step-sheet=""
        onClick={(e) => e.stopPropagation()}
        className="w-full max-w-md rounded-t-[var(--radius-panel)] bg-surface p-4 pb-[calc(1rem+env(safe-area-inset-bottom,0px))] shadow-[var(--shadow-lg)] sm:rounded-[var(--radius-panel)]"
      >
        <p className="flex items-center gap-2 text-sm font-semibold text-mint-700">
          <CheckCircle2 className="h-4 w-4" aria-hidden /> {name} kaydedildi
        </p>
        <h2 id="sonraki-adim-baslik" className="mt-1 font-display text-xl font-bold text-ink-950">
          Şimdi ne yapmak istersiniz?
        </h2>
        <div className="mt-4 grid gap-2">
          {telHref ? (
            <CallOutcomeTarget customerId={customerId} name={name} phone={phone} className="contents">
              <a
                ref={(el) => {
                  firstRef.current ??= el;
                }}
                href={telHref}
                onClick={close}
                className={`${STEP} border-transparent bg-brand-600 text-white hover:bg-brand-700`}
              >
                <PhoneCall className="h-5 w-5" aria-hidden /> Şimdi ara
              </a>
            </CallOutcomeTarget>
          ) : null}
          {appointmentHref ? (
            <Link href={appointmentHref} className={STEP}>
              <CalendarDays className="h-5 w-5 text-brand-600" aria-hidden /> Randevu ver
            </Link>
          ) : null}
          {demandHref ? (
            <Link href={demandHref} className={STEP}>
              <Search className="h-5 w-5 text-brand-600" aria-hidden /> Ne arıyor? <span className="font-normal text-text-muted">(talep ekle)</span>
            </Link>
          ) : null}
          {propertyHref ? (
            <Link href={propertyHref} className={STEP}>
              <Building2 className="h-5 w-5 text-brand-600" aria-hidden /> {first} için portföy ekle
            </Link>
          ) : null}
          <Button
            type="button"
            variant="ghost"
            onClick={close}
            ref={(el) => {
              firstRef.current ??= el;
            }}
            className="mt-1 min-h-12 text-base"
          >
            Sonra
          </Button>
        </div>
      </div>
    </div>
  );
}
