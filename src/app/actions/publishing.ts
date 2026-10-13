"use server";

import { randomBytes } from "node:crypto";
import { revalidatePath, updateTag } from "next/cache";
import { now } from "@/lib/clock";
import { requirePlatformModule } from "@/lib/platform";
import { logPlatformActivity } from "@/lib/platform-activity";
import { checkRateLimit } from "@/lib/rate-limit";
import { diffJson, moreLabel, previewValue, type DiffKind } from "@/lib/publishing/diff";
import {
  MAX_PENDING,
  MAX_SCHEDULE_BYTES,
  MIN_LEAD_MS,
  hashOf,
  overlapping,
  trLocalToUtcIso,
  type ScheduledEntry,
} from "@/lib/publishing/schedule";
import { readScheduleStrict, writeSchedule } from "@/lib/publishing/store";
import { surfaceById, type PublishSurface } from "@/lib/publishing/surfaces";

/**
 * YAYIN MASASI eylemleri (/admin/site): taslağı zamanla, zamanlamayı iptal et, fark önizle, önceki sürüme dön.
 * Yetki: yüzeyin modülü (requirePlatformModule) + o editörün bugünkü yazma kuralı (yalnız süper admin yazar).
 * Fark önizlemesi salt okumadır (modül yeterli). Her yazma denetim izine düşer.
 */

export type PublishingResult = { ok?: boolean; error?: string; warning?: string; needsConfirm?: boolean };
export type DiffLine = { path: string; kind: DiffKind; before: string; after: string };
export type DiffPreview = { ok?: boolean; error?: string; title?: string; rows?: DiffLine[]; total?: number; more?: string };

const READONLY = "Yayın masasında yalnız süper admin değişiklik yapabilir; bu hesap salt okunur.";
const UNKNOWN = "Bilinmeyen yüzey.";

async function gate(surfaceId: string, write: boolean) {
  const surface = surfaceById(String(surfaceId ?? ""));
  if (!surface) return { error: UNKNOWN } as const;
  const staff = await requirePlatformModule(surface.module);
  if (write && staff.role !== "super_admin") return { error: READONLY } as const;
  return { surface, staff } as const;
}

function refreshDesk() {
  revalidatePath("/admin/site");
}

/** Canlıyı değiştiren eylem (geri dönüş): okuyanın yazısını görmesi için updateTag (yalnız server action'da). */
function refreshLive(surface: PublishSurface) {
  updateTag(surface.cacheTag);
  for (const p of surface.livePaths) revalidatePath(p.path, p.type);
  revalidatePath(surface.editorHref);
  refreshDesk();
}

const fmtTr = (iso: string) =>
  new Date(iso).toLocaleString("tr-TR", { timeZone: "Europe/Istanbul", day: "2-digit", month: "long", hour: "2-digit", minute: "2-digit" });

/**
 * O anki TASLAĞI anlık görüntüler ve TR saatine göre girilen zamanda yayınlanmak üzere zamanlar.
 * Aynı yüzeyde zaman aralığı çakışan açık kayıt varsa önce uyarı döner (`needsConfirm`); `confirm` ile yine de kaydedilir.
 */
export async function schedulePublish(
  surfaceId: string,
  publishAtLocal: string,
  unpublishAtLocal: string | null,
  label: string,
  confirm = false,
): Promise<PublishingResult> {
  const g = await gate(surfaceId, true);
  if ("error" in g) return { error: g.error };
  const { surface, staff } = g;
  const rl = await checkRateLimit(`publishing-schedule:${staff.id}`, { limit: 30, windowSec: 600, failurePolicy: "deny" });
  if (!rl.allowed) return { error: "Çok sık işlem yaptınız; birkaç dakika sonra tekrar deneyin." };

  const nowMs = now();
  const publishAt = trLocalToUtcIso(publishAtLocal);
  if (!publishAt) return { error: "Başlangıç zamanı geçersiz." };
  const publishMs = Date.parse(publishAt);
  if (publishMs < nowMs + MIN_LEAD_MS) return { error: "Başlangıç en az 5 dakika sonrası olmalı." };
  let unpublishAt: string | null = null;
  if (unpublishAtLocal && String(unpublishAtLocal).trim()) {
    unpublishAt = trLocalToUtcIso(unpublishAtLocal);
    if (!unpublishAt) return { error: "Bitiş zamanı geçersiz." };
    if (Date.parse(unpublishAt) < publishMs + MIN_LEAD_MS) return { error: "Bitiş, başlangıçtan en az 5 dakika sonra olmalı." };
  }

  const state = await surface.readState();
  if (!state.draft) return { error: "Zamanlanacak taslak yok; önce editörde değişiklik yapıp taslağı kaydedin." };
  if (hashOf(state.draft) === hashOf(state.live ?? surface.defaults())) {
    return { error: "Taslak canlı sürümle aynı; zamanlanacak değişiklik yok." };
  }
  const valid = await surface.validate(state.draft);
  if ("error" in valid) return { error: `Taslakta hata var; düzeltmeden zamanlanamaz. ${valid.error}` };

  let list: ScheduledEntry[];
  try {
    list = await readScheduleStrict();
  } catch {
    return { error: "Zamanlama kayıtları okunamadı; tekrar deneyin." };
  }
  if (list.filter((e) => e.status === "bekliyor").length >= MAX_PENDING) {
    return { error: `En çok ${MAX_PENDING} bekleyen zamanlama olabilir; önce birini iptal edin.` };
  }
  const clash = overlapping(list, surface.id, publishMs, unpublishAt ? Date.parse(unpublishAt) : null);
  if (clash.length > 0 && !confirm) {
    const c = clash[0]!;
    return {
      needsConfirm: true,
      warning: `${surface.label} için ${fmtTr(c.publishAt)} tarihli "${c.label}" zamanlaması bu aralıkla çakışıyor. Sonra yayınlanan öncekini ezer; bitişte yalnız canlı hâlâ o sürümse geri dönülür.`,
    };
  }

  const cfgJson = JSON.stringify(valid.cfg);
  // prevLive yayın anında eklenecek: boyut sınırı onun için de pay bırakır.
  if (JSON.stringify(list).length + cfgJson.length * 2 > MAX_SCHEDULE_BYTES) {
    return { error: "Zamanlama deposu dolu (800 KB); bekleyen bir kaydı iptal edin." };
  }

  const note = String(label ?? "").trim().slice(0, 80) || "Zamanlı yayın";
  const entry: ScheduledEntry = {
    id: randomBytes(6).toString("hex"),
    surface: surface.id,
    label: note,
    cfg: valid.cfg,
    cfgHash: hashOf(valid.cfg),
    publishAt,
    unpublishAt,
    by: staff.id,
    byName: staff.full_name || staff.email,
    createdAt: new Date(nowMs).toISOString(),
    status: "bekliyor",
    note: "",
    prevLive: null,
    prevLiveHash: null,
  };
  const saved = await writeSchedule([...list, entry], staff.id);
  if (!saved.ok) return { error: saved.error };

  await logPlatformActivity({
    actorId: staff.id,
    action: "publishing.schedule",
    entityType: surface.id,
    entityId: entry.id,
    meta: { label: note, publishAt, unpublishAt, cfgHash: entry.cfgHash, overlap: clash.length },
  });
  refreshDesk();
  return { ok: true, warning: clash.length ? "Çakışmaya rağmen zamanlandı." : undefined };
}

/** Bekleyen zamanlamayı ya da yayındaki kaydın bitişte geri dönüşünü iptal eder (canlıya dokunmaz). */
export async function cancelScheduled(id: string): Promise<PublishingResult> {
  let list: ScheduledEntry[];
  try {
    list = await readScheduleStrict();
  } catch {
    return { error: "Zamanlama kayıtları okunamadı; tekrar deneyin." };
  }
  const entry = list.find((e) => e.id === String(id ?? ""));
  if (!entry) return { error: "Zamanlama bulunamadı." };
  const g = await gate(entry.surface, true);
  if ("error" in g) return { error: g.error };
  if (entry.status !== "bekliyor" && entry.status !== "yayinda") return { error: "Bu kayıt zaten tamamlanmış ya da iptal edilmiş." };

  const note =
    entry.status === "yayinda"
      ? `Bitişte geri dönüş ${g.staff.full_name || g.staff.email} tarafından iptal edildi; canlı olduğu gibi kalır`
      : `${g.staff.full_name || g.staff.email} tarafından iptal edildi`;
  const next = list.map((e) => (e.id === entry.id ? { ...e, status: "iptal" as const, note } : e));
  const saved = await writeSchedule(next, g.staff.id);
  if (!saved.ok) return { error: saved.error };

  await logPlatformActivity({
    actorId: g.staff.id,
    action: "publishing.cancel",
    entityType: entry.surface,
    entityId: entry.id,
    meta: { label: entry.label, previousStatus: entry.status },
  });
  refreshDesk();
  return { ok: true };
}

function toLines(a: unknown, b: unknown): Pick<DiffPreview, "rows" | "total" | "more"> {
  const d = diffJson(a, b);
  return {
    rows: d.rows.map((r) => ({ path: r.path, kind: r.kind, before: previewValue(r.before), after: previewValue(r.after) })),
    total: d.total,
    more: moreLabel(d.more),
  };
}

/** Taslak -> canlı farkı (canlı yoksa kod varsayılanı). Salt okuma. */
export async function previewDraftDiff(surfaceId: string): Promise<DiffPreview> {
  const g = await gate(surfaceId, false);
  if ("error" in g) return { error: g.error };
  const s = await g.surface.readState();
  if (!s.draft) return { ok: true, title: `${g.surface.label}: taslak yok`, rows: [], total: 0, more: "" };
  return { ok: true, title: `${g.surface.label}: canlı → taslak`, ...toLines(s.live ?? g.surface.defaults(), s.draft) };
}

/** "Bu sürüme dön" onayı: şu anki canlıdan seçilen sürüme geçince neyin değişeceği. Salt okuma. */
export async function previewVersionDiff(surfaceId: string, historyId: string): Promise<DiffPreview> {
  const g = await gate(surfaceId, false);
  if ("error" in g) return { error: g.error };
  const s = await g.surface.readState();
  const v = s.history.find((h) => h.id === String(historyId ?? ""));
  if (!v) return { error: "Sürüm bulunamadı." };
  return { ok: true, title: `${g.surface.label}: canlı → "${v.label}"`, ...toLines(s.live ?? g.surface.defaults(), v.cfg) };
}

/** Geçmişteki sürümü yeni yayın olarak canlıya alır (istemci önce previewVersionDiff ile farkı gösterir). */
export async function restoreVersion(surfaceId: string, historyId: string): Promise<PublishingResult> {
  const g = await gate(surfaceId, true);
  if ("error" in g) return { error: g.error };
  const { surface, staff } = g;
  const rl = await checkRateLimit(`publishing-restore:${staff.id}`, { limit: 20, windowSec: 600, failurePolicy: "deny" });
  if (!rl.allowed) return { error: "Çok sık işlem yaptınız; birkaç dakika sonra tekrar deneyin." };

  const res = await surface.restore(String(historyId ?? ""), staff.id, staff.full_name || staff.email);
  if (!res.ok) return { error: res.error };

  await logPlatformActivity({
    actorId: staff.id,
    action: "publishing.restore",
    entityType: surface.id,
    entityId: String(historyId),
    meta: { label: res.label, cfgHash: hashOf(res.cfg) },
  });
  refreshLive(surface);
  return { ok: true };
}
