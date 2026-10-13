"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { requirePlatformModule, type PlatformStaff } from "@/lib/platform";
import { logPlatformActivity } from "@/lib/platform-activity";
import { resetPlatformFlagsCache } from "@/lib/platform-flags-cache";
import { checkRateLimit } from "@/lib/rate-limit";
import { now } from "@/lib/clock";
import { discardExternalResponse, externalErrorMetadata, fetchOwnOriginInspect, readExternalText } from "@/lib/external-fetch";
import { measureHtml } from "@/lib/perf/measure-html";
import { selfTestCompression, type CompressionResult } from "@/lib/perf/compression";
import { PSI_DEVICES, staticModeTag } from "@/lib/perf/psi";
import { psiKeyStatus, readPsiKey, readStaticToggles, runAndRecordPsi, writePsiKey, writeStaticToggle, type LabRunOutcome } from "@/lib/perf/store";
import { publicOrigin } from "@/lib/public-redirect";
import { STATIC_ROUTES, staticRouteById, staticRouteByPath, type StaticRouteId } from "@/lib/static-home/registry";
import { enabledIdsNow, invalidateStatic, purgeAndWarm, selfOrigin, staticSnapshots, staticWarmLock, type WarmResult } from "@/lib/static-home/render";
import { staticRouteMode } from "@/lib/static-home/settings";

/**
 * HIZ MERKEZİ eylemleri (/admin/site/hiz). Modül `sitecontent` (süper admin + operasyon).
 *  - Statik/Normal anahtarı ve PageSpeed anahtarı: YALNIZ süper admin (operasyon değiştiremez).
 *  - Temizle ve ısıt, öz testler, laboratuvar koşusu: operasyon ve üstü.
 * Her yazma `logPlatformActivity`'ye düşer; gizli anahtarın düz değeri hiçbir kayda yazılmaz.
 */
export type SpeedActionResult<T = undefined> = { ok: true; message: string; data?: T } | { ok: false; error: string };

const SUPER_ONLY = "Bu ayarı yalnız süper admin değiştirebilir.";
const HIZ_PATH = "/admin/site/hiz";

async function guard(superOnly: boolean): Promise<{ staff: PlatformStaff } | { error: string }> {
  const staff = await requirePlatformModule("sitecontent");
  if (superOnly && staff.role !== "super_admin") return { error: SUPER_ONLY };
  const rl = await checkRateLimit(`speed-admin:${staff.id}`, { limit: 40, windowSec: 600, failurePolicy: "deny" });
  if (!rl.allowed) return { error: "Çok sık işlem yaptınız; birkaç dakika sonra tekrar deneyin." };
  return { staff };
}

async function audit(staff: PlatformStaff, action: string, entityId: string, meta?: Record<string, unknown>) {
  await logPlatformActivity({ actorId: staff.id, action, entityType: "speed", entityId, meta: meta ?? null });
}

const ToggleSchema = z.object({ id: z.string().min(1).max(40), enabled: z.boolean() });

/** Statik/Normal anahtarı (süper admin). Proxy değişikliği ≤60 sn'de görür (bayrak önbelleği 30 sn). */
export async function setStaticRoute(input: { id: string; enabled: boolean }): Promise<SpeedActionResult> {
  const g = await guard(true);
  if ("error" in g) return { ok: false, error: g.error };
  const parsed = ToggleSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: "Geçersiz istek." };
  const route = staticRouteById(parsed.data.id);
  if (!route) return { ok: false, error: "Bu sayfa statik kayıt defterinde yok." };
  if (route.disabled) return { ok: false, error: route.disabled };
  let ok: boolean;
  try {
    ok = await writeStaticToggle(route.id, parsed.data.enabled, g.staff.id);
  } catch {
    ok = false;
  }
  if (!ok) return { ok: false, error: "Ayar kaydedilemedi; tekrar deneyin." };
  resetPlatformFlagsCache();
  await invalidateStatic(route.id, g.staff.id);
  await audit(g.staff, parsed.data.enabled ? "speed.static_on" : "speed.static_off", route.id, { path: route.path });
  revalidatePath(HIZ_PATH);
  return {
    ok: true,
    message: parsed.data.enabled
      ? `${route.path} statik sunuma alındı; en geç 60 sn içinde ziyaretçilere hafif sürüm gider.`
      : `${route.path} normal sürüme döndü; en geç 60 sn içinde etkin olur.`,
  };
}

/** Tümünü temizle ve ısıt (operasyon ve üstü): süreç başına tek koşu, dakikada 1, paralellik 2 (F6). */
export async function purgeAndWarmAll(): Promise<SpeedActionResult<WarmResult[]>> {
  const g = await guard(false);
  if ("error" in g) return { ok: false, error: g.error };
  const lock = staticWarmLock();
  const got = lock.tryAcquire();
  if (!got.ok) {
    return {
      ok: false,
      error: got.reason === "running" ? "Temizleme ve ısıtma zaten çalışıyor." : `Az önce çalıştırıldı; ${got.retryInSec} sn sonra yeniden deneyin.`,
    };
  }
  try {
    let ids: StaticRouteId[];
    try {
      ids = await enabledIdsNow();
    } catch {
      return { ok: false, error: "Anahtarlar okunamadı; tekrar deneyin." };
    }
    const { rev, rows } = await purgeAndWarm(ids, g.staff.id);
    const failed = rows.filter((r) => !r.ok).length;
    await audit(g.staff, "speed.purge_warm", "all", { ids, rev, failed });
    revalidatePath(HIZ_PATH);
    return {
      ok: true,
      message: ids.length
        ? `${rows.length - failed}/${rows.length} sayfa temizlendi ve yeniden çizildi${rev === null ? " (diğer süreçlere bildirim yazılamadı)" : ""}.`
        : "Statik sunumda açık sayfa yok; önbellek temizlendi.",
      data: rows,
    };
  } finally {
    lock.release();
  }
}

export type SelfTestRow = {
  id: string;
  path: string;
  status: number | null;
  xStatic: string | null;
  nextScripts: number | null;
  gzipBytes: number | null;
  rawBytes: number | null;
  error?: string;
};

const SELF_TEST_ERROR: Partial<Record<ReturnType<typeof externalErrorMetadata>["kind"], string>> = {
  timeout: "Zaman aşımı (20 sn); sayfa çok yavaş ya da sunucu meşgul, biraz sonra yeniden deneyin.",
  response_too_large: "Yanıt 4 MB'den büyük; sayfa beklenmedik ölçüde büyümüş, Hız bütçesine bakın.",
};

/** X-Static öz testi: her kayıt yolu kendi sürecinden belge isteği olarak çekilir (operasyon ve üstü). */
export async function runStaticSelfTest(): Promise<SpeedActionResult<SelfTestRow[]>> {
  const g = await guard(false);
  if ("error" in g) return { ok: false, error: g.error };
  const origin = selfOrigin();
  const rows = await Promise.all(
    STATIC_ROUTES.map(async (r): Promise<SelfTestRow> => {
      try {
        const res = await fetchOwnOriginInspect(`${origin}${r.path}`, { headers: { accept: "text/html" }, cache: "no-store" }, { timeoutMs: 20_000 });
        const xStatic = res.headers.get("x-static");
        if (res.status !== 200) {
          await discardExternalResponse(res);
          return { id: r.id, path: r.path, status: res.status, xStatic, nextScripts: null, gzipBytes: null, rawBytes: null };
        }
        const m = measureHtml(await readExternalText(res, 4 * 1024 * 1024));
        return { id: r.id, path: r.path, status: res.status, xStatic, nextScripts: m.nextScripts, gzipBytes: m.gzipBytes, rawBytes: m.rawBytes };
      } catch (e) {
        return { id: r.id, path: r.path, status: null, xStatic: null, nextScripts: null, gzipBytes: null, rawBytes: null, error: SELF_TEST_ERROR[externalErrorMetadata(e).kind] ?? "Bağlantı kurulamadı; sunucu ayakta mı kontrol edin." };
      }
    }),
  );
  return { ok: true, message: "Öz test tamamlandı.", data: rows };
}

/** Sıkıştırma öz testi (herkese açık kökene `accept-encoding: br`). */
export async function runCompressionTest(): Promise<SpeedActionResult<CompressionResult>> {
  const g = await guard(false);
  if ("error" in g) return { ok: false, error: g.error };
  const r = await selfTestCompression(publicOrigin());
  return { ok: true, message: r.label, data: r };
}

const LabSchema = z.object({ path: z.string().min(1).max(120) });

/** Laboratuvar: tek yol için PSI mobil + masaüstü (yalnız kayıt defterindeki yollar; operasyon ve üstü). */
export async function runLab(input: { path: string }): Promise<SpeedActionResult<LabRunOutcome[]>> {
  const g = await guard(false);
  if ("error" in g) return { ok: false, error: g.error };
  const parsed = LabSchema.safeParse(input);
  const route = parsed.success ? staticRouteByPath(parsed.data.path) : null;
  if (!route) return { ok: false, error: "Yalnız Hız ekranındaki sayfalar ölçülebilir." };
  const rl = await checkRateLimit(`speed-lab:${g.staff.id}`, { limit: 10, windowSec: 600, failurePolicy: "deny" });
  if (!rl.allowed) return { ok: false, error: "Laboratuvar kotası: 10 dakikada en çok 10 koşu." };
  let key: string | null = null;
  try {
    key = await readPsiKey();
  } catch {
    key = null; // anahtar okunamazsa anahtarsız (düşük kota) denenir
  }
  let mode: string | null = null;
  try {
    mode = staticRouteMode(route, await readStaticToggles());
  } catch {
    mode = null;
  }
  const snap = staticSnapshots().find((s) => s.id === route.id)?.stats;
  const origin = publicOrigin();
  const t0 = now();
  const rows = await Promise.all(
    PSI_DEVICES.map((device) => runAndRecordPsi({ origin, path: route.path, device, key, staticMode: staticModeTag(mode, snap?.lastStatic ?? null) })),
  );
  await audit(g.staff, "speed.lab_run", route.id, { path: route.path, keyless: !key, statuses: rows.map((r) => r.status), ms: now() - t0 });
  revalidatePath(`${HIZ_PATH}/lab`);
  revalidatePath(HIZ_PATH);
  const quota = rows.find((r) => r.status === "quota");
  if (quota) return { ok: false, error: quota.message };
  const okCount = rows.filter((r) => r.status === "ok").length;
  return okCount === rows.length
    ? { ok: true, message: `${route.path} ölçüldü (mobil ve masaüstü).`, data: rows }
    : { ok: false, error: rows.find((r) => r.status !== "ok")?.message ?? "Ölçüm alınamadı; birkaç dakika sonra yeniden deneyin." };
}

const KeySchema = z.object({ key: z.string().trim().min(20).max(200).regex(/^[A-Za-z0-9_-]+$/, "Anahtar yalnız harf, rakam, - ve _ içerir.") });

/** PageSpeed API anahtarı (süper admin; mühürlü saklanır). Boş gönderim anahtarı siler. */
export async function savePsiKey(input: { key: string }): Promise<SpeedActionResult> {
  const g = await guard(true);
  if ("error" in g) return { ok: false, error: g.error };
  const remove = input.key.trim() === "";
  if (!remove) {
    const parsed = KeySchema.safeParse(input);
    if (!parsed.success) return { ok: false, error: parsed.error.issues[0]?.message ?? "Geçersiz anahtar." };
  }
  const r = await writePsiKey(remove ? null : input.key.trim(), g.staff.id);
  if (r === "no_seal") return { ok: false, error: "Şifreleme anahtarı tanımlı değil; gizli ayar düz metin olarak yazılmaz (operasyon: PLATFORM_SECRETS_KEY)." };
  if (r === "error") return { ok: false, error: "Anahtar kaydedilemedi; tekrar deneyin." };
  await audit(g.staff, remove ? "speed.psi_key_removed" : "speed.psi_key_set", "perf.psi.key");
  revalidatePath(`${HIZ_PATH}/lab`);
  return { ok: true, message: remove ? "PageSpeed anahtarı silindi." : "PageSpeed anahtarı şifreli olarak kaydedildi." };
}

/** Lab ekranı için anahtar durumu (düz değer asla dönmez). */
export async function getPsiKeyStatus(): Promise<{ configured: boolean; readable: boolean }> {
  await requirePlatformModule("sitecontent");
  return psiKeyStatus();
}
