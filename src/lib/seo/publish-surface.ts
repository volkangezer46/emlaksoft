import { randomBytes } from "node:crypto";
import { now } from "@/lib/clock";
import { getPlatformSettingsMany } from "@/lib/platform-settings";
import type { PublishSurface, SurfaceState } from "@/lib/publishing/surfaces";
import { createVersionedStore, type StoreResult } from "@/lib/versioned-config/store";
import { PagesSchema, SEO_KEYS, safeParse, type SeoPageOverride, type SeoPages } from "./schema";
import { SEO_CACHE_TAG, writeSeoSetting } from "./store";

/**
 * SEO YAYIN YÜZEYİ (K5): sayfa SEO geçersiz kılmaları (seo.pages) için taslak / yayın / geçmiş.
 *  - Taslak ve sürüm geçmişi AYRI anahtarda: `seo.overrides.draft|history` (createVersionedStore; `.live` yalnız aynadır).
 *  - CANLI tek kaynak değişmez: `seo.pages` (buildMetadata, sitemap). Yayın oraya `writeSeoSetting` ile yazar; böylece
 *    `seo.history` halkası (history.ts) da dolar ve SEO Geçmiş sekmesinden geri dönüş çalışmaya devam eder.
 *  - TASLAK BİR FARKTIR (patch): `seo.overrides.draft` yalnız taslakta değiştirilen sayfa/alanları tutar, tam harita
 *    DEĞİL. Okurken (`readState`) her seferinde GÜNCEL canlının üstüne uygulanır; böylece taslak açıkken yapılan doğrudan
 *    kayıt (`saveSeoPage`) bayat bir tam haritayla ezilmez ve hayalet "yayınlanmamış taslak" görünmez.
 *  - Mevcut doğrudan kaydetme (`saveSeoPage`) KORUNUR. Canlı doğrudan kayıtla değiştiyse bir sonraki yayın önce o
 *    canlıyı geçmişe "önceki canlı" olarak yazar: geri dönüş her zaman yayın öncesi değere ulaşır.
 *  - Yayından ve taslağı atmadan sonra fark BOŞALTILIR (zamanlı yayında yalnız henüz canlıya geçmemiş alanlar kalır).
 *  - Yüzey kaydı (SURFACES listesi, SurfaceId birleşimi) S2 dikişindedir; burada yalnız nesne dışa verilir.
 */

export const SEO_OVERRIDES_PREFIX = "seo.overrides";
const UNAVAILABLE = "SEO taslağı kaydedilemedi: platform ayarları tablosuna yazılamadı.";

const parsePages = (v: unknown): SeoPages | null => {
  const r = PagesSchema.safeParse(v);
  return r.success ? r.data : null;
};

export const seoOverridesStore = createVersionedStore<SeoPages>({ prefix: SEO_OVERRIDES_PREFIX, parseValue: parsePages, unavailableMessage: UNAVAILABLE });

/** Karşılaştırma imzası: updatedAt hariç alanlar, anahtar sırasından bağımsız. */
const withoutStamp = (o: SeoPageOverride | undefined): string =>
  o
    ? JSON.stringify(
        Object.entries(o)
          .filter(([k]) => k !== "updatedAt")
          .sort(([a], [b]) => a.localeCompare(b)),
      )
    : "";

/** Değişen sayfa yolları (SAF; updatedAt farkı değişiklik sayılmaz). */
export function changedPagePaths(before: SeoPages, after: SeoPages): string[] {
  const keys = new Set([...Object.keys(before), ...Object.keys(after)]);
  return [...keys].filter((k) => withoutStamp(before[k]) !== withoutStamp(after[k])).sort();
}

/** Değişen sayfalara `updatedAt` (sitemap lastmod kaynağı) yazar; değişmeyenler önceki zamanını korur (SAF). */
export function stampUpdated(before: SeoPages, after: SeoPages, atIso: string): SeoPages {
  const changed = new Set(changedPagePaths(before, after));
  const out: SeoPages = {};
  for (const [path, ov] of Object.entries(after)) {
    out[path] = changed.has(path) ? { ...ov, updatedAt: atIso } : { ...ov, updatedAt: before[path]?.updatedAt ?? ov.updatedAt };
    if (out[path]!.updatedAt === undefined) delete out[path]!.updatedAt;
  }
  return out;
}

async function readLivePages(strict: boolean): Promise<SeoPages> {
  const row = await getPlatformSettingsMany([SEO_KEYS.pages], strict ? { strict: true } : undefined);
  return safeParse(PagesSchema, row[SEO_KEYS.pages] ?? null) ?? {};
}

const entryMeta = (label: string, by: string) => ({
  id: randomBytes(6).toString("hex"),
  at: new Date(now()).toISOString(),
  by,
  label: label.slice(0, 80),
});

type DraftField = "title" | "description" | "ogTitle" | "ogDescription";
const DRAFT_FIELDS: readonly DraftField[] = ["title", "description", "ogTitle", "ogDescription"];

/** Farkın canlıyla AYNI olan alanlarını atar; boş sayfalar düşer (SAF). Yalnız taslak alanları taşınır. */
export function pruneDraftPatch(patch: SeoPages, live: SeoPages): SeoPages {
  const out: SeoPages = {};
  for (const [path, ov] of Object.entries(patch)) {
    const kept: SeoPageOverride = {};
    for (const f of DRAFT_FIELDS) {
      const v = ov[f];
      if (typeof v === "string" && v !== live[path]?.[f]) kept[f] = v;
    }
    if (Object.keys(kept).length > 0) out[path] = kept;
  }
  return out;
}

/** Farkı canlının üstüne uygular (SAF). Fark boşsa (canlıyla aynıysa) null: yayınlanacak taslak yok. */
export function applyDraftPatch(live: SeoPages, patch: SeoPages | null): SeoPages | null {
  const p = pruneDraftPatch(patch ?? {}, live);
  if (Object.keys(p).length === 0) return null;
  const out: SeoPages = { ...live };
  for (const [path, ov] of Object.entries(p)) out[path] = { ...(live[path] ?? {}), ...ov };
  return out;
}

/** Bir sayfanın tek alanını TASLAĞA (farka) yazar (canlı değişmez). Canlıyla aynı değer farktan düşer. */
export async function draftSeoPageField(
  path: string,
  field: DraftField,
  value: string,
  staffId: string,
): Promise<StoreResult & { before?: string | null }> {
  const [state, live] = await Promise.all([seoOverridesStore.readState(), readLivePages(false)]);
  const patch = pruneDraftPatch(state.draft ?? {}, live);
  const before = patch[path]?.[field] ?? live[path]?.[field] ?? null;
  const next = pruneDraftPatch({ ...patch, [path]: { ...(patch[path] ?? {}), [field]: value } }, live);
  if (!parsePages(next) || !parsePages(applyDraftPatch(live, next) ?? live)) return { ok: false, error: "Taslak SEO kurallarına uymuyor." };
  const res = await seoOverridesStore.saveDraft(next, staffId);
  return res.ok ? { ok: true, before } : res;
}

/** Bekleyen taslak farkını atar (canlı değişmez). */
export async function discardSeoDraftPatch(staffId: string): Promise<StoreResult> {
  return seoOverridesStore.saveDraft({}, staffId);
}

/** Son yayında değişen yollar (afterPublish `livePaths`). Süreç içi; yayın öncesi tüm geçersiz kılınan sayfalar. */
let lastChanged: string[] = [];

export const seoPublishSurface: Omit<PublishSurface, "id"> & { surfaceId: "seo" } = {
  surfaceId: "seo",
  label: "SEO sayfa ayarları",
  module: "seo",
  editorHref: "/admin/seo?sekme=sayfalar",
  cacheTag: SEO_CACHE_TAG,
  get livePaths() {
    return lastChanged.map((path) => ({ path }));
  },
  defaults: () => ({}),
  async readState(): Promise<SurfaceState> {
    const [s, live] = await Promise.all([seoOverridesStore.readState(), readLivePages(false)]);
    // Taslak = güncel canlı + fark (fark yoksa null).
    return { live, draft: applyDraftPatch(live, s.draft), history: s.history, updatedBy: s.history[0]?.by || null, updatedAt: s.history[0]?.at ?? null };
  },
  readLiveStrict: () => readLivePages(true),
  async validate(cfg) {
    const pages = parsePages(cfg);
    return pages ? { cfg: pages } : { error: "SEO sayfa ayarları bugünkü kurallara uymuyor." };
  },
  async publish(cfg, staffId, label, by, opts) {
    const pages = parsePages(cfg);
    if (!pages) return { ok: false, error: "SEO sayfa ayarları bugünkü kurallara uymuyor.", permanent: true };
    const [state, live] = await Promise.all([seoOverridesStore.readState(), readLivePages(true)]);
    const author = by ?? staffId;
    // Canlı doğrudan kayıtla değiştiyse önce o hâl geçmişe girer (geri dönüş yayın öncesine ulaşabilsin).
    const head = state.history[0]?.cfg;
    if (Object.keys(live).length > 0 && (!head || changedPagePaths(head, live).length > 0)) {
      const pre = await seoOverridesStore.publish(live, entryMeta("Önceki canlı (doğrudan kayıt)", author), staffId);
      if (!pre.ok) return pre;
    }
    const stamped = stampUpdated(live, pages, new Date(now()).toISOString());
    const res = await seoOverridesStore.publish(stamped, entryMeta(label || "SEO yayını", author), staffId);
    if (!res.ok) return res;
    const wrote = await writeSeoSetting("pages", PagesSchema, stamped, staffId, by ?? null);
    if (!wrote.ok) return { ok: false, error: wrote.error };
    lastChanged = changedPagePaths(live, stamped);
    // store.publish taslağa TAM haritayı yazdı; fark modelinde taslak boşaltılır. Zamanlı yayında editördeki henüz
    // canlıya geçmemiş alanlar (fark) korunur.
    const rest = opts?.keepDraft ? pruneDraftPatch(state.draft ?? {}, stamped) : {};
    const cleared = await seoOverridesStore.saveDraft(rest, staffId);
    if (!cleared.ok) return cleared;
    return { ok: true };
  },
  async resetToDefault(staffId, by) {
    const res = await this.publish({}, staffId, "Varsayılana dönüş", by);
    return res.ok ? { ok: true } : { ok: false, error: res.error };
  },
  async restore(historyId, staffId, by) {
    const s = await seoOverridesStore.readState();
    const version = s.history.find((h) => h.id === historyId);
    if (!version) return { ok: false, error: "Sürüm bulunamadı." };
    const res = await this.publish(version.cfg, staffId, `Geri dönüş: ${version.label}`, by);
    return res.ok ? { ok: true, label: version.label, cfg: version.cfg } : { ok: false, error: res.error };
  },
};
