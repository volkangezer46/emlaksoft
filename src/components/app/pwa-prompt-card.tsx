"use client";

import { useEffect, useState, useTransition } from "react";
import { BellRing, Download, PlusSquare, Share, Smartphone, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useToast } from "@/components/app/toast-provider";
import { subscribeToPush } from "@/app/actions/notifications";
import { enablePush, PWA_KEYS, readNumber, readPushState, writeValue, type PushState } from "@/lib/push-client";
import { now } from "@/lib/clock";

export type InstallPromptEvent = Event & { prompt: () => Promise<void>; userChoice: Promise<{ outcome: "accepted" | "dismissed" }> };

/** iOS Safari: Paylaş → Ana Ekrana Ekle rehberi (3 adım). */
function IosInstallSteps() {
  const steps = [
    { icon: Share, text: "Safari'nin alt çubuğundaki Paylaş düğmesine dokunun." },
    { icon: PlusSquare, text: "Listeyi kaydırıp \"Ana Ekrana Ekle\"yi seçin." },
    { icon: Smartphone, text: "EmlakSoft'u ana ekrandan açın; anlık bildirimleri oradan açabilirsiniz." },
  ];
  return (
    <ol className="mt-3 space-y-2">
      {steps.map((s, i) => {
        const Icon = s.icon;
        return (
          <li key={s.text} className="flex items-start gap-2.5 text-sm text-text-muted">
            <span className="grid h-7 w-7 shrink-0 place-items-center rounded-full bg-brand-600/10 text-xs font-bold text-brand-600">{i + 1}</span>
            <Icon className="mt-1 h-4 w-4 shrink-0 text-ink-950" aria-hidden />
            <span className="pt-0.5">{s.text}</span>
          </li>
        );
      })}
    </ol>
  );
}

function CardShell({ floating, onClose, children }: { floating: boolean; onClose: () => void; children: React.ReactNode }) {
  return (
    <section
      aria-label="Uygulama önerisi"
      className={
        floating
          ? "surface-card motion-enter fixed inset-x-3 bottom-[calc(var(--mobile-nav-offset,0px)+0.75rem)] z-[70] rounded-[var(--radius-panel)] p-4 shadow-[var(--elev-4)] lg:inset-x-auto lg:bottom-4 lg:right-4 lg:w-[380px]"
          : "relative rounded-[var(--radius-panel)] border border-brand-500/25 bg-brand-600/[0.04] p-4"
      }
    >
      <Button variant="ghost" size="icon" onClick={onClose} aria-label="Şimdi değil" className="absolute right-2 top-2">
        <X className="h-4 w-4" />
      </Button>
      {children}
    </section>
  );
}

/** Ana ekranda yüzen kart: yükleme (beforeinstallprompt / iOS rehberi). */
export function InstallPromptCard({ deferred, ios, onClose }: { deferred: InstallPromptEvent | null; ios: boolean; onClose: (installed: boolean) => void }) {
  const [busy, setBusy] = useState(false);
  async function install() {
    if (!deferred) return;
    setBusy(true);
    try {
      await deferred.prompt();
      const choice = await deferred.userChoice;
      onClose(choice.outcome === "accepted");
    } catch {
      onClose(false);
    }
  }
  return (
    <CardShell floating onClose={() => onClose(false)}>
      <div className="flex items-start gap-3 pr-8">
        <span className="grid h-10 w-10 shrink-0 place-items-center rounded-[var(--radius-card)] bg-brand-600/10 text-brand-600">
          <Download className="h-5 w-5" aria-hidden />
        </span>
        <div className="min-w-0">
          <h2 className="text-sm font-bold text-ink-950">EmlakSoft&apos;u telefonunuza yükleyin</h2>
          <p className="mt-0.5 text-sm text-text-muted">Tek dokunuşla açılır, tam ekran çalışır; sahada bağlantı koparsa hızlı not alabilirsiniz.</p>
        </div>
      </div>
      {ios && !deferred ? (
        <IosInstallSteps />
      ) : (
        <div className="mt-3 flex gap-2">
          <Button onClick={install} loading={busy} icon={Download} className="flex-1">
            Uygulamayı yükle
          </Button>
          <Button variant="ghost" onClick={() => onClose(false)}>
            Şimdi değil
          </Button>
        </div>
      )}
    </CardShell>
  );
}

/**
 * Bağlam içi "anlık bildirimleri açın" kartı (MP1). İzin isteği yalnız düğmeye dokununca yapılır. `floating`: ana
 * ekranda yüzen kart; aksi halde sayfa içi (Bildirimler) kart. Push desteklenmiyorsa ya da zaten açıksa çizilmez.
 */
export function PushEnableCard({ floating = false, onClose }: { floating?: boolean; onClose?: () => void }) {
  const { push } = useToast();
  const [state, setState] = useState<PushState | null>(null);
  const [hidden, setHidden] = useState(false);
  const [pending, startTransition] = useTransition();

  useEffect(() => {
    let alive = true;
    void readPushState().then((s) => {
      if (!alive) return;
      // "Şimdi değil" 30 gün geçerli (yüzen ve sayfa içi kart aynı kaydı okur).
      if (now() - readNumber(PWA_KEYS.pushDismissedAt) < 30 * 86_400_000) setHidden(true);
      setState(s);
    });
    return () => {
      alive = false;
    };
  }, []);

  const close = () => {
    writeValue(PWA_KEYS.pushDismissedAt, now());
    setHidden(true);
    onClose?.();
  };

  if (hidden || (state !== "available" && state !== "needs-install")) return null;

  function enable() {
    startTransition(async () => {
      const res = await enablePush(subscribeToPush);
      if (!res.ok) {
        push(res.error, "err");
        if (res.denied) close();
        return;
      }
      push("Anlık bildirimler açıldı", "ok");
      setHidden(true);
      onClose?.();
    });
  }

  return (
    <CardShell floating={floating} onClose={close}>
      <div className="flex items-start gap-3 pr-8">
        <span className="grid h-10 w-10 shrink-0 place-items-center rounded-[var(--radius-card)] bg-brand-600/10 text-brand-600">
          <BellRing className="h-5 w-5" aria-hidden />
        </span>
        <div className="min-w-0">
          <h2 className="text-sm font-bold text-ink-950">Önemli gelişmeler telefonunuza gelsin</h2>
          <p className="mt-0.5 text-sm text-text-muted">
            Yeni müşteri, randevu ve görev hatırlatmaları uygulama kapalıyken de gelir. Hangi bildirimlerin geleceğini ve sessiz saatleri
            Hesabım &gt; Bildirimler bölümünden seçersiniz.
          </p>
        </div>
      </div>
      {state === "needs-install" ? (
        <IosInstallSteps />
      ) : (
        <div className="mt-3 flex gap-2">
          <Button onClick={enable} loading={pending} icon={BellRing} className="flex-1 sm:flex-none">
            Bildirimleri aç
          </Button>
          <Button variant="ghost" onClick={close}>
            Şimdi değil
          </Button>
        </div>
      )}
    </CardShell>
  );
}
