import { createAdminClient } from "@/lib/supabase/admin";
import { readPlatformSettingStrict, setPlatformSetting } from "@/lib/platform-settings";
import { revealSecret, sealSecret, secretFingerprint } from "@/lib/settings/secrets";
import { DAY_MS, now, trDayKey } from "@/lib/clock";
import { runPsi, type LabMetrics, type PsiDevice, type PsiOutcome, type StaticModeTag } from "@/lib/perf/psi";
import { STATIC_REV_SETTING_KEY, STATIC_ROUTES_SETTING_KEY, parseStaticRev, parseStaticRoutes, type StaticRouteToggles } from "@/lib/static-home/settings";

/**
 * HIZ MERKEZİ DEPOSU (SP4) — sunucuya özel; bu paketin TÜM platform_settings yazımları buradadır:
 *  - `statik.routes` (rota anahtarları, düz JSON), `statik.rev` (önbellek tazeleme sayacı),
 *  - `perf.psi.key` (PageSpeed API anahtarı; YALNIZ mühürlü `sealSecret` — şifreleme anahtarı yoksa yazılmaz).
 * Laboratuvar sonuçları `perf_lab_runs` tablosunda (RLS açık, politika yok → yalnız service_role).
 * Migration uygulanmadıysa (tablo yok) okumalar boş + `tableMissing`, yazmalar dürüst hata döner.
 */
export const PSI_KEY_SETTING = "perf.psi.key";
export const PERF_RETENTION_DAYS = 400;

export type LabSource = "psi" | "crux" | "lighthouse";

export type LabRun = LabMetrics & {
  id: number;
  day: string;
  path: string;
  device: PsiDevice;
  source: LabSource;
  static_mode: StaticModeTag | null;
  created_at: string;
};

const COLS = "id, day, path, device, source, score, lcp_ms, inp_ms, cls, tbt_ms, ttfb_ms, bytes, requests, html_gz, static_mode, created_at";

const isMissingTable = (e: { code?: string; message?: string } | null) =>
  Boolean(e && (e.code === "42P01" || e.code === "PGRST205" || /perf_lab_runs/.test(e.message ?? "")));

/** TR gün anahtarı (YYYY-MM-DD). */
export function trDay(ms: number = now()): string {
  return trDayKey(ms);
}

/* ------------------------------ Anahtarlar ------------------------------ */

/** Rota anahtarları (okuma hatası FIRLATIR: yazan eylem okunamayan ayarı boş haritayla ezmesin). */
export async function readStaticToggles(): Promise<StaticRouteToggles> {
  return parseStaticRoutes((await readPlatformSettingStrict(STATIC_ROUTES_SETTING_KEY))?.value);
}

/** Tek rota anahtarını yazar (diğer anahtarlar korunur). */
export async function writeStaticToggle(id: string, enabled: boolean, staffId: string): Promise<boolean> {
  const current = await readStaticToggles();
  const next = { ...current, [id]: enabled };
  return setPlatformSetting(STATIC_ROUTES_SETTING_KEY, JSON.stringify(next), staffId);
}

/** `statik.rev` (satır yok = 0; okuma hatası = null). */
export async function readStaticRev(): Promise<number | null> {
  try {
    return parseStaticRev((await readPlatformSettingStrict(STATIC_REV_SETTING_KEY))?.value);
  } catch {
    return null;
  }
}

/** `statik.rev++` (başarısızsa null). Eşzamanlı iki artırım aynı değeri yazabilir; değer yine değiştiği için süreçler tazelenir. */
export async function incrementStaticRev(staffId?: string): Promise<number | null> {
  const current = await readStaticRev();
  if (current === null) return null;
  const next = current + 1;
  return (await setPlatformSetting(STATIC_REV_SETTING_KEY, String(next), staffId)) ? next : null;
}

/* ------------------------------ PSI anahtarı ------------------------------ */

/** Düz anahtar (yoksa null). Okuma hatası FIRLATIR (cron "anahtar yok" ile "DB çöktü"yü ayırır). */
export async function readPsiKey(): Promise<string | null> {
  const row = await readPlatformSettingStrict(PSI_KEY_SETTING);
  return revealSecret(PSI_KEY_SETTING, row?.value);
}

export async function psiKeyStatus(): Promise<{ configured: boolean; readable: boolean }> {
  try {
    const row = await readPlatformSettingStrict(PSI_KEY_SETTING);
    if (!row?.value) return { configured: false, readable: true };
    return { configured: true, readable: revealSecret(PSI_KEY_SETTING, row.value) !== null };
  } catch {
    return { configured: false, readable: false };
  }
}

/** Mühürleyip yazar; şifreleme anahtarı yoksa yazmaz ("no_seal"). `null` = anahtarı sil. */
export async function writePsiKey(plain: string | null, staffId: string): Promise<"ok" | "no_seal" | "error"> {
  if (plain === null) return (await setPlatformSetting(PSI_KEY_SETTING, null, staffId)) ? "ok" : "error";
  const sealed = sealSecret(PSI_KEY_SETTING, plain);
  if (!sealed) return "no_seal";
  const ok = await setPlatformSetting(PSI_KEY_SETTING, sealed, staffId, {
    isSecret: true,
    fingerprint: secretFingerprint(PSI_KEY_SETTING, plain),
    summary: "PageSpeed API anahtarı güncellendi",
  });
  return ok ? "ok" : "error";
}

/* ------------------------------ Laboratuvar ------------------------------ */

export type LabRunInput = { day: string; path: string; device: PsiDevice; source: LabSource; static_mode: StaticModeTag | null } & LabMetrics;

const round = (v: number | null) => (v === null ? null : Math.round(v));

export async function upsertLabRun(input: LabRunInput): Promise<{ ok: boolean; tableMissing?: boolean; error?: string }> {
  const admin = createAdminClient();
  const { error } = await admin.from("perf_lab_runs").upsert(
    {
      day: input.day,
      path: input.path,
      device: input.device,
      source: input.source,
      score: round(input.score),
      lcp_ms: round(input.lcp_ms),
      inp_ms: round(input.inp_ms),
      cls: input.cls,
      tbt_ms: round(input.tbt_ms),
      ttfb_ms: round(input.ttfb_ms),
      bytes: round(input.bytes),
      requests: round(input.requests),
      html_gz: round(input.html_gz),
      static_mode: input.static_mode,
    },
    { onConflict: "day,path,device,source" },
  );
  if (!error) return { ok: true };
  return { ok: false, tableMissing: isMissingTable(error), error: error.message };
}

/** Son koşular (yeniden eskiye). Tablo yoksa boş + tableMissing. Okuma hatası FIRLATIR. */
export async function listLabRuns(opts: { limit?: number; path?: string; sinceDay?: string } = {}): Promise<{ rows: LabRun[]; tableMissing: boolean }> {
  const admin = createAdminClient();
  let q = admin.from("perf_lab_runs").select(COLS).order("day", { ascending: false }).order("created_at", { ascending: false }).limit(opts.limit ?? 200);
  if (opts.path) q = q.eq("path", opts.path);
  if (opts.sinceDay) q = q.gte("day", opts.sinceDay);
  const { data, error } = await q;
  if (error) {
    if (isMissingTable(error)) return { rows: [], tableMissing: true };
    throw new Error(error.message);
  }
  return { rows: (data ?? []) as LabRun[], tableMissing: false };
}

/** 400 günden eski koşuları siler (silinen sayısı; tablo yoksa 0). */
export async function pruneLabRuns(nowMs: number = now()): Promise<number> {
  const admin = createAdminClient();
  const cutoff = trDay(nowMs - PERF_RETENTION_DAYS * DAY_MS);
  const { count, error } = await admin.from("perf_lab_runs").delete({ count: "exact" }).lt("day", cutoff);
  if (error) {
    if (isMissingTable(error)) return 0;
    throw new Error(error.message);
  }
  return count ?? 0;
}

export type LabRunOutcome = { path: string; device: PsiDevice; status: PsiOutcome["status"] | "store_error"; message: string; score: number | null };

/** Tek yol × cihaz: PSI koşar ve sonucu yazar (hata fırlatmaz; kota/hata dürüst satır olarak döner). */
export async function runAndRecordPsi(input: {
  origin: string;
  path: string;
  device: PsiDevice;
  key: string | null;
  staticMode: StaticModeTag | null;
  day?: string;
}): Promise<LabRunOutcome> {
  const out = await runPsi(`${input.origin.replace(/\/$/, "")}${input.path}`, input.device, input.key);
  if (out.status !== "ok") return { path: input.path, device: input.device, status: out.status, message: out.message, score: null };
  const saved = await upsertLabRun({ day: input.day ?? trDay(), path: input.path, device: input.device, source: "psi", static_mode: input.staticMode, ...out.metrics });
  if (!saved.ok) {
    return {
      path: input.path,
      device: input.device,
      status: "store_error",
      message: saved.tableMissing ? "Sonuç kaydedilemedi: perf_lab_runs tablosu yok (migration bekliyor)" : "Sonuç kaydedilemedi",
      score: out.metrics.score,
    };
  }
  return { path: input.path, device: input.device, status: "ok", message: "Ölçüldü", score: out.metrics.score };
}
