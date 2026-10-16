import { now } from "@/lib/clock";

/**
 * Admin canlı veri KÖPRÜSÜ (bağımlılıksız): kendi yazımının yankısı, zil olayı ve kanal canlılığı. Kanal çekirdeği
 * (`hooks/use-admin-realtime`, supabase realtime, tazeleme zamanlayıcısı) layout'ta tembel bağlanır; zil ve talep
 * eylemleri yalnız bu küçük modülü okur, böylece çekirdek /admin rotalarının ilk yük JS'ine girmez.
 */
export type AdminRtEvent = { t: string; op: string; by: string | null; ids: string[] | null };

// --- Yerel yazım yankısı (d) -------------------------------------------------------------------------------------
const ECHO_WINDOW_MS = 5_000;
const localWrites = new Map<string, number>();

/**
 * Bu sekmenin yaptığı yazım: olay kimlikleri tamamen buradaysa (ve sekme odaktaysa) yankı sayılır. Talep yazımı hem
 * talep hem mesaj tablosunu etkiler (mesaj olayının `ids` alanı bilet kimliğidir).
 */
export function noteAdminLocalWrite(tables: readonly string[], ids: readonly string[]): void {
  const at = now();
  for (const t of tables) for (const id of ids) localWrites.set(`${t}:${id}`, at);
}

export function isLocalEcho(ev: AdminRtEvent, atMs: number): boolean {
  if (!ev.ids) return false;
  for (const [k, at] of localWrites) if (atMs - at > ECHO_WINDOW_MS) localWrites.delete(k);
  const echo = ev.ids.every((id) => {
    const at = localWrites.get(`${ev.t}:${id}`);
    return at !== undefined && atMs - at <= ECHO_WINDOW_MS;
  });
  // İşaret TEK yankıyı yutar: aynı pencerede başka birinin (ör. ofisin yeni mesajı) aynı kayda yazımı yok sayılmaz.
  if (echo) for (const id of ev.ids) localWrites.delete(`${ev.t}:${id}`);
  return echo;
}

// --- Zil köprüsü (f) -----------------------------------------------------------------------------------------------
const NOTIF_EVENT = "es:admin-notification";
const LIVE_EVENT = "es:admin-rt-live";
let live = false;

export function isAdminRealtimeLive(): boolean {
  return live;
}

export function setAdminRealtimeLive(next: boolean) {
  if (live === next) return;
  live = next;
  if (typeof window !== "undefined") window.dispatchEvent(new CustomEvent<boolean>(LIVE_EVENT, { detail: next }));
}

/** Bu personele yeni bildirim (ya da yeniden katılım) → zil kendini yeniden okur. */
export function onAdminNotification(cb: () => void): () => void {
  if (typeof window === "undefined") return () => {};
  window.addEventListener(NOTIF_EVENT, cb);
  return () => window.removeEventListener(NOTIF_EVENT, cb);
}

export function emitAdminNotification() {
  if (typeof window !== "undefined") window.dispatchEvent(new Event(NOTIF_EVENT));
}

/** Zil için canlılık aboneliği (yedek yoklama kararı). */
export function onAdminRealtimeLive(cb: (live: boolean) => void): () => void {
  if (typeof window === "undefined") return () => {};
  const h = (e: Event) => cb((e as CustomEvent<boolean>).detail);
  window.addEventListener(LIVE_EVENT, h);
  return () => window.removeEventListener(LIVE_EVENT, h);
}
