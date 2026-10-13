import { createHash } from "node:crypto";
import { parseTrLocalDateTime } from "@/lib/clock";

/**
 * YAYIN MASASI — zamanlanmış yayın ve bitiş (SAF çekirdek; DB yok, saat dışarıdan verilir).
 *
 * Kayıtlar platform_settings `publishing.scheduled` anahtarında JSON dizi olarak durur (migration yok):
 *   bekliyor   -> publishAt gelince taslak anlık görüntüsü (cfg) yayınlanır
 *   yayinda    -> unpublishAt gelince önceki canlı (prevLive; null = kod varsayılanı) geri yayınlanır
 *   tamamlandi -> iş bitti (bitişsiz yayın ya da bitişte geri dönüldü)
 *   iptal      -> elle iptal / araya elle yayın girdi / sürüm artık geçersiz
 * İDEMPOTENT: her geçişten önce kaydın güncel durumu depodan yeniden okunur; durum yazımı yayından hemen sonra yapılır.
 * Yarıda kalan koşu (yayın oldu, durum yazılamadı) bir sonraki koşuda canlı hash'ten anlaşılır ve tekrar yayınlanmaz.
 */

export const SCHEDULE_KEY = "publishing.scheduled";
export const MAX_PENDING = 20;
export const MAX_SCHEDULE_BYTES = 800 * 1024;
/** Biten/iptal kayıtlardan saklanan en çok (takvim ve geçmiş için). */
export const MAX_FINISHED_KEPT = 30;
export const MIN_LEAD_MS = 5 * 60_000;

export type ScheduleStatus = "bekliyor" | "yayinda" | "tamamlandi" | "iptal";

export type ScheduledEntry = {
  id: string;
  surface: string;
  label: string;
  cfg: unknown;
  cfgHash: string;
  /** ISO (UTC). */
  publishAt: string;
  unpublishAt: string | null;
  /** Zamanlayan personelin kimliği (yayın ve denetim izi bu kişi adına yazılır). */
  by: string;
  /** Zamanlayan personelin görünen adı. */
  byName: string;
  createdAt: string;
  status: ScheduleStatus;
  note: string;
  prevLive: unknown | null;
  /** null = henüz yakalanmadı. Canlı kayıt yoksa (kod varsayılanı) hashOf(null). */
  prevLiveHash: string | null;
};

const STATUSES: readonly ScheduleStatus[] = ["bekliyor", "yayinda", "tamamlandi", "iptal"];

/** Anahtar sırasından bağımsız JSON (hash ve karşılaştırma için). */
export function stableJson(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value ?? null);
  if (Array.isArray(value)) return `[${value.map((v) => stableJson(v === undefined ? null : v)).join(",")}]`;
  const obj = value as Record<string, unknown>;
  const keys = Object.keys(obj)
    .filter((k) => obj[k] !== undefined)
    .sort();
  return `{${keys.map((k) => `${JSON.stringify(k)}:${stableJson(obj[k])}`).join(",")}}`;
}

/** sha256(kararlı JSON), hex. */
export function hashOf(value: unknown): string {
  return createHash("sha256").update(stableJson(value)).digest("hex");
}

export function parseSchedule(raw: string | null): ScheduledEntry[] {
  if (!raw) return [];
  try {
    const arr = JSON.parse(raw) as unknown;
    if (!Array.isArray(arr)) return [];
    const out: ScheduledEntry[] = [];
    for (const e of arr as Array<Partial<ScheduledEntry>>) {
      if (!e || typeof e.id !== "string" || typeof e.surface !== "string" || typeof e.cfgHash !== "string") continue;
      if (typeof e.publishAt !== "string" || !STATUSES.includes(e.status as ScheduleStatus)) continue;
      out.push({
        id: e.id,
        surface: e.surface,
        label: typeof e.label === "string" ? e.label : "",
        cfg: e.cfg ?? null,
        cfgHash: e.cfgHash,
        publishAt: e.publishAt,
        unpublishAt: typeof e.unpublishAt === "string" ? e.unpublishAt : null,
        by: typeof e.by === "string" ? e.by : "",
        byName: typeof e.byName === "string" ? e.byName : "",
        createdAt: typeof e.createdAt === "string" ? e.createdAt : e.publishAt,
        status: e.status as ScheduleStatus,
        note: typeof e.note === "string" ? e.note : "",
        prevLive: e.prevLive ?? null,
        prevLiveHash: typeof e.prevLiveHash === "string" ? e.prevLiveHash : null,
      });
    }
    return out;
  } catch {
    return [];
  }
}

export const isOpen = (e: Pick<ScheduledEntry, "status">) => e.status === "bekliyor" || e.status === "yayinda";

/** Açık kayıtlar hep kalır; biten/iptal kayıtlardan en yeni MAX_FINISHED_KEPT tanesi saklanır. */
export function pruneSchedule(list: ScheduledEntry[]): ScheduledEntry[] {
  const finished = list
    .filter((e) => !isOpen(e))
    .sort((a, b) => Date.parse(b.publishAt) - Date.parse(a.publishAt))
    .slice(0, MAX_FINISHED_KEPT);
  const keep = new Set(finished.map((e) => e.id));
  return list.filter((e) => isOpen(e) || keep.has(e.id));
}

/**
 * Türkiye saatiyle girilen `datetime-local` değerini UTC ISO'ya çevirir (sunucu saat diliminden bağımsız).
 * Saat dilimi taşıyan girdi aynen kullanılır. Geçersizse null.
 */
export function trLocalToUtcIso(raw: string | null | undefined): string | null {
  const d = parseTrLocalDateTime(String(raw ?? ""));
  return d ? d.toISOString() : null;
}

/** Aynı yüzeyde zaman aralığı çakışan açık kayıtlar (bitişsiz kayıt sonsuza kadar sürer sayılır). */
export function overlapping(
  list: ScheduledEntry[],
  surface: string,
  publishAtMs: number,
  unpublishAtMs: number | null,
): ScheduledEntry[] {
  const end = unpublishAtMs ?? Number.POSITIVE_INFINITY;
  return list.filter((e) => {
    if (e.surface !== surface || !isOpen(e)) return false;
    const s = Date.parse(e.publishAt);
    const f = e.unpublishAt ? Date.parse(e.unpublishAt) : Number.POSITIVE_INFINITY;
    return s < end && publishAtMs < f;
  });
}

export type ScheduleWriteResult = { ok: true } | { ok: false; error: string; permanent?: boolean };

/** Zamanlayıcı yan etkileri (cron gerçek depoya, test bellek içi sahteye bağlar). */
export type ScheduleAdapters = {
  /** Kaydın depodaki GÜNCEL hâli (çift koşu ve elle iptal denetimi). */
  fresh(id: string): Promise<ScheduledEntry | null>;
  /** Kaydı depoya yazar (diğer kayıtlarla birleştirerek). false = yazılamadı. */
  commit(entry: ScheduledEntry): Promise<boolean>;
  /** Yüzeyin canlı yapılandırması (yoksa null = kod varsayılanı). Okunamazsa FIRLATMALI ("okunamadı" ≠ "canlı yok"). */
  readLive(surface: string): Promise<unknown | null>;
  /** Yapılandırmayı yayınlar (doğrulama dahil). `permanent`: tekrar denemek anlamsız (ör. sürüm artık geçersiz). */
  publish(surface: string, cfg: unknown, entry: ScheduledEntry, kind: "yayin" | "bitis"): Promise<ScheduleWriteResult>;
  /** Canlıyı siler (kod varsayılanına döner). */
  resetToDefault(surface: string, entry: ScheduledEntry): Promise<ScheduleWriteResult>;
  /** Canlıyı değiştiren her başarılı adımdan sonra (önbellek etiketi). */
  revalidate(surface: string): void;
  /** Zamanlı yayın yapılamadı (kind 'yayin') ya da bitişte geri dönülemedi (kind 'bitis'): süper admine zil. */
  notify(entry: ScheduledEntry, kind: "yayin" | "bitis"): Promise<void>;
  /** Denetim izi ('publishing.scheduled_publish'). */
  log(entry: ScheduledEntry, kind: "yayin" | "bitis" | "iptal", detail?: string): Promise<void>;
};

export type ScheduleRunResult = { published: number; reverted: number; cancelled: number; failed: number; skipped: number };

export const CONFLICT_NOTE = "Araya elle yayın girdi; geri dönülmedi";

/**
 * Zamanı gelen kayıtları işler. `entries` yalnız aday listesidir; her kayıt işlenmeden önce `fresh` ile yeniden okunur.
 * Sıra: yayın (publishAt artan), sonra bitiş — aynı koşuda yayınlanan kaydın bitişi de gelmişse aynı koşuda geri döner.
 */
export async function runSchedule(entries: ScheduledEntry[], nowMs: number, a: ScheduleAdapters): Promise<ScheduleRunResult> {
  const r: ScheduleRunResult = { published: 0, reverted: 0, cancelled: 0, failed: 0, skipped: 0 };
  const due = (iso: string | null) => iso !== null && Date.parse(iso) <= nowMs;
  const order = [...entries].sort((x, y) => Date.parse(x.publishAt) - Date.parse(y.publishAt));

  // 1) YAYIN
  for (const cand of order) {
    if (cand.status !== "bekliyor" || !due(cand.publishAt)) continue;
    let e = await a.fresh(cand.id);
    if (!e || e.status !== "bekliyor") {
      r.skipped += 1;
      continue;
    }
    if (due(e.unpublishAt)) {
      // Bitiş de geçmiş (ör. cron uzun süre durdu): yayınlayıp hemen geri almak yerine hiç yayınlanmaz.
      if (!(await a.commit({ ...e, status: "iptal", note: "Bitiş zamanı da geçmişti; yayınlanmadı" }))) r.failed += 1;
      else r.cancelled += 1;
      continue;
    }
    try {
      const live = await a.readLive(e.surface);
      const liveHash = hashOf(live);
      // Önceki canlıyı YALNIZ bir kez yakala: yarıda kalan koşu sonrası (canlı = cfg) üzerine yazılmasın.
      if (e.prevLiveHash === null) {
        e = { ...e, prevLive: live, prevLiveHash: liveHash };
        if (!(await a.commit(e))) {
          r.failed += 1;
          continue;
        }
      }
      if (liveHash !== e.cfgHash) {
        const res = await a.publish(e.surface, e.cfg, e, "yayin");
        if (!res.ok) {
          if (res.permanent) {
            // Zamanlayan kişi masaya bakmadan da öğrensin (bitişteki kalıcı hatayla aynı: zil + denetim izi).
            const bad: ScheduledEntry = { ...e, status: "iptal", note: `Yayınlanamadı: ${res.error}`.slice(0, 200) };
            await a.commit(bad);
            await a.notify(bad, "yayin");
            await a.log(bad, "iptal", res.error);
            r.cancelled += 1;
          } else r.failed += 1;
          continue;
        }
        a.revalidate(e.surface);
      }
      const next: ScheduledEntry = { ...e, status: e.unpublishAt ? "yayinda" : "tamamlandi" };
      if (!(await a.commit(next))) r.failed += 1;
      await a.log(next, "yayin");
      r.published += 1;
    } catch (err) {
      console.error("yayin-zamanlayici yayın", e.id, err instanceof Error ? err.message : err);
      r.failed += 1;
    }
  }

  // 2) BİTİŞ (önceki sürüme dönüş)
  for (const cand of order) {
    if (!due(cand.unpublishAt)) continue;
    const e = await a.fresh(cand.id);
    if (!e || e.status !== "yayinda" || !due(e.unpublishAt)) {
      if (cand.status === "yayinda") r.skipped += 1;
      continue;
    }
    try {
      const liveHash = hashOf(await a.readLive(e.surface));
      if (liveHash !== e.cfgHash) {
        if (e.prevLiveHash !== null && liveHash === e.prevLiveHash) {
          // Geri dönüş önceki koşuda yapılmış, durum yazılamamış: yalnız durumu tamamla.
          if (!(await a.commit({ ...e, status: "tamamlandi" }))) r.failed += 1;
          else r.reverted += 1;
          continue;
        }
        const cancelled: ScheduledEntry = { ...e, status: "iptal", note: CONFLICT_NOTE };
        if (!(await a.commit(cancelled))) {
          r.failed += 1;
          continue;
        }
        await a.notify(cancelled, "bitis");
        await a.log(cancelled, "iptal", CONFLICT_NOTE);
        r.cancelled += 1;
        continue;
      }
      const res = e.prevLive === null ? await a.resetToDefault(e.surface, e) : await a.publish(e.surface, e.prevLive, e, "bitis");
      if (!res.ok) {
        if (res.permanent) {
          const bad: ScheduledEntry = { ...e, status: "iptal", note: `Önceki sürüme dönülemedi: ${res.error}`.slice(0, 200) };
          await a.commit(bad);
          await a.notify(bad, "bitis");
          await a.log(bad, "iptal", res.error);
          r.cancelled += 1;
        } else r.failed += 1;
        continue;
      }
      a.revalidate(e.surface);
      const done: ScheduledEntry = { ...e, status: "tamamlandi" };
      if (!(await a.commit(done))) r.failed += 1;
      await a.log(done, "bitis");
      r.reverted += 1;
    } catch (err) {
      console.error("yayin-zamanlayici bitiş", e.id, err instanceof Error ? err.message : err);
      r.failed += 1;
    }
  }
  return r;
}
