import "server-only";
import { randomBytes } from "node:crypto";
import { now } from "@/lib/clock";
import { readPlatformSettingStrict } from "@/lib/platform-settings";
import type { PublishSurface, SurfaceState } from "@/lib/publishing/surfaces";
import { guideCategoryPath, guidePath, type GuideIndexEntry } from "./defaults";
import { guideHasErrors, validateGuide } from "./schema";
import { GUIDES_CACHE_TAG, guideLinkPaths, guideStore, publishGuideContent, readGuideIndexState, unpublishGuideEntry } from "./store";

/**
 * YAYIN MASASI yüzeyi (K5): rehber yazısı. Kayıt (surfaces.ts SURFACES) S2 dikişindedir; o zamana dek admin ekranı
 * kendi "Yayınla" eylemiyle (src/app/actions/site-guides.ts) aynı depo işlevlerine yazar. Yazı başına bir yüzey
 * nesnesi üretilir (`surfaceId: 'guide'`, `guideId`). Zamanlı yayın ve bitiş mevcut `yayin-zamanlayici` ile çalışır.
 *  - defaults(): null — yazının kod içi varsayılanı yoktur; "varsayılana dön" = yayından kaldır (durum arşiv).
 *  - publish: bugünkü kurallarla doğrular (hata kalıcıdır), canlıya alır, listeyi yayında işaretler.
 *  - restore: geçmişteki sürümü yeni yayın olarak alır.
 */

export type GuidePublishSurface = Omit<PublishSurface, "id"> & { surfaceId: "guide"; guideId: string };

const newEntry = (label: string, by: string) => ({ id: randomBytes(6).toString("hex"), at: new Date(now()).toISOString(), by, label: label.slice(0, 80) || "Yayın" });

/** Canlı değişince yeniden üretilecek herkese açık yollar. */
export function guideLivePaths(entry: Pick<GuideIndexEntry, "slug" | "category">): Array<{ path: string }> {
  return [{ path: "/rehber" }, { path: guidePath(entry.slug) }, { path: guideCategoryPath(entry.category) }, { path: "/rehber/rss.xml" }];
}

export function guidePublishSurface(entry: Pick<GuideIndexEntry, "id" | "slug" | "category" | "title">): GuidePublishSurface {
  const store = guideStore(entry.id);
  const surface: GuidePublishSurface = {
    surfaceId: "guide",
    guideId: entry.id,
    label: `Rehber: ${entry.title}`.slice(0, 80),
    module: "sitecontent",
    editorHref: `/admin/site/rehber/${entry.id}`,
    cacheTag: GUIDES_CACHE_TAG,
    livePaths: guideLivePaths(entry),
    defaults: () => null,
    async readState(): Promise<SurfaceState> {
      const s = await store.readState();
      return { live: s.live, draft: s.draft, history: s.history, updatedBy: s.history[0]?.by || null, updatedAt: s.history[0]?.at ?? null };
    },
    async readLiveStrict() {
      const row = await readPlatformSettingStrict(store.keys.live);
      return store.parseConfig(row?.value ?? null);
    },
    async validate(cfg) {
      const read = await readGuideIndexState();
      if (!read.ok) return { error: "Rehber listesi okunamadı." };
      const { guide, issues } = validateGuide(cfg, { extraPaths: guideLinkPaths(read.list, entry.id) });
      return guide && !guideHasErrors(issues) ? { cfg: guide } : { error: "Yazı bugünkü kurallara uymuyor." };
    },
    async publish(cfg, staffId, label, by, opts) {
      const v = await surface.validate(cfg);
      if ("error" in v) return { ok: false, error: v.error, permanent: v.error !== "Rehber listesi okunamadı." };
      const res = await publishGuideContent(entry.id, v.cfg as Parameters<typeof publishGuideContent>[1], newEntry(label, by ?? staffId), staffId, { keepDraft: opts?.keepDraft });
      return res.ok ? { ok: true } : { ok: false, error: res.error };
    },
    async resetToDefault(staffId, by) {
      const res = await unpublishGuideEntry(entry.id, staffId, by ?? staffId, new Date(now()).toISOString());
      return res.ok ? { ok: true } : { ok: false, error: res.error };
    },
    async restore(historyId, staffId, by) {
      const s = await store.readState();
      const version = s.history.find((h) => h.id === historyId);
      if (!version) return { ok: false, error: "Sürüm bulunamadı." };
      const res = await surface.publish(version.cfg, staffId, `Geri dönüş: ${version.label}`, by);
      return res.ok ? { ok: true, label: version.label, cfg: version.cfg } : { ok: false, error: res.error };
    },
  };
  return surface;
}

/** Kimlikle yüzey (liste okunamazsa ya da yazı yoksa null). */
export async function guidePublishSurfaceById(id: string): Promise<GuidePublishSurface | null> {
  const read = await readGuideIndexState();
  if (!read.ok) return null;
  const entry = read.list.find((e) => e.id === id);
  return entry ? guidePublishSurface(entry) : null;
}
