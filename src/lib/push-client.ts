/**
 * Tarayıcı push aboneliği yardımcıları (YALNIZ istemci; sunucu eylemleri çağıran bileşenden enjekte edilir, böylece
 * bu modül hafif kalır ve hem tercih panelindeki anahtar hem de bağlam içi "push aç" kartı aynı mantığı kullanır).
 *
 * İzin isteği HER ZAMAN kullanıcı dokunuşundan sonra yapılır (sayfa açılırken asla). iOS'ta push yalnız ana ekrana
 * eklenmiş uygulamada çalışır: Safari sekmesinde `needs-install` döner, kart "Ana ekrana ekle" rehberini gösterir.
 */

export type PushState =
  /** Tarayıcı push desteklemiyor ya da ortamda VAPID genel anahtarı yok. */
  | "unsupported"
  /** iOS Safari sekmesi: önce ana ekrana eklenmeli. */
  | "needs-install"
  /** Kullanıcı izni reddetti (yalnız tarayıcı ayarından açılır). */
  | "denied"
  | "subscribed"
  /** Destekleniyor, abone değil (izin sorulmamış ya da verilmiş ama abonelik yok). */
  | "available";

export function vapidPublicKey(): string | null {
  return process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY || null;
}

export function isStandalone(): boolean {
  if (typeof window === "undefined") return false;
  try {
    if (window.matchMedia?.("(display-mode: standalone)").matches) return true;
  } catch {
    /* eski tarayıcı */
  }
  return (navigator as Navigator & { standalone?: boolean }).standalone === true;
}

export function isIos(): boolean {
  if (typeof navigator === "undefined") return false;
  const ua = navigator.userAgent || "";
  // iPadOS 13+ masaüstü UA'sı taşır: dokunmatik Mac = iPad.
  return /iPad|iPhone|iPod/.test(ua) || (/Macintosh/.test(ua) && (navigator.maxTouchPoints ?? 0) > 1);
}

export async function readPushState(): Promise<PushState> {
  if (typeof window === "undefined" || !vapidPublicKey()) return "unsupported";
  const swOk = "serviceWorker" in navigator;
  if (isIos() && !isStandalone()) return swOk ? "needs-install" : "unsupported";
  if (!swOk || !("PushManager" in window) || typeof Notification === "undefined") return "unsupported";
  if (Notification.permission === "denied") return "denied";
  try {
    const reg = await navigator.serviceWorker.ready;
    const sub = await reg.pushManager.getSubscription();
    return sub ? "subscribed" : "available";
  } catch {
    return "unsupported";
  }
}

function urlBase64ToUint8Array(base64String: string) {
  const padding = "=".repeat((4 - (base64String.length % 4)) % 4);
  const base64 = (base64String + padding).replace(/-/g, "+").replace(/_/g, "/");
  const rawData = atob(base64);
  return Uint8Array.from([...rawData].map((c) => c.charCodeAt(0)));
}

type SaveFn = (sub: { endpoint: string; p256dh: string; auth: string }) => Promise<{ ok?: boolean; error?: string }>;
type RemoveFn = (endpoint: string) => Promise<{ ok?: boolean; error?: string }>;

/** Kullanıcı dokunuşundan sonra çağrılır: izin ister, abone olur, aboneliği sunucuya kaydeder. */
export async function enablePush(save: SaveFn): Promise<{ ok: true } | { ok: false; error: string; denied?: boolean }> {
  const key = vapidPublicKey();
  if (!key) return { ok: false, error: "Bu ortamda anlık bildirim kanalı kapalı." };
  try {
    const perm = await Notification.requestPermission();
    if (perm !== "granted") {
      return { ok: false, denied: perm === "denied", error: "Bildirim izni verilmedi. İzni tarayıcı ayarlarından açabilirsiniz." };
    }
    const reg = await navigator.serviceWorker.ready;
    const sub =
      (await reg.pushManager.getSubscription()) ??
      (await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: urlBase64ToUint8Array(key) }));
    const json = sub.toJSON();
    const res = await save({ endpoint: sub.endpoint, p256dh: json.keys?.p256dh ?? "", auth: json.keys?.auth ?? "" });
    if (res.error) return { ok: false, error: res.error };
    return { ok: true };
  } catch {
    return { ok: false, error: "Anlık bildirim aboneliği kurulamadı. Lütfen tekrar deneyin." };
  }
}

export async function disablePush(remove: RemoveFn): Promise<{ ok: boolean; error?: string }> {
  try {
    const reg = await navigator.serviceWorker.ready;
    const sub = await reg.pushManager.getSubscription();
    if (sub) {
      await remove(sub.endpoint);
      await sub.unsubscribe();
    }
    return { ok: true };
  } catch {
    return { ok: false, error: "Anlık bildirim kapatılamadı." };
  }
}

// ---------------------------------------------------------------------------
// Yerel tercih anahtarları (yalnız kolaylık; okunamazsa varsayılan davranış)
// ---------------------------------------------------------------------------

export const PWA_KEYS = {
  sessions: "es_pwa_sessions_v1",
  sessionFlag: "es_pwa_session_seen",
  installDismissedAt: "es_pwa_install_dismissed_at",
  pushDismissedAt: "es_pwa_push_dismissed_at",
} as const;

export function readNumber(key: string): number {
  try {
    const n = Number(localStorage.getItem(key));
    return Number.isFinite(n) ? n : 0;
  } catch {
    return 0;
  }
}

export function writeValue(key: string, value: string | number) {
  try {
    localStorage.setItem(key, String(value));
  } catch {
    /* gizli pencere / engellenmiş depolama */
  }
}
