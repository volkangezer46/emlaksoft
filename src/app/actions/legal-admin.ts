"use server";

import { revalidatePath, updateTag } from "next/cache";
import { afterSafe } from "@/lib/after-safe";
import { getBaseUrl } from "@/lib/base-url";
import { trDayKey } from "@/lib/clock";
import { fetchOwnOriginInspect, readExternalText } from "@/lib/external-fetch";
import { isLegalKey, isDayKey } from "@/lib/legal-constants/history";
import { deleteFutureLegalConstant, insertLegalConstant, LEGAL_CONSTANTS_TAG } from "@/lib/legal-constants/store";
import { isLegalDocSlug, legalDocTitle, convertLegalHtml, lintLegalMarkup, LEGAL_DOCS, LEGAL_LIMITS, type LegalDocSlug } from "@/lib/legal-docs/core";
import {
  archivePublishedLegal,
  deleteLegalDraft,
  insertCodeSnapshot,
  readLegalOverview,
  LEGAL_DOCS_TAG,
  publishLegalDraft,
  readLegalDocVersions,
  restoreLegalVersion,
  upsertLegalDraft,
} from "@/lib/legal-docs/store";
import { logPlatformActivity } from "@/lib/platform-activity";
import { guardPlatformAction } from "@/lib/platform-guards";
import { captureLiveDigests, runAfterPublish } from "@/lib/publishing/after-publish";

/**
 * Yasal belgeler ve mevzuat sabitleri yönetimi (AD12). Modül `sistem`; YAZMA yalnız süper admin (yasal metin sorumluluğu
 * şirket sahibindedir). Her yazma `logPlatformActivity`'ye düşer. Yayın: önbellek etiketi + sayfa yolu tazelenir ve
 * yayın sonrası zinciri (statik sayfa tazeleme, doğrulama) çalışır; deploy gerekmez.
 */
type Result = { ok: true; message?: string; version?: number } | { ok: false; error: string };

const RATE = { key: "legal-admin", limit: 40, windowSec: 600 } as const;
const GATE = { module: "sistem", roles: ["super_admin"], rate: RATE } as const;

function refresh(slug: LegalDocSlug) {
  try {
    updateTag(LEGAL_DOCS_TAG);
  } catch {
    /* eylem dışı bağlam: 5 dk önbellek süresi yeter */
  }
  revalidatePath(`/${slug}`);
  revalidatePath("/admin/ayarlar/yasal");
  revalidatePath(`/admin/ayarlar/yasal/${slug}`);
}

const clip = (v: unknown, max: number) => String(v ?? "").slice(0, max);

export type LegalDraftForm = { title: string; intro: string; body: string; requiresReconsent: boolean; changeNote: string };

/** Taslağı kaydeder (yoksa yeni sürüm numarasıyla açar). Yayındaki metin değişmez. */
export async function saveLegalDraftAction(slug: string, form: LegalDraftForm): Promise<Result> {
  const g = await guardPlatformAction(GATE);
  if ("error" in g) return { ok: false, error: g.error };
  if (!isLegalDocSlug(slug)) return { ok: false, error: "Belge bulunamadı." };
  const title = clip(form.title, LEGAL_LIMITS.titleMax + 1).trim();
  const intro = clip(form.intro, LEGAL_LIMITS.introMax + 1).trim();
  const body = clip(form.body, LEGAL_LIMITS.bodyMax + 1);
  const note = clip(form.changeNote, LEGAL_LIMITS.noteMax + 1).trim();
  if (!title) return { ok: false, error: "Başlık zorunlu." };
  if (title.length > LEGAL_LIMITS.titleMax || intro.length > LEGAL_LIMITS.introMax || body.length > LEGAL_LIMITS.bodyMax || note.length > LEGAL_LIMITS.noteMax) {
    return { ok: false, error: "Metin sınırı aşıldı (başlık 200, giriş 1000, değişiklik notu 500 karakter)." };
  }
  if (!body.trim()) return { ok: false, error: "Belge metni boş olamaz." };
  const r = await upsertLegalDraft(slug, { title, intro, body, requiresReconsent: form.requiresReconsent === true, changeNote: note || null }, g.staff.id);
  if (!r.ok) return r;
  await logPlatformActivity({ actorId: g.staff.id, action: "legal_doc.draft_save", entityType: "legal_document", entityId: slug, meta: { version: r.version, reconsent: form.requiresReconsent === true, length: body.length } });
  revalidatePath(`/admin/ayarlar/yasal/${slug}`);
  return { ok: true, version: r.version, message: `Taslak v${r.version} kaydedildi.` };
}

/** Taslağı yayınlar. Biçim hatası varsa yayın reddedilir. "Yeniden onay gerekli" ise mevcut kullanıcılar sonraki girişte onaylar. */
export async function publishLegalDraftAction(slug: string): Promise<Result> {
  const g = await guardPlatformAction(GATE);
  if ("error" in g) return { ok: false, error: g.error };
  if (!isLegalDocSlug(slug)) return { ok: false, error: "Belge bulunamadı." };
  const versions = await readLegalDocVersions(slug);
  if (versions.status !== "ok") return { ok: false, error: versions.status === "missing" ? "Yasal belge tabloları henüz kurulmadı (migration bekliyor)." : "Okunamadı; tekrar deneyin." };
  const draft = versions.rows.find((r) => r.status === "draft");
  if (!draft) return { ok: false, error: "Yayınlanacak taslak yok." };
  const issues = lintLegalMarkup(draft.body);
  if (issues.length) return { ok: false, error: `Yayın öncesi düzeltin: ${issues.join(" ")}` };
  const beforeDigests = await captureLiveDigests([`/${slug}`]);
  const res = await publishLegalDraft(slug, g.staff.id);
  if (!res.ok) return res;
  await logPlatformActivity({ actorId: g.staff.id, action: "legal_doc.publish", entityType: "legal_document", entityId: slug, meta: { version: res.version, reconsent: res.requiresReconsent } });
  refresh(slug);
  afterSafe(() => runAfterPublish({ surface: "legal", kind: "publish", publishRef: `${slug}:v${res.version}`, livePaths: [`/${slug}`], actorId: g.staff.id, source: "staff", beforeDigests }), "yayın sonrası zinciri");
  return {
    ok: true,
    version: res.version,
    message: res.requiresReconsent
      ? `v${res.version} yayında. Mevcut kullanıcılar bir sonraki girişte yeni metni onaylayacak.`
      : `v${res.version} yayında.`,
  };
}

export async function deleteLegalDraftAction(slug: string): Promise<Result> {
  const g = await guardPlatformAction(GATE);
  if ("error" in g) return { ok: false, error: g.error };
  if (!isLegalDocSlug(slug)) return { ok: false, error: "Belge bulunamadı." };
  if (!(await deleteLegalDraft(slug))) return { ok: false, error: "Taslak silinemedi; tekrar deneyin." };
  await logPlatformActivity({ actorId: g.staff.id, action: "legal_doc.draft_delete", entityType: "legal_document", entityId: slug });
  revalidatePath(`/admin/ayarlar/yasal/${slug}`);
  return { ok: true, message: "Taslak silindi." };
}

type LivePage = { ok: true; title: string; body: string } | { ok: false; error: string };

/**
 * Yayındaki sayfanın HTML'i okunur ve işaretlemeye çevrilir. Çevrilemeyen görünür metin varsa (sessiz içerik kaybı
 * olmasın diye) hata döner.
 */
async function readLivePageMarkup(slug: LegalDocSlug): Promise<LivePage> {
  let html = "";
  try {
    const res = await fetchOwnOriginInspect(
      new URL(`/${slug}`, getBaseUrl()).toString(),
      { method: "GET", cache: "no-store", headers: { "User-Agent": "EmlakSoftYasalTaslak/1.0", Accept: "text/html" } },
      { timeoutMs: 8_000 },
    );
    if (res.status !== 200) return { ok: false, error: `Sayfa okunamadı (HTTP ${res.status}); boş taslakla başlayın.` };
    html = await readExternalText(res, 2_000_000);
  } catch {
    return { ok: false, error: "Sayfa okunamadı; boş taslakla başlayın." };
  }
  const { markup: body, dropped } = convertLegalHtml(html);
  if (!body) return { ok: false, error: "Sayfa metni ayrıştırılamadı; boş taslakla başlayın." };
  // Sessiz içerik kaybı yok: işaretlemeye çevrilemeyen görünür metin varsa taslak açılmaz.
  if (dropped.length) {
    return { ok: false, error: `Sayfada işaretlemeye çevrilemeyen içerik var (ör. "${dropped[0]}"); metni elle aktarın.` };
  }
  const title = /<h1\b[^>]*>([\s\S]*?)<\/h1>/i.exec(html)?.[1]?.replace(/<[^>]+>/g, "").trim() || legalDocTitle(slug);
  return { ok: true, title: title.slice(0, LEGAL_LIMITS.titleMax), body: body.slice(0, LEGAL_LIMITS.bodyMax) };
}

/**
 * Yayındaki sayfadan taslak başlatır: sayfanın HTML'i okunur, metin işaretlemeye çevrilir (koddaki sürüm v1 dahil).
 * Elle kopyalama yok; çıktı yazara taslak olarak gösterilir, yayından önce gözden geçirilir.
 */
export async function startLegalDraftFromLiveAction(slug: string): Promise<Result> {
  const g = await guardPlatformAction(GATE);
  if ("error" in g) return { ok: false, error: g.error };
  if (!isLegalDocSlug(slug)) return { ok: false, error: "Belge bulunamadı." };
  const versions = await readLegalDocVersions(slug);
  if (versions.status === "missing") return { ok: false, error: "Yasal belge tabloları henüz kurulmadı (migration bekliyor)." };
  if (versions.status === "ok" && versions.rows.some((r) => r.status === "draft")) return { ok: false, error: "Bu belgenin zaten bir taslağı var." };
  const page = await readLivePageMarkup(slug);
  if (!page.ok) return page;
  const r = await upsertLegalDraft(slug, { title: page.title, intro: "", body: page.body, requiresReconsent: false, changeNote: null }, g.staff.id);
  if (!r.ok) return r;
  await logPlatformActivity({ actorId: g.staff.id, action: "legal_doc.draft_from_live", entityType: "legal_document", entityId: slug, meta: { version: r.version, length: page.body.length } });
  revalidatePath(`/admin/ayarlar/yasal/${slug}`);
  return { ok: true, version: r.version, message: `Yayındaki metinden taslak v${r.version} açıldı. Giriş metni boş bırakılırsa koddaki giriş kullanılır.` };
}

/**
 * Koddaki 8 sayfayı DB'ye ARŞİV v1 olarak kaydeder (taşıma ilk adımı; yayın değişmez). Yalnız yayında DB sürümü
 * OLMAYAN ve v1 kaydı olmayan belgeler: sayfa koddan çizildiği için okunan HTML gerçekten v1'dir. Çevirisi kayıplı
 * belge atlanır ve nedeniyle bildirilir. Sonra her belgede fark v1'e göre görünür; "Bu sürüme dön" v1'i DB'den yayınlar.
 */
export async function snapshotCodeLegalDocsAction(): Promise<Result> {
  const g = await guardPlatformAction(GATE);
  if ("error" in g) return { ok: false, error: g.error };
  const overview = await readLegalOverview();
  if (overview.status === "missing") return { ok: false, error: "Yasal belge tabloları henüz kurulmadı (migration bekliyor)." };
  if (overview.status === "error") return { ok: false, error: "Sürüm bilgisi okunamadı; tekrar deneyin." };
  const todo = LEGAL_DOCS.filter(
    (d) => !overview.rows.some((r) => r.slug === d.slug && (r.status === "published" || Number(r.version) === 1)),
  ).map((d) => d.slug);
  if (!todo.length) return { ok: true, message: "Kaydedilecek belge yok: hepsinde v1 kaydı ya da yayında DB sürümü var." };
  const results = await Promise.all(
    todo.map(async (slug) => {
      const page = await readLivePageMarkup(slug);
      if (!page.ok) return { slug, ok: false as const, why: page.error };
      const r = await insertCodeSnapshot(slug, { title: page.title, body: page.body }, g.staff.id);
      return r === "error" ? { slug, ok: false as const, why: "Kaydedilemedi; tekrar deneyin." } : { slug, ok: true as const };
    }),
  );
  const saved = results.filter((r) => r.ok).map((r) => r.slug);
  const failed = results.filter((r): r is { slug: LegalDocSlug; ok: false; why: string } => !r.ok);
  if (saved.length) {
    await logPlatformActivity({ actorId: g.staff.id, action: "legal_doc.code_snapshot", entityType: "legal_document", entityId: "v1", meta: { saved, failed: failed.map((f) => f.slug) } });
    revalidatePath("/admin/ayarlar/yasal");
    for (const slug of saved) revalidatePath(`/admin/ayarlar/yasal/${slug}`);
  }
  const failText = failed.map((f) => `${legalDocTitle(f.slug)}: ${f.why}`).join(" · ");
  if (!saved.length) return { ok: false, error: `Hiçbir belge kaydedilmedi. ${failText}` };
  return { ok: true, message: `${saved.length} belge v1 olarak kaydedildi.${failed.length ? ` Atlanan: ${failText}` : ""}` };
}

/** Eski bir sürümü yeni sürüm numarasıyla yeniden yayınlar (geri dönüş; yeniden onay istenmez). */
export async function restoreLegalVersionAction(slug: string, version: number): Promise<Result> {
  const g = await guardPlatformAction(GATE);
  if ("error" in g) return { ok: false, error: g.error };
  if (!isLegalDocSlug(slug) || !Number.isInteger(version) || version < 1) return { ok: false, error: "Sürüm bulunamadı." };
  const beforeDigests = await captureLiveDigests([`/${slug}`]);
  const res = await restoreLegalVersion(slug, version, g.staff.id);
  if (!res.ok) return res;
  await logPlatformActivity({ actorId: g.staff.id, action: "legal_doc.restore", entityType: "legal_document", entityId: slug, meta: { from: version, version: res.version } });
  refresh(slug);
  afterSafe(() => runAfterPublish({ surface: "legal", kind: "restore", publishRef: `${slug}:v${res.version}`, livePaths: [`/${slug}`], actorId: g.staff.id, source: "staff", beforeDigests }), "yayın sonrası zinciri");
  return { ok: true, version: res.version, message: `v${version} metni v${res.version} olarak yayında.` };
}

/** Koddaki sürüme dönüş: yayındaki DB sürümü arşive iner (geçmiş korunur). */
export async function revertLegalToCodeAction(slug: string): Promise<Result> {
  const g = await guardPlatformAction(GATE);
  if ("error" in g) return { ok: false, error: g.error };
  if (!isLegalDocSlug(slug)) return { ok: false, error: "Belge bulunamadı." };
  const beforeDigests = await captureLiveDigests([`/${slug}`]);
  if (!(await archivePublishedLegal(slug))) return { ok: false, error: "Geri alınamadı; tekrar deneyin." };
  await logPlatformActivity({ actorId: g.staff.id, action: "legal_doc.revert_code", entityType: "legal_document", entityId: slug });
  refresh(slug);
  afterSafe(() => runAfterPublish({ surface: "legal", kind: "reset", publishRef: `${slug}:kod`, livePaths: [`/${slug}`], actorId: g.staff.id, source: "staff", beforeDigests }), "yayın sonrası zinciri");
  return { ok: true, message: "Sayfa koddaki metne döndü." };
}

export type LegalConstantForm = { key: string; value: string; validFrom: string; note: string; source: string };

/** Mevzuat sabitine geçerlilik tarihli yeni değer ekler (geçmiş satırlar değişmez). */
export async function addLegalConstantAction(form: LegalConstantForm): Promise<Result> {
  const g = await guardPlatformAction(GATE);
  if ("error" in g) return { ok: false, error: g.error };
  const key = String(form.key ?? "");
  if (!isLegalKey(key)) return { ok: false, error: "Sabit bulunamadı." };
  const value = Number(String(form.value ?? "").replace(/\s/g, "").replace(",", "."));
  if (!Number.isFinite(value) || value < 0 || value > 1e12) return { ok: false, error: "Geçerli bir sayı yazın (negatif olamaz)." };
  const validFrom = String(form.validFrom ?? "").trim();
  if (!isDayKey(validFrom)) return { ok: false, error: "Geçerlilik başlangıcını GG.AA.YYYY tarih olarak seçin." };
  const note = clip(form.note, 501).trim();
  const source = clip(form.source, 501).trim();
  if (note.length > 500 || source.length > 500) return { ok: false, error: "Not ve kaynak en çok 500 karakter." };
  if (!source) return { ok: false, error: "Kaynak zorunlu (Resmî Gazete sayısı, tebliğ ya da kurum duyurusu)." };
  const r = await insertLegalConstant({ key, value, validFrom, note: note || null, source }, g.staff.id);
  if (!r.ok) return r;
  await logPlatformActivity({ actorId: g.staff.id, action: "legal_constant.add", entityType: "legal_constant", entityId: key, meta: { value, validFrom } });
  try {
    updateTag(LEGAL_CONSTANTS_TAG);
  } catch {
    /* eylem dışı bağlam */
  }
  revalidatePath("/admin/ayarlar/yasal");
  const future = validFrom > trDayKey();
  return { ok: true, message: future ? `Kaydedildi; ${validFrom} tarihine kadar eski değer geçerli kalır.` : "Kaydedildi; yeni değer yürürlükte." };
}

/** Yalnız henüz yürürlüğe girmemiş kayıt silinir. */
export async function deleteLegalConstantAction(key: string, validFrom: string): Promise<Result> {
  const g = await guardPlatformAction(GATE);
  if ("error" in g) return { ok: false, error: g.error };
  if (!isLegalKey(key) || !isDayKey(validFrom)) return { ok: false, error: "Kayıt bulunamadı." };
  const r = await deleteFutureLegalConstant(key, validFrom, trDayKey());
  if (!r.ok) return r;
  await logPlatformActivity({ actorId: g.staff.id, action: "legal_constant.delete", entityType: "legal_constant", entityId: key, meta: { validFrom } });
  try {
    updateTag(LEGAL_CONSTANTS_TAG);
  } catch {
    /* eylem dışı bağlam */
  }
  revalidatePath("/admin/ayarlar/yasal");
  return { ok: true, message: "Planlanan değer silindi." };
}
