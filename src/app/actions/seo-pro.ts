"use server";

import { revalidatePath, updateTag } from "next/cache";
import { requirePlatformModule, type PlatformStaff } from "@/lib/platform";
import { logPlatformActivity } from "@/lib/platform-activity";
import { checkRateLimit } from "@/lib/rate-limit";
import { HUB_CACHE_TAG } from "@/lib/seo/hubs/data";
import { HUB_LEVELS, HUB_MIN_LISTINGS, HubSettingsSchema, type HubLevel } from "@/lib/seo/schema";
import { SITEMAP_CACHE_TAG } from "@/lib/seo/sitemap-data";
import { SEO_CACHE_TAG, readHubSettings, writeSeoSetting } from "@/lib/seo/store";

/**
 * SEO merkezi (gelişmiş) eylemleri: programatik bölge sayfası ayarları, sayfa kapatma, puanı yeniden hesaplama ve
 * sitemap tazeleme. Ayar yazan her eylem yalnız SÜPER ADMİN (public yüzey açar/kapatır); hepsi hız sınırlı ve
 * etkinlik günlüğüne düşer. Ayar değişikliği SEO geçmişine yazılır (seo.hubs; tek tıkla geri alınır).
 */

export type SeoProResult = { ok?: boolean; error?: string; message?: string };

async function gate(superOnly: boolean): Promise<{ staff: PlatformStaff } | { error: string }> {
  const staff = await requirePlatformModule("seo");
  if (superOnly && staff.role !== "super_admin") return { error: "Bu ayar yalnız süper admin tarafından değiştirilebilir (herkese açık sayfa açar/kapatır)." };
  const rl = await checkRateLimit(`seo-pro:${staff.id}`, { limit: 40, windowSec: 600, failurePolicy: "deny" });
  if (!rl.allowed) return { error: "Çok sık işlem yaptınız; birkaç dakika sonra tekrar deneyin." };
  return { staff };
}

function refreshHubs() {
  updateTag(SEO_CACHE_TAG);
  updateTag(HUB_CACHE_TAG);
  updateTag(SITEMAP_CACHE_TAG);
  revalidatePath("/admin/site/seo");
  revalidatePath("/emlak", "layout");
  revalidatePath("/sitemap.xml");
}

export async function saveHubSettings(fd: FormData): Promise<SeoProResult> {
  const g = await gate(true);
  if ("error" in g) return g;
  const cur = await readHubSettings();
  const min = Number(fd.get("minListings"));
  const levels = HUB_LEVELS.filter((l) => fd.get(`level_${l}`) === "on") as HubLevel[];
  const next = {
    ...cur,
    enabled: fd.get("enabled") === "on",
    minListings: Number.isInteger(min) ? Math.max(HUB_MIN_LISTINGS.min, Math.min(HUB_MIN_LISTINGS.max, min)) : cur.minListings,
    levels: levels.length > 0 ? levels : cur.levels,
    roomIntents: fd.get("roomIntents") === "on",
    listingLinks: fd.get("listingLinks") === "on",
  };
  const res = await writeSeoSetting("hubs", HubSettingsSchema, next, g.staff.id, g.staff.full_name);
  if (!res.ok) return { error: res.error };
  await logPlatformActivity({ actorId: g.staff.id, action: "seo.hubs.save", entityType: "seo", entityId: "hubs", meta: { enabled: next.enabled, minListings: next.minListings, levels: next.levels } });
  refreshHubs();
  return { ok: true, message: next.enabled ? "Programatik sayfalar açık; eşiği geçenler sitemap'e girer." : "Programatik sayfalar kapalı (tüm /emlak yolları 404)." };
}

export async function toggleHubPath(fd: FormData): Promise<SeoProResult> {
  const g = await gate(true);
  if ("error" in g) return g;
  const path = String(fd.get("path") ?? "");
  if (!/^\/emlak\/[a-z0-9/-]{1,190}$/.test(path)) return { error: "Geçersiz sayfa yolu." };
  const cur = await readHubSettings();
  const off = cur.disabledPaths.includes(path);
  const disabledPaths = off ? cur.disabledPaths.filter((p) => p !== path) : [...cur.disabledPaths, path];
  const res = await writeSeoSetting("hubs", HubSettingsSchema, { ...cur, disabledPaths }, g.staff.id, g.staff.full_name);
  if (!res.ok) return { error: res.error };
  await logPlatformActivity({ actorId: g.staff.id, action: off ? "seo.hubs.enable_path" : "seo.hubs.disable_path", entityType: "seo", entityId: path });
  refreshHubs();
  return { ok: true, message: off ? `${path} yeniden açıldı.` : `${path} kapatıldı (404, sitemap dışı).` };
}

export async function recomputeSeoScore(): Promise<SeoProResult> {
  const g = await gate(false);
  if ("error" in g) return g;
  const { recordSeoScores } = await import("@/lib/seo/score-runner");
  const state = await recordSeoScores();
  if (!state) return { error: "Puan için robot verisi yok: önce Teknik tarama > Denetim robotunu çalıştırın." };
  await logPlatformActivity({ actorId: g.staff.id, action: "seo.score.recompute", entityType: "seo", entityId: "score", meta: { total: state.site.total, pages: state.site.pages } });
  revalidatePath("/admin/site/seo");
  return { ok: true, message: `SEO puanı yeniden hesaplandı: ${state.site.total}/100 (${state.site.pages} sayfa).` };
}

export async function refreshSitemapNow(): Promise<SeoProResult> {
  const g = await gate(true);
  if ("error" in g) return g;
  updateTag(SITEMAP_CACHE_TAG);
  revalidatePath("/sitemap.xml");
  await logPlatformActivity({ actorId: g.staff.id, action: "seo.sitemap.refresh", entityType: "seo", entityId: "sitemap" });
  return { ok: true, message: "Sitemap önbelleği temizlendi; bir sonraki istekte yeniden üretilir." };
}
