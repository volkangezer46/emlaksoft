import { unstable_cache } from "next/cache";
import { getPlatformSetting, readPlatformSettingStrict, setPlatformSetting } from "@/lib/platform-settings";
import { createVersionedStore, type EntryMeta, type StoreResult } from "@/lib/versioned-config/store";
import {
  GUIDE_CATEGORIES,
  guideCategoryPath,
  guidePath,
  parseGuideContent,
  parseGuideIndexStrict,
  sameGuide,
  type GuideContent,
  type GuideIndexEntry,
} from "./schema";

/**
 * Rehber depolaması (platform_settings, migration YOK; sayfa oluşturucu AP6 ile aynı kalıp):
 *   guides.index                 -> [{id, slug, title, category, status, publishedAt, firstPublishedAt, updatedAt, updatedBy}] (≤300)
 *   guide.<id>.live|draft|history -> ortak taslak/yayın/geçmiş (createVersionedStore)
 * Taslak canlıyı DEĞİŞTİRMEZ: herkese açık okuma yalnız `.live` + listedeki `yayinda` durumundan gelir.
 * Herkese açık okuma etiketli önbellekten (`guides`, 300 sn; yazımda updateTag). "Okunamadı" asla "kayıt yok" sayılmaz:
 * önbellekli okumalar hata FIRLATIR (boş sonuç önbelleğe girmez), yazmalar okunamayan/bozuk listeyi ezmez ve listeyi
 * sürüm kilidiyle yazar. 300 yazı sınırına yaklaşınca ayrı tablo kararı sahibe sorulur (defaults.ts notu).
 */

export const GUIDES_CACHE_TAG = "guides";
export const GUIDES_INDEX_KEY = "guides.index";

export const GUIDES_STORAGE_UNAVAILABLE =
  "Yazı kaydedilemedi: platform ayarları tablosuna yazılamadı. Veritabanı bağlantısını ve platform_settings tablosunu kontrol edin.";

export function guideStore(id: string) {
  return createVersionedStore<GuideContent>({
    prefix: `guide.${id}`,
    parseValue: parseGuideContent,
    unavailableMessage: GUIDES_STORAGE_UNAVAILABLE,
  });
}

export type GuideIndexRead = { ok: true; list: GuideIndexEntry[]; version: number | null } | { ok: false };

/** Önbelleksiz, sıkı liste okuması: kayıt yoksa boş liste (sürüm 0); okuma hatası veya bozuk liste `{ ok: false }`. */
export async function readGuideIndexState(): Promise<GuideIndexRead> {
  try {
    const row = await readPlatformSettingStrict(GUIDES_INDEX_KEY);
    if (!row) return { ok: true, list: [], version: 0 };
    if (row.value === null) return { ok: true, list: [], version: row.version };
    const list = parseGuideIndexStrict(JSON.parse(row.value));
    if (!list) {
      console.error("readGuideIndexState: rehber listesi doğrulanamadı");
      return { ok: false };
    }
    return { ok: true, list, version: row.version };
  } catch (e) {
    console.error("readGuideIndexState", e);
    return { ok: false };
  }
}

/** Yönetim ekranları için liste (yalnız gösterim; okunamazsa boş). Yazmalar readGuideIndexState kullanır. */
export async function readGuideIndex(): Promise<GuideIndexEntry[]> {
  const r = await readGuideIndexState();
  return r.ok ? r.list : [];
}

export type GuideIndexWrite = "ok" | "conflict" | "fail";

/** Listeyi okunduğu sürüme göre yazar (write_setting RPC, p_expected_version); arada yazma olduysa "conflict". */
export async function writeGuideIndex(list: readonly GuideIndexEntry[], staffId: string, expectedVersion: number | null): Promise<GuideIndexWrite> {
  const json = JSON.stringify(list);
  const out: { conflict?: boolean } = {};
  const meta = expectedVersion === null ? undefined : { expectedVersion, reason: "Rehber listesi", summary: `${list.length} yazı`, out };
  if (!(await setPlatformSetting(GUIDES_INDEX_KEY, json, staffId, meta))) return out.conflict ? "conflict" : "fail";
  return (await getPlatformSetting(GUIDES_INDEX_KEY)) === json ? "ok" : "fail";
}

/**
 * Rehberin iç bağlantı sayılan yolları: /rehber, kategori sayfaları ve listedeki YAYINDAKİ yazılar.
 * Taslak/arşiv yazının yolu canlıda 404'tür; kırık bağlantı uyarısı alsın diye dışarıda kalır
 * (editör, eylemler ve Yayın masası aynı kuralı bu tek yerden uygular).
 */
export function guideLinkPaths(index: readonly Pick<GuideIndexEntry, "id" | "slug" | "status">[], exceptId?: string): string[] {
  return ["/rehber", ...GUIDE_CATEGORIES.map(guideCategoryPath), ...index.filter((e) => e.id !== exceptId && e.slug && e.status === "yayinda").map((e) => guidePath(e.slug))];
}

export type GuidePublishResult = { ok: true; entry: GuideIndexEntry } | { ok: false; error: string; conflict?: boolean };

const INDEX_UNREADABLE = "Rehber listesi şu an okunamadı; mevcut yazıları korumak için kayıt yapılmadı. Biraz sonra tekrar deneyin.";
const INDEX_CONFLICT = "Rehber listesi bu arada başka bir oturumda değişti; sayfayı yenileyip tekrar deneyin.";

function indexError(r: GuideIndexWrite, fail: string): GuidePublishResult | null {
  if (r === "ok") return null;
  return r === "conflict" ? { ok: false, error: INDEX_CONFLICT, conflict: true } : { ok: false, error: fail };
}

/**
 * Doğrulanmış içeriği canlıya alır (geçmişe yazılır) ve listeyi yayında olarak işaretler: `publishedAt` = geçmiş
 * girdisinin `at`'i (sitemap lastmod), `firstPublishedAt` ilk yayında sabitlenir. Doğrulamayı ÇAĞIRAN yapar
 * (eylem ve Yayın masası yüzeyi). `keepDraft`: yayından önce editörde süren farklı taslak varsa geri yazılır
 * (zamanlı yayın editördeki işi silmesin).
 */
export async function publishGuideContent(id: string, content: GuideContent, meta: EntryMeta, staffId: string, opts: { keepDraft?: boolean } = {}): Promise<GuidePublishResult> {
  const read = await readGuideIndexState();
  if (!read.ok) return { ok: false, error: INDEX_UNREADABLE };
  const entry = read.list.find((e) => e.id === id);
  if (!entry) return { ok: false, error: "Yazı bulunamadı." };
  const store = guideStore(id);
  let keep: GuideContent | null = null;
  if (opts.keepDraft) {
    const before = await store.readState();
    if (before.draft && !sameGuide(before.draft, content) && !sameGuide(before.draft, before.live)) keep = before.draft;
  }
  const res: StoreResult = await store.publish(content, meta, staffId);
  if (!res.ok) return { ok: false, error: res.error };
  if (keep) await store.saveDraft(keep, staffId);
  const next: GuideIndexEntry = {
    ...entry,
    status: "yayinda",
    title: content.title,
    category: content.category,
    publishedAt: meta.at,
    firstPublishedAt: entry.firstPublishedAt ?? meta.at,
    updatedAt: meta.at,
    updatedBy: meta.by,
  };
  const err = indexError(
    await writeGuideIndex(read.list.map((e) => (e.id === id ? next : e)), staffId, read.version),
    "İçerik yayına yazıldı ama rehber listesi güncellenemedi; tekrar Yayınla'ya basın.",
  );
  return err ?? { ok: true, entry: next };
}

/** Yayından kaldırır (durum `arsiv`): yol 404 döner; canlı içerik ve geçmiş saklanır, yeniden yayınlanabilir. */
export async function unpublishGuideEntry(id: string, staffId: string, by: string, at: string): Promise<GuidePublishResult> {
  const read = await readGuideIndexState();
  if (!read.ok) return { ok: false, error: INDEX_UNREADABLE };
  const entry = read.list.find((e) => e.id === id);
  if (!entry) return { ok: false, error: "Yazı bulunamadı." };
  if (entry.status !== "yayinda") return { ok: true, entry };
  const next: GuideIndexEntry = { ...entry, status: "arsiv", updatedAt: at, updatedBy: by };
  const err = indexError(await writeGuideIndex(read.list.map((e) => (e.id === id ? next : e)), staffId, read.version), "Rehber listesi kaydedilemedi; tekrar deneyin.");
  return err ?? { ok: true, entry: next };
}

/** Önbellekli okumalar için: okunamazsa FIRLATIR (boş sonuç önbelleğe girmesin). */
async function readGuideIndexOrThrow(): Promise<GuideIndexEntry[]> {
  const r = await readGuideIndexState();
  if (!r.ok) throw new Error("Rehber listesi okunamadı.");
  return r.list;
}

/** Yayındaki yazıların liste girdileri (önbellekli; en yeni yayın başta). */
export const getPublishedGuideIndex = unstable_cache(
  async (): Promise<GuideIndexEntry[]> =>
    (await readGuideIndexOrThrow())
      .filter((e) => e.status === "yayinda" && e.slug && e.publishedAt)
      .sort((a, b) => (b.publishedAt ?? "").localeCompare(a.publishedAt ?? "")),
  ["guides-published-index-v1"],
  { tags: [GUIDES_CACHE_TAG], revalidate: 300 },
);

/** Bir yazının yayındaki içeriği (önbellekli; kimlik anahtarın parçası). Okuma hatasında FIRLATIR; bozuk içerik null. */
export const getLiveGuide = unstable_cache(
  async (id: string): Promise<GuideContent | null> => {
    const store = guideStore(id);
    const row = await readPlatformSettingStrict(store.keys.live);
    return store.parseConfig(row?.value ?? null);
  },
  ["guides-live-v1"],
  { tags: [GUIDES_CACHE_TAG], revalidate: 300 },
);

export type PublishedGuide = { entry: GuideIndexEntry; content: GuideContent };

/** Yayındaki tüm yazılar (liste, kategori, RSS, sitemap). Okuma hatasında FIRLATIR. */
export async function listPublishedGuides(): Promise<PublishedGuide[]> {
  const index = await getPublishedGuideIndex();
  const contents = await Promise.all(index.map((e) => getLiveGuide(e.id)));
  const out: PublishedGuide[] = [];
  index.forEach((entry, i) => {
    const content = contents[i];
    if (content) out.push({ entry, content });
  });
  return out;
}

/** `next build` önceden üretimi (veritabanı yok/sahte anahtar): herkese açık sayfa boş liste ile üretilir. */
export function isBuildPhase(): boolean {
  return process.env.NEXT_PHASE === "phase-production-build";
}

/**
 * Herkese açık sayfalar için: çalışma anında okuma hatası FIRLATILIR (ISR eski sayfayı sunmayı sürdürür, boş "Yakında"
 * önbelleğe girmez); yalnız derleme anında boş listeye düşülür.
 */
export async function listPublishedGuidesForPage(): Promise<PublishedGuide[]> {
  try {
    return await listPublishedGuides();
  } catch (e) {
    if (isBuildPhase()) return [];
    throw e;
  }
}
