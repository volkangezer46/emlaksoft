"use client";

import Link from "next/link";
import { useState, useSyncExternalStore } from "react";
import { Sparkles, X } from "lucide-react";
import { RealUsePanel, type RealUseRow } from "@/components/app/real-use-panel";

export type DemoBannerVariant = "demo" | "mixed" | "switch";

const COPY: Record<DemoBannerVariant, { title: string; text: string }> = {
  demo: {
    title: "Örnek veri modundasınız",
    text: "Ofis örnek verilerle dolu: her kaydı düzenleyebilir, silebilir, her ekranı deneyebilirsiniz. Hazır olunca gerçek kullanıma başlayın.",
  },
  mixed: {
    title: "Gerçek kayıtlarınızı girmeye başladınız",
    text: "Örnek veriler hâlâ listelerde duruyor ve rakamlara karışabilir. Alıştıysanız tek tuşla temizleyin.",
  },
  switch: {
    title: "Örnek verileri kaldırma zamanı",
    text: "Gerçek verileriniz yeterli; rapor ve liglerde örnekler artık dışlanıyor ama listelerde görünmeye devam ediyor. Temizleyerek ofisi netleştirin.",
  },
};

/** Bantta tek tek adı yazılan kilitli sayfa sayısı; kalanı sayı olarak söylenir. */
const LOCK_PREVIEW = 5;

const keyOf = (variant: DemoBannerVariant) => `emlaksoft:demo-banner-dismissed:${variant}`;

/** localStorage okuması try/catch içinde; kapalıysa bant gösterilir (kapatma yalnız bu oturumda geçerli). */
function readDismissed(variant: DemoBannerVariant): boolean {
  try {
    return window.localStorage.getItem(keyOf(variant)) === "1";
  } catch {
    return false;
  }
}

const listeners = new Set<() => void>();
function subscribe(cb: () => void) {
  listeners.add(cb);
  return () => listeners.delete(cb);
}

/**
 * Ust seritte "Demo modundasiniz — gercek kullanima basla" bandi. Kapatilabilir (varyant bazli: gercek veri
 * girilince oneri degisir ve bant yeniden gorunur). "Gercek kullanima basla" satir ici onay panelini acar.
 */
export function DemoModeBanner({
  variant,
  rows,
  total,
  canClear,
  trialDaysLeft = null,
  lockedAfterTrial = [],
}: {
  variant: DemoBannerVariant;
  rows: RealUseRow[];
  total: number;
  canClear: boolean;
  /** Deneme aboneliğinde kalan gün (sunucuda subscriptions.trial_ends_at'tan); deneme değilse null. */
  trialDaysLeft?: number | null;
  /** Deneme sonrası paketinize göre kilitlenecek sayfalar (page-gates.ts'ten sunucuda üretilir). */
  lockedAfterTrial?: { title: string; href: string }[];
}) {
  const [sessionHidden, setSessionHidden] = useState(false);
  const dismissed = useSyncExternalStore(
    subscribe,
    () => readDismissed(variant),
    () => false,
  );
  const [expanded, setExpanded] = useState(false);
  if (dismissed || sessionHidden) return null;
  const copy = COPY[variant];

  function dismiss() {
    setSessionHidden(true);
    try {
      window.localStorage.setItem(keyOf(variant), "1");
    } catch {
      /* depolama kapalı: yalnız bu oturumda gizlenir */
    }
    listeners.forEach((l) => l());
  }

  return (
    <section
      aria-label="Örnek veri modu"
      className="rounded-[var(--radius-card)] border border-amber-400/40 bg-amber-400/[0.08] px-4 py-3"
      data-tour="demo-bandi"
    >
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="flex min-w-0 flex-1 items-start gap-2.5">
          <Sparkles className="mt-0.5 h-4 w-4 shrink-0 text-amber-600" aria-hidden />
          <div className="min-w-0">
            <p className="text-sm font-bold text-amber-800">{copy.title}</p>
            <p className="mt-0.5 text-xs leading-relaxed text-amber-800/80">{copy.text}</p>
            {trialDaysLeft != null ? (
              <p className="mt-1 text-xs font-semibold text-amber-900">
                {trialDaysLeft > 0 ? `Denemenizin bitmesine ${trialDaysLeft} gün kaldı.` : "Deneme süreniz doldu."}{" "}
                <Link href="/app/abonelik" className="underline underline-offset-2 hover:no-underline">
                  Ücretli plana geç
                </Link>
              </p>
            ) : null}
            {trialDaysLeft != null && lockedAfterTrial.length > 0 ? (
              <p className="mt-1 text-xs leading-relaxed text-amber-900/90">
                Denemeden sonra paketinize göre kilitlenecek sayfalar:{" "}
                {lockedAfterTrial.slice(0, LOCK_PREVIEW).map((g, i) => (
                  <span key={g.href}>
                    {i > 0 ? ", " : ""}
                    <Link href={g.href} className="underline underline-offset-2 hover:no-underline">
                      {g.title}
                    </Link>
                  </span>
                ))}
                {lockedAfterTrial.length > LOCK_PREVIEW ? ` ve ${lockedAfterTrial.length - LOCK_PREVIEW} sayfa daha` : ""}.{" "}
                <Link href="/app/abonelik" className="font-semibold underline underline-offset-2 hover:no-underline">
                  Paketleri karşılaştır
                </Link>
              </p>
            ) : null}
          </div>
        </div>
        <div className="flex shrink-0 items-center gap-2">
          {!expanded ? (
            <button
              type="button"
              onClick={() => setExpanded(true)}
              className="focus-ring press min-h-9 rounded-[var(--radius-control)] border border-amber-400/50 bg-amber-400/15 px-3 py-1.5 text-xs font-bold text-amber-800 transition hover:bg-amber-400/25"
            >
              Gerçek kullanıma başla
            </button>
          ) : null}
          <button
            type="button"
            onClick={dismiss}
            aria-label="Bandı kapat"
            className="focus-ring grid h-9 w-9 place-items-center rounded-[var(--radius-control)] text-amber-800/70 transition hover:bg-amber-400/15 hover:text-amber-900"
          >
            <X className="h-4 w-4" aria-hidden />
          </button>
        </div>
      </div>
      {expanded ? (
        <div className="mt-3">
          <RealUsePanel rows={rows} total={total} canClear={canClear} defaultOpen />
        </div>
      ) : null}
    </section>
  );
}
