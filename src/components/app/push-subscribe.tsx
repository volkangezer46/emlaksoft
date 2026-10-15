"use client";

import { useEffect, useState, useTransition } from "react";
import { BellOff, BellPlus, BellRing, Loader2, Send, Smartphone } from "lucide-react";
import { useToast } from "@/components/app/toast-provider";
import { Button } from "@/components/ui/button";
import { sendTestPush, subscribeToPush, unsubscribeFromPush } from "@/app/actions/notifications";
import { disablePush, enablePush, readPushState, type PushState } from "@/lib/push-client";

/**
 * Bu cihazın anlık bildirim (push) anahtarı + deneme bildirimi. Durumlar push-client `readPushState` ile okunur:
 * desteklenmiyorsa hiç çizilmez; iOS Safari sekmesinde ana ekrana ekleme rehberi; izin reddedildiyse nasıl açılacağı.
 */
export function PushSubscribeToggle() {
  const { push } = useToast();
  const [state, setState] = useState<PushState | null>(null);
  const [pending, startTransition] = useTransition();

  useEffect(() => {
    let alive = true;
    void readPushState().then((s) => {
      if (alive) setState(s);
    });
    return () => {
      alive = false;
    };
  }, []);

  function toggle() {
    startTransition(async () => {
      if (state === "subscribed") {
        const res = await disablePush(unsubscribeFromPush);
        if (!res.ok) {
          push(res.error ?? "Anlık bildirim kapatılamadı.", "err");
          return;
        }
        setState("available");
        push("Bu cihazda anlık bildirimler kapatıldı", "ok");
        return;
      }
      const res = await enablePush(subscribeToPush);
      if (!res.ok) {
        if (res.denied) setState("denied");
        push(res.error, "err");
        return;
      }
      setState("subscribed");
      push("Anlık bildirimler açıldı: bu cihaz artık bildirim alır", "ok");
    });
  }

  function test() {
    startTransition(async () => {
      const res = await sendTestPush();
      if (res.error) push(res.error, "err");
      else push("Deneme bildirimi gönderildi; birkaç saniye içinde gelir", "ok");
    });
  }

  if (state === null || state === "unsupported") return null;

  if (state === "needs-install") {
    return (
      <div className="flex items-start gap-3 rounded-[var(--radius-card)] border border-dashed border-line-strong bg-canvas/50 px-3 py-3">
        <span className="grid h-9 w-9 shrink-0 place-items-center rounded-[var(--radius-control)] bg-brand-600/10 text-brand-600">
          <Smartphone className="h-4 w-4" aria-hidden />
        </span>
        <span className="min-w-0 flex-1 text-sm">
          <span className="block font-semibold text-ink-950">iPhone&apos;da anlık bildirim için uygulamayı ana ekrana ekleyin</span>
          <span className="mt-0.5 block text-xs text-text-muted">
            Safari&apos;de alttaki Paylaş düğmesine, ardından &quot;Ana Ekrana Ekle&quot;ye dokunun. Uygulamayı ana ekrandan açınca bu
            ayar etkinleşir.
          </span>
        </span>
      </div>
    );
  }

  if (state === "denied") {
    return (
      <div className="flex items-start gap-3 rounded-[var(--radius-card)] border border-amber-500/30 bg-amber-500/8 px-3 py-3 text-xs text-amber-800">
        <BellOff className="mt-0.5 h-4 w-4 shrink-0" aria-hidden />
        <span>
          <strong className="block text-sm font-semibold">Bu tarayıcıda bildirim izni kapalı</strong>
          Adres çubuğundaki kilit simgesinden &quot;Bildirimler&quot; iznini açıp sayfayı yenileyin.
        </span>
      </div>
    );
  }

  const on = state === "subscribed";
  return (
    <div className="flex flex-col gap-2 rounded-[var(--radius-card)] border border-dashed border-line-strong bg-canvas/50 px-3 py-3 sm:flex-row sm:items-center">
      <span className="flex min-w-0 flex-1 items-center gap-3">
        <span
          className={`grid h-9 w-9 shrink-0 place-items-center rounded-[var(--radius-control)] ${
            on ? "bg-mint-500/12 text-mint-600" : "bg-brand-600/10 text-brand-600"
          }`}
        >
          {pending ? <Loader2 className="h-4 w-4 animate-spin" /> : on ? <BellRing className="h-4 w-4" /> : <BellPlus className="h-4 w-4" />}
        </span>
        <span className="min-w-0">
          <span className="block text-sm font-semibold text-ink-950">{on ? "Bu cihazda anlık bildirim açık" : "Bu cihazda anlık bildirim kapalı"}</span>
          <span className="block text-xs text-text-muted">Uygulama kapalıyken de yeni müşteri, randevu ve görev hatırlatmaları gelir.</span>
        </span>
      </span>
      <span className="flex gap-2">
        {on ? (
          <Button variant="outline" size="sm" icon={Send} disabled={pending} onClick={test}>
            Deneme gönder
          </Button>
        ) : null}
        <Button variant={on ? "ghost" : "primary"} size="sm" loading={pending} onClick={toggle}>
          {on ? "Kapat" : "Aç"}
        </Button>
      </span>
    </div>
  );
}
