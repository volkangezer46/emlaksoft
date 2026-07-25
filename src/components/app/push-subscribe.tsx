"use client";

import { useEffect, useState, useTransition } from "react";
import { BellPlus, BellOff, Loader2 } from "lucide-react";
import { useToast } from "@/components/app/toast-provider";
import { subscribeToPush, unsubscribeFromPush } from "@/app/actions/notifications";

function urlBase64ToUint8Array(base64String: string) {
  const padding = "=".repeat((4 - (base64String.length % 4)) % 4);
  const base64 = (base64String + padding).replace(/-/g, "+").replace(/_/g, "/");
  const rawData = atob(base64);
  return Uint8Array.from([...rawData].map((c) => c.charCodeAt(0)));
}

/** Tarayıcı push aboneliği — VAPID public key yoksa render edilmez */
export function PushSubscribeToggle() {
  const { push } = useToast();
  const [supported, setSupported] = useState(false);
  const [subscribed, setSubscribed] = useState(false);
  const [pending, startTransition] = useTransition();

  useEffect(() => {
    const key = process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY;
    if (!key || typeof window === "undefined" || !("serviceWorker" in navigator) || !("PushManager" in window)) return;
    // İkisi de service worker hazır olduktan sonra set ediliyor: hem efekt
    // gövdesinde senkron setState kalmıyor, hem de SW hazır olmadan zaten
    // abone olunamayacağı için düğmeyi erken göstermek yanıltıcıydı.
    navigator.serviceWorker.ready.then(async (reg) => {
      const sub = await reg.pushManager.getSubscription();
      setSupported(true);
      setSubscribed(Boolean(sub));
    });
  }, []);

  function toggle() {
    const key = process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY;
    if (!key) return;
    startTransition(async () => {
      try {
        const reg = await navigator.serviceWorker.ready;
        if (subscribed) {
          const sub = await reg.pushManager.getSubscription();
          if (sub) {
            await unsubscribeFromPush(sub.endpoint);
            await sub.unsubscribe();
          }
          setSubscribed(false);
          push("Push bildirimleri kapatıldı", "ok");
          return;
        }

        const perm = await Notification.requestPermission();
        if (perm !== "granted") {
          push("Bildirim izni verilmedi", "err");
          return;
        }
        const sub = await reg.pushManager.subscribe({
          userVisibleOnly: true,
          applicationServerKey: urlBase64ToUint8Array(key),
        });
        const json = sub.toJSON();
        const res = await subscribeToPush({
          endpoint: sub.endpoint,
          p256dh: json.keys?.p256dh ?? "",
          auth: json.keys?.auth ?? "",
        });
        if (res.error) {
          push(res.error, "err");
          return;
        }
        setSubscribed(true);
        push("Push bildirimleri açıldı — bu cihaz artık anlık bildirim alır", "ok");
      } catch {
        push("Push aboneliği kurulamadı", "err");
      }
    });
  }

  if (!supported) return null;

  return (
    <button
      type="button"
      disabled={pending}
      onClick={toggle}
      className="flex w-full items-center gap-3 rounded-[12px] border border-dashed border-line-strong bg-canvas/50 px-3 py-3 text-left transition hover:border-brand-300 disabled:opacity-60"
    >
      <span
        className={`grid h-9 w-9 place-items-center rounded-[10px] ${
          subscribed ? "bg-mint-500/12 text-mint-600" : "bg-brand-600/10 text-brand-600"
        }`}
      >
        {pending ? <Loader2 className="h-4 w-4 animate-spin" /> : subscribed ? <BellOff className="h-4 w-4" /> : <BellPlus className="h-4 w-4" />}
      </span>
      <span className="min-w-0 flex-1">
        <span className="block text-sm font-semibold text-ink-950">
          {subscribed ? "Bu cihazda push açık" : "Bu cihazda push bildirimi aç"}
        </span>
        <span className="block text-[11px] text-text-muted">
          Tarayıcı kapalıyken de anlık bildirim al (PWA)
        </span>
      </span>
    </button>
  );
}
