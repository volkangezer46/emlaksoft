import "server-only";
import { randomBytes } from "node:crypto";
import { now } from "@/lib/clock";
import type { PlatformModule } from "@/lib/platform-access";
import { getPlatformSettingsMany } from "@/lib/platform-settings";
import { defaultSiteContent } from "@/lib/site-content/defaults";
import { hasErrors as contentHasErrors, validateSiteContent } from "@/lib/site-content/schema";
import { SITE_CONTENT_CACHE_TAG, siteContentStore } from "@/lib/site-content/store";
import { defaultSiteMenu } from "@/lib/site-menu/defaults";
import { hasErrors as menuHasErrors, siteMenuSchema, validateSiteMenu, type SiteMenuConfig } from "@/lib/site-menu/schema";
import {
  SITE_MENU_CACHE_TAG,
  SITE_MENU_STORAGE_UNAVAILABLE,
  pruneMedia,
  readAdminState as readMenuState,
  resetToDefault as resetMenuToDefault,
} from "@/lib/site-menu/store";
import type { GuidePublishSurface } from "@/lib/guides/publish-surface";
import { seoPublishSurface } from "@/lib/seo/publish-surface";
import { createVersionedStore, type HistoryEntry, type StoreResult } from "@/lib/versioned-config/store";
import { hashOf, type ScheduleWriteResult } from "./schedule";

/**
 * YAYIN MASASI yüzey bağdaştırıcıları (kayıt defteri): taslak/yayın/geçmiş akışı olan her yönetilen içerik burada
 * tek biçime indirgenir. Depolar YALNIZ dışa açık işlevleriyle kullanılır (editörlerin kendi dosyalarına dokunulmaz).
 * Yeni yüzey = SURFACES'e bir giriş (site menüsü, site içeriği, SEO sayfa ayarları; ör. marka sonraki turda).
 */

export type SurfaceId = "sitecontent" | "sitemenu" | "seo" | `guide:${string}`;

export type SurfaceState = {
  live: unknown | null;
  draft: unknown | null;
  history: HistoryEntry<unknown>[];
  /** Son yayın/geri dönüş (geçmişin ilk girdisi). */
  updatedBy: string | null;
  updatedAt: string | null;
};

export type RestoreResult = { ok: true; label: string; cfg: unknown } | { ok: false; error: string };

export type PublishSurface = {
  id: SurfaceId;
  label: string;
  module: PlatformModule;
  editorHref: string;
  cacheTag: string;
  /** Canlı değişince yeniden üretilecek public yollar. */
  livePaths: ReadonlyArray<{ path: string; type?: "layout" | "page" }>;
  defaults(): unknown;
  readState(): Promise<SurfaceState>;
  /** Canlı yapılandırma (yoksa null = kod varsayılanı). Okunamazsa HATA fırlatır: cron "okunamadı"yı "canlı yok" saymasın. */
  readLiveStrict(): Promise<unknown | null>;
  /** Yapılandırmayı bugünkü kurallarla doğrular; geçersizse hata. */
  validate(cfg: unknown): Promise<{ cfg: unknown } | { error: string }>;
  /**
   * Doğrular ve canlıya alır (geçmişe yazılır). Doğrulama hatası kalıcıdır (`permanent`).
   * `keepDraft`: depo yayında taslağı canlıya eşitler; zamanlı yayında editördeki daha yeni taslak kaybolmasın diye geri yazılır.
   */
  publish(cfg: unknown, staffId: string, label: string, by?: string, opts?: { keepDraft?: boolean }): Promise<ScheduleWriteResult>;
  /** Canlıyı siler: kod varsayılanına döner. `keepDraft`: publish'teki gibi editördeki bekleyen taslak korunur. */
  resetToDefault(staffId: string, by?: string, opts?: { keepDraft?: boolean }): Promise<StoreResult>;
  /** Geçmişteki bir sürümü yeni yayın olarak canlıya alır. */
  restore(historyId: string, staffId: string, by?: string): Promise<RestoreResult>;
};

const newEntry = (label: string, by: string) => ({ id: randomBytes(6).toString("hex"), at: new Date(now()).toISOString(), by, label: label.slice(0, 80) });

/** Yayından önceki taslak canlıdan ve yayınlanandan farklıysa (editörde süren iş) yayından sonra geri yazılacak taslak. */
function pendingDraft(before: { live: unknown | null; draft: unknown | null }, cfg: unknown, defaults: unknown): unknown | null {
  if (!before.draft) return null;
  const h = hashOf(before.draft);
  return h !== hashOf(cfg) && h !== hashOf(before.live ?? defaults) ? before.draft : null;
}

/** Tek anahtarı sıkı okur (PostgREST hatası/istisna fırlar) ve yüzeyin ayrıştırıcısından geçirir. */
async function readLiveKey(key: string, parse: (raw: string | null) => unknown | null): Promise<unknown | null> {
  const row = await getPlatformSettingsMany([key], { strict: true });
  return parse(row[key] ?? null);
}

/**
 * Site menüsü yayını için ortak taslak/yayın/geçmiş kalıbı: src/lib/site-menu/store.ts ile AYNI anahtarlar
 * (sitemenu.live|draft|history), aynı yazma sırası ve geçmiş sınırları. Menü deposunun publishConfig'i taslağı cfg'ye
 * eşitledikten hemen sonra medyayı budar; zamanlı yayında editördeki bekleyen taslak geri yazılmadan ÖNCE onun medyası
 * silinirdi. Burada budama (pruneMedia) taslak geri yazıldıktan SONRA yapılır.
 */
const menuStore = createVersionedStore<SiteMenuConfig>({
  prefix: "sitemenu",
  parseValue: (v) => {
    const r = siteMenuSchema.safeParse(v);
    return r.success ? r.data : null;
  },
  unavailableMessage: SITE_MENU_STORAGE_UNAVAILABLE,
});

function withMeta(live: unknown | null, draft: unknown | null, history: HistoryEntry<unknown>[]): SurfaceState {
  return { live, draft, history, updatedBy: history[0]?.by || null, updatedAt: history[0]?.at ?? null };
}

const siteContent: PublishSurface = {
  id: "sitecontent",
  label: "Site içeriği",
  module: "sitecontent",
  editorHref: "/admin/site-icerik",
  cacheTag: SITE_CONTENT_CACHE_TAG,
  livePaths: [{ path: "/" }, { path: "/kayit" }],
  defaults: defaultSiteContent,
  async readState() {
    const s = await siteContentStore.readState();
    return withMeta(s.live, s.draft, s.history);
  },
  readLiveStrict: () => readLiveKey(siteContentStore.keys.live, siteContentStore.parseConfig),
  async validate(cfg) {
    const { config, issues } = validateSiteContent(cfg);
    return config && !contentHasErrors(issues) ? { cfg: config } : { error: "İçerik bugünkü kurallara uymuyor." };
  },
  async publish(cfg, staffId, label, by, opts) {
    const v = await this.validate(cfg);
    if ("error" in v) return { ok: false, error: v.error, permanent: true };
    const keep = opts?.keepDraft ? pendingDraft(await siteContentStore.readState(), v.cfg, defaultSiteContent()) : null;
    const res = await siteContentStore.publish(v.cfg as Parameters<typeof siteContentStore.publish>[0], newEntry(label, by ?? staffId), staffId);
    if (res.ok && keep) await siteContentStore.saveDraft(keep as Parameters<typeof siteContentStore.saveDraft>[0], staffId);
    return res;
  },
  async resetToDefault(staffId, by, opts) {
    const defaults = defaultSiteContent();
    const keep = opts?.keepDraft ? pendingDraft(await siteContentStore.readState(), defaults, defaults) : null;
    const e = newEntry("", by ?? staffId);
    const res = await siteContentStore.resetToDefault({ id: e.id, at: e.at, by: e.by }, staffId);
    if (res.ok && keep) await siteContentStore.saveDraft(keep as Parameters<typeof siteContentStore.saveDraft>[0], staffId);
    return res;
  },
  async restore(historyId, staffId, by) {
    const s = await siteContentStore.readState();
    const version = s.history.find((h) => h.id === historyId);
    if (!version) return { ok: false, error: "Sürüm bulunamadı." };
    const label = `Geri dönüş: ${version.label}`;
    const res = await this.publish(version.cfg, staffId, label, by);
    return res.ok ? { ok: true, label: version.label, cfg: version.cfg } : { ok: false, error: res.error };
  },
};

/**
 * Menü yayını/varsayılana dönüşten sonra: bekleyen taslak varsa önce geri yazılır, SONRA kullanılmayan medya budanır
 * (taslağın medyası "kullanılan" sayılır). Taslak yazılamazsa budama atlanır: medyası silinmesin, bir sonraki yayın budar.
 */
async function restoreDraftThenPrune(res: StoreResult, keep: unknown | null, staffId: string): Promise<StoreResult> {
  if (keep && !(await menuStore.saveDraft(keep as SiteMenuConfig, staffId)).ok) return res;
  await pruneMedia(staffId);
  return res;
}

const siteMenu: PublishSurface = {
  id: "sitemenu",
  label: "Site menüsü",
  module: "sitemenu",
  editorHref: "/admin/site-menu",
  cacheTag: SITE_MENU_CACHE_TAG,
  livePaths: [{ path: "/", type: "layout" }],
  defaults: defaultSiteMenu,
  async readState() {
    const s = await readMenuState();
    return withMeta(s.live, s.draft, s.history);
  },
  readLiveStrict: () => readLiveKey(menuStore.keys.live, menuStore.parseConfig),
  async validate(cfg) {
    const { media } = await readMenuState();
    const { config, issues } = validateSiteMenu(cfg, { media });
    return config && !menuHasErrors(issues)
      ? { cfg: config }
      : { error: "Menüdeki bazı medya dosyaları artık yok ya da kurallar değişti." };
  },
  async publish(cfg, staffId, label, by, opts) {
    const v = await this.validate(cfg);
    if ("error" in v) return { ok: false, error: v.error, permanent: true };
    const keep = opts?.keepDraft ? pendingDraft(await menuStore.readState(), v.cfg, defaultSiteMenu()) : null;
    const res = await menuStore.publish(v.cfg as SiteMenuConfig, newEntry(label, by ?? staffId), staffId);
    return res.ok ? restoreDraftThenPrune(res, keep, staffId) : res;
  },
  async resetToDefault(staffId, by, opts) {
    const defaults = defaultSiteMenu();
    const keep = opts?.keepDraft ? pendingDraft(await menuStore.readState(), defaults, defaults) : null;
    const e = newEntry("", by ?? staffId);
    const res = await resetMenuToDefault({ id: e.id, at: e.at, by: e.by }, staffId);
    return res.ok ? restoreDraftThenPrune(res, keep, staffId) : res;
  },
  async restore(historyId, staffId, by) {
    const s = await readMenuState();
    const version = s.history.find((h) => h.id === historyId);
    if (!version) return { ok: false, error: "Sürüm bulunamadı." };
    const res = await this.publish(version.cfg, staffId, `Geri dönüş: ${version.label}`, by);
    return res.ok ? { ok: true, label: version.label, cfg: version.cfg } : { ok: false, error: res.error };
  },
};

/**
 * SEO sayfa ayarları (S2 dikişi): SP2'nin taslak/yayın/geçmiş yüzeyi (`seo/publish-surface.ts`). `livePaths` yayından
 * SONRA bilinir (son yayında değişen sayfalar); bu yüzden getter olarak bağlanır, kopyalanmaz.
 */
const seoPages: PublishSurface = {
  id: "seo",
  label: seoPublishSurface.label,
  module: seoPublishSurface.module,
  editorHref: seoPublishSurface.editorHref,
  cacheTag: seoPublishSurface.cacheTag,
  get livePaths() {
    return seoPublishSurface.livePaths;
  },
  defaults: () => seoPublishSurface.defaults(),
  readState: () => seoPublishSurface.readState(),
  readLiveStrict: () => seoPublishSurface.readLiveStrict(),
  validate: (cfg) => seoPublishSurface.validate(cfg),
  publish: (cfg, staffId, label, by, opts) => seoPublishSurface.publish(cfg, staffId, label, by, opts),
  resetToDefault: (staffId, by, opts) => seoPublishSurface.resetToDefault(staffId, by, opts),
  restore: (historyId, staffId, by) => seoPublishSurface.restore(historyId, staffId, by),
};

/**
 * Sabit yüzeyler (toplu yayın ve Otopilot YALNIZ bunları yayınlar). Rehber yazıları yazı başına DİNAMİK yüzeydir
 * (`guide:<id>`): Yayın masasında zamanlanır, önizlenir, hemen yayınlanır ve sürüme dönülür; ama "tümünü yayınla"
 * ve Otopilot onlara dokunmaz (yayına hazır olmayan yazı toplu yayınla canlıya çıkmasın).
 */
export const SURFACES: readonly PublishSurface[] = [siteMenu, siteContent, seoPages];

export function surfaceById(id: string): PublishSurface | null {
  return SURFACES.find((s) => s.id === id) ?? null;
}

const GUIDE_SURFACE_RE = /^guide:([a-f0-9]{12})$/;

export const guideSurfaceId = (guideId: string): SurfaceId => `guide:${guideId}`;

function asGuideSurface(g: GuidePublishSurface): PublishSurface {
  const { surfaceId: _s, guideId, ...rest } = g;
  return { ...rest, id: guideSurfaceId(guideId) };
}

/** Kimlikten yüzey: sabit yüzeyler ya da rehber yazısı (`guide:<id>`; liste okunamazsa ya da yazı yoksa null). */
export async function resolveSurface(id: string): Promise<PublishSurface | null> {
  const fixed = surfaceById(id);
  if (fixed) return fixed;
  const m = GUIDE_SURFACE_RE.exec(id);
  if (!m) return null;
  const { guidePublishSurfaceById } = await import("@/lib/guides/publish-surface");
  const g = await guidePublishSurfaceById(m[1]!);
  return g ? asGuideSurface(g) : null;
}

/**
 * Yayın masasında listelenecek rehber yazıları: bekleyen taslağı olabilecekler (son kayıt yayından yeni ya da hiç
 * yayınlanmamış, arşiv değil) ve açık zamanlaması olanlar; en yeni 20. Asıl "taslak var mı" kararı masada state ile verilir.
 */
export async function deskGuideSurfaces(scheduledIds: readonly string[] = []): Promise<PublishSurface[]> {
  const [{ readGuideIndexState }, { guidePublishSurface }] = await Promise.all([import("@/lib/guides/store"), import("@/lib/guides/publish-surface")]);
  const read = await readGuideIndexState();
  if (!read.ok) return [];
  const wanted = new Set(scheduledIds.map((s) => GUIDE_SURFACE_RE.exec(s)?.[1]).filter((x): x is string => Boolean(x)));
  const pending = (e: (typeof read.list)[number]) => e.status !== "arsiv" && (!e.publishedAt || Date.parse(e.updatedAt) > Date.parse(e.publishedAt));
  return read.list
    .filter((e) => wanted.has(e.id) || pending(e))
    .sort((a, b) => Date.parse(b.updatedAt) - Date.parse(a.updatedAt))
    .slice(0, 20)
    .map((e) => asGuideSurface(guidePublishSurface(e)));
}
