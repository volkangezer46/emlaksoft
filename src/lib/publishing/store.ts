import "server-only";
import { getPlatformSetting, getPlatformSettingsMany, setPlatformSetting } from "@/lib/platform-settings";
import { MAX_SCHEDULE_BYTES, SCHEDULE_KEY, parseSchedule, pruneSchedule, type ScheduledEntry } from "./schedule";

/**
 * Zamanlanmış yayın kayıtlarının deposu: platform_settings `publishing.scheduled` (migration yok).
 * Okuma/yazma yalnız src/lib/platform-settings.ts (kabul listesinde) üzerinden; her yazma okunarak doğrulanır.
 */

/** Yönetim ekranı: okunamazsa boş liste. */
export async function readSchedule(): Promise<ScheduledEntry[]> {
  return parseSchedule(await getPlatformSetting(SCHEDULE_KEY));
}

/** Cron ve yazma yolu: okunamazsa HATA fırlatır ("okunamadı" = "kayıt yok" sayılmaz). */
export async function readScheduleStrict(): Promise<ScheduledEntry[]> {
  const row = await getPlatformSettingsMany([SCHEDULE_KEY], { strict: true });
  return parseSchedule(row[SCHEDULE_KEY] ?? null);
}

export type ScheduleSaveResult = { ok: true } | { ok: false; error: string };

export async function writeSchedule(list: ScheduledEntry[], staffId: string): Promise<ScheduleSaveResult> {
  const json = JSON.stringify(pruneSchedule(list));
  if (json.length > MAX_SCHEDULE_BYTES) return { ok: false, error: "Zamanlama kayıtları depolama sınırını (800 KB) aşıyor; bekleyen bir kaydı iptal edin." };
  if (!(await setPlatformSetting(SCHEDULE_KEY, json, staffId))) return { ok: false, error: "Zamanlama kaydedilemedi: platform ayarları tablosuna yazılamadı." };
  if ((await getPlatformSetting(SCHEDULE_KEY)) !== json) return { ok: false, error: "Zamanlama kaydı doğrulanamadı; tekrar deneyin." };
  return { ok: true };
}

/** Tek kaydı güncel listeyle birleştirerek yazar (eşzamanlı ekleme/iptal kaybolmasın diye hemen önce okunur). */
export async function commitEntry(entry: ScheduledEntry, staffId: string): Promise<boolean> {
  const list = await readScheduleStrict();
  const idx = list.findIndex((e) => e.id === entry.id);
  const next = idx === -1 ? [...list, entry] : list.map((e) => (e.id === entry.id ? entry : e));
  return (await writeSchedule(next, staffId)).ok;
}

export async function freshEntry(id: string): Promise<ScheduledEntry | null> {
  return (await readScheduleStrict()).find((e) => e.id === id) ?? null;
}
