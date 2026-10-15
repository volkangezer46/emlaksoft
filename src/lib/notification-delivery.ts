/**
 * Bildirim KANAL kuralları (GA-09) — SAF (I/O yok). `notify.ts` (sunucu), tercih paneli (istemci) ve testler kullanır.
 *
 * Tercih modeli `profiles.notification_prefs` jsonb'sinde:
 *  - `<tür>: boolean`     → tür tamamen açık/kapalı (uygulama içi zil + push). Eksik = açık (eski davranış).
 *  - `push: { <tür>: boolean }` → yalnız PUSH kanalı; `false` ise bildirim zile düşer ama telefona gelmez.
 *  - `quiet: { on, from, to, urgent }` → sessiz saatler (Türkiye saati). Aralıkta push GÖNDERİLMEZ (ertelenmez);
 *    uygulama içi bildirim yine yazılır. `urgent` açıksa "Kritik" (danger) bildirim sessiz saatte de gelir.
 */

export type QuietHours = { on: boolean; from: string; to: string; urgent: boolean };

export const DEFAULT_QUIET_HOURS: QuietHours = { on: true, from: "21:00", to: "08:00", urgent: true };

const HHMM = /^([01]\d|2[0-3]):([0-5]\d)$/;

export function parseQuietHours(raw: unknown): QuietHours {
  if (!raw || typeof raw !== "object") return DEFAULT_QUIET_HOURS;
  const r = raw as Record<string, unknown>;
  return {
    on: typeof r.on === "boolean" ? r.on : DEFAULT_QUIET_HOURS.on,
    from: typeof r.from === "string" && HHMM.test(r.from) ? r.from : DEFAULT_QUIET_HOURS.from,
    to: typeof r.to === "string" && HHMM.test(r.to) ? r.to : DEFAULT_QUIET_HOURS.to,
    urgent: typeof r.urgent === "boolean" ? r.urgent : DEFAULT_QUIET_HOURS.urgent,
  };
}

/** Kanal haritası: yalnız `false` değerleri anlamlıdır (eksik = açık). */
export function parsePushChannel(raw: unknown): Record<string, boolean> {
  if (!raw || typeof raw !== "object") return {};
  const out: Record<string, boolean> = {};
  for (const [k, v] of Object.entries(raw as Record<string, unknown>)) {
    if (typeof v === "boolean" && /^[a-zA-Z]{1,32}$/.test(k)) out[k] = v;
  }
  return out;
}

function minutesOf(hhmm: string): number {
  const m = HHMM.exec(hhmm);
  return m ? Number(m[1]) * 60 + Number(m[2]) : 0;
}

/** Verilen an (ms) Türkiye saatinde kaçıncı dakika? (Türkiye 2016'dan beri sabit UTC+3, yaz saati yok.) */
export function trMinuteOfDay(nowMs: number): number {
  const d = new Date(nowMs + 3 * 3_600_000);
  return d.getUTCHours() * 60 + d.getUTCMinutes();
}

/** Sessiz saat aralığında mı? Gece yarısını aşan aralık (21:00–08:00) desteklenir; from == to = aralık yok. */
export function inQuietHours(quiet: QuietHours, nowMs: number): boolean {
  if (!quiet.on) return false;
  const from = minutesOf(quiet.from);
  const to = minutesOf(quiet.to);
  if (from === to) return false;
  const m = trMinuteOfDay(nowMs);
  return from < to ? m >= from && m < to : m >= from || m < to;
}

/**
 * Bu bildirim telefona (push) gitsin mi? Uygulama içi satır bu karardan BAĞIMSIZ yazılır.
 * prefs: profilin ham `notification_prefs` değeri (null = hiç kaydedilmemiş → varsayılan sessiz saat geçerli).
 */
export function pushAllowed(input: {
  prefs: unknown;
  prefKey?: string | null;
  kind?: string | null;
  nowMs: number;
}): boolean {
  const prefs = input.prefs && typeof input.prefs === "object" ? (input.prefs as Record<string, unknown>) : {};
  if (input.prefKey) {
    const channel = parsePushChannel(prefs.push);
    if (channel[input.prefKey] === false) return false;
  }
  const quiet = parseQuietHours(prefs.quiet);
  if (inQuietHours(quiet, input.nowMs)) return input.kind === "danger" && quiet.urgent;
  return true;
}
