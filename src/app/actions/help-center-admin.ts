"use server";

import { revalidatePath, updateTag } from "next/cache";
import { codeDraft, codeSlugs, HELP_SLUG_RE, isHelpKind, validateHelpDraft, type HelpDraft, type HelpKind } from "@/lib/help-center/core";
import {
  createHelpArticle,
  deleteHelpArticle,
  discardHelpDraft,
  findHelpArticle,
  HELP_CONTENT_TAG,
  publishHelpArticle,
  saveHelpDraft,
  setHelpStatus,
} from "@/lib/help-center/store";
import { logPlatformActivity } from "@/lib/platform-activity";
import { guardPlatformAction } from "@/lib/platform-guards";

/**
 * Yardım merkezi CMS eylemleri (AD12). Modül `sitecontent` (site içeriğiyle aynı); yazma yalnız süper admin. Yayın,
 * gizleme ve silme `help-content` önbellek etiketini ANINDA tazeler: /app/yardim araması ve AI SSS bağlamı yeni içeriği
 * hemen görür. Her yazma `logPlatformActivity`'ye düşer (metin içeriği değil, yalnız tür/slug).
 */
type Result = { ok: true; message?: string; slug?: string } | { ok: false; error: string };

const RATE = { key: "help-center-admin", limit: 60, windowSec: 600 } as const;
const GATE = { module: "sitecontent", roles: ["super_admin"], rate: RATE } as const;

function refreshLiveHelp() {
  try {
    updateTag(HELP_CONTENT_TAG);
  } catch {
    /* eylem dışı bağlam: 5 dk önbellek süresi yeter */
  }
  revalidatePath("/app/yardim");
  revalidatePath("/admin/site/yardim");
}

const str = (v: unknown, max: number) => String(v ?? "").slice(0, max);
const opt = (v: unknown, max: number) => {
  const s = str(v, max).trim();
  return s ? s : null;
};

export type HelpArticleForm = {
  kind: string;
  slug: string;
  sort: number;
  title: string;
  summary: string;
  body: string;
  category: string;
  href: string;
  hrefLabel: string;
};

function parseForm(form: HelpArticleForm): { kind: HelpKind; slug: string; sort: number; draft: HelpDraft } | { error: string } {
  if (!isHelpKind(form.kind)) return { error: "Geçersiz tür." };
  const slug = str(form.slug, 81).trim();
  if (!HELP_SLUG_RE.test(slug)) return { error: "Kısa ad (slug) küçük harf, rakam ve tire olmalı (2-80 karakter)." };
  const sort = Number.isInteger(Number(form.sort)) ? Math.max(0, Math.min(10_000, Number(form.sort))) : 100;
  const draft: HelpDraft = {
    title: str(form.title, 201).trim(),
    summary: str(form.summary, 1001).trim(),
    body: str(form.body, 20_001).trim(),
    category: form.kind === "faq" ? opt(form.category, 40) : null,
    href: opt(form.href, 300),
    hrefLabel: opt(form.hrefLabel, 81),
  };
  const err = validateHelpDraft(form.kind, draft);
  return err ? { error: err } : { kind: form.kind, slug, sort, draft };
}

/**
 * Kaydet: makale yoksa TASLAK olarak açılır (koddaki maddeyi düzenlemek de böyle başlar); yayındaki makalede düzenleme
 * bekleyen taslağa yazılır (okuyucu eski metni görmeye devam eder).
 */
export async function saveHelpArticleAction(form: HelpArticleForm, isNew: boolean): Promise<Result> {
  const g = await guardPlatformAction(GATE);
  if ("error" in g) return { ok: false, error: g.error };
  const p = parseForm(form);
  if ("error" in p) return { ok: false, error: p.error };
  const existing = await findHelpArticle(p.kind, p.slug);
  if (isNew && (existing || codeSlugs(p.kind).includes(p.slug))) return { ok: false, error: "Bu kısa ad kullanımda; başka bir ad seçin." };
  if (!existing) {
    const r = await createHelpArticle({ kind: p.kind, slug: p.slug, status: "draft", sort: p.sort, draft: p.draft }, g.staff.id);
    if (!r.ok) return r;
  } else if (!(await saveHelpDraft(existing, p.draft, p.sort, g.staff.id))) {
    return { ok: false, error: "Kaydedilemedi; tekrar deneyin." };
  }
  await logPlatformActivity({ actorId: g.staff.id, action: "help_article.save", entityType: "help_article", entityId: `${p.kind}:${p.slug}` });
  revalidatePath("/admin/site/yardim");
  return { ok: true, slug: p.slug, message: existing?.status === "published" ? "Düzenleme taslak olarak kaydedildi; yayınlayınca görünür." : "Taslak kaydedildi." };
}

export async function publishHelpArticleAction(kind: string, slug: string): Promise<Result> {
  const g = await guardPlatformAction(GATE);
  if ("error" in g) return { ok: false, error: g.error };
  if (!isHelpKind(kind) || !HELP_SLUG_RE.test(slug)) return { ok: false, error: "Makale bulunamadı." };
  const row = await findHelpArticle(kind, slug);
  if (!row) return { ok: false, error: "Önce taslağı kaydedin." };
  const err = validateHelpDraft(kind, row.draft ?? row);
  if (err) return { ok: false, error: err };
  if (!(await publishHelpArticle(row, g.staff.id))) return { ok: false, error: "Yayınlanamadı; tekrar deneyin." };
  await logPlatformActivity({ actorId: g.staff.id, action: "help_article.publish", entityType: "help_article", entityId: `${kind}:${slug}` });
  refreshLiveHelp();
  return { ok: true, message: "Yayında; Yardım merkezinde hemen aranabilir." };
}

/** Gizle: yayından kalkar. Koddaki madde için gizleme satırı açılır (kod değişmez). */
export async function hideHelpArticleAction(kind: string, slug: string): Promise<Result> {
  const g = await guardPlatformAction(GATE);
  if ("error" in g) return { ok: false, error: g.error };
  if (!isHelpKind(kind) || !HELP_SLUG_RE.test(slug)) return { ok: false, error: "Makale bulunamadı." };
  const row = await findHelpArticle(kind, slug);
  if (row) {
    if (!(await setHelpStatus(row.id, "hidden", g.staff.id))) return { ok: false, error: "Gizlenemedi; tekrar deneyin." };
  } else {
    const seed = codeDraft(kind, slug);
    if (!seed) return { ok: false, error: "Makale bulunamadı." };
    const r = await createHelpArticle({ kind, slug, status: "hidden", sort: 100, draft: seed }, g.staff.id);
    if (!r.ok) return r;
  }
  await logPlatformActivity({ actorId: g.staff.id, action: "help_article.hide", entityType: "help_article", entityId: `${kind}:${slug}` });
  refreshLiveHelp();
  return { ok: true, message: "Gizlendi; Yardım merkezinde artık görünmüyor." };
}

/** Bekleyen düzenlemeyi atar (yayındaki metin aynen kalır). */
export async function discardHelpDraftAction(kind: string, slug: string): Promise<Result> {
  const g = await guardPlatformAction(GATE);
  if ("error" in g) return { ok: false, error: g.error };
  if (!isHelpKind(kind) || !HELP_SLUG_RE.test(slug)) return { ok: false, error: "Makale bulunamadı." };
  const row = await findHelpArticle(kind, slug);
  if (!row || !row.draft) return { ok: false, error: "Bekleyen düzenleme yok." };
  if (!(await discardHelpDraft(row.id, g.staff.id))) return { ok: false, error: "Atılamadı; tekrar deneyin." };
  await logPlatformActivity({ actorId: g.staff.id, action: "help_article.discard_draft", entityType: "help_article", entityId: `${kind}:${slug}` });
  revalidatePath("/admin/site/yardim");
  return { ok: true, message: "Bekleyen düzenleme atıldı." };
}

/**
 * DB satırını siler: yeni makale tamamen kalkar; koddaki maddenin değiştirilmiş/gizlenmiş hali silinirse koddaki
 * metin geri gelir.
 */
export async function deleteHelpArticleAction(kind: string, slug: string): Promise<Result> {
  const g = await guardPlatformAction(GATE);
  if ("error" in g) return { ok: false, error: g.error };
  if (!isHelpKind(kind) || !HELP_SLUG_RE.test(slug)) return { ok: false, error: "Makale bulunamadı." };
  const row = await findHelpArticle(kind, slug);
  if (!row) return { ok: false, error: "Silinecek kayıt yok." };
  if (!(await deleteHelpArticle(row.id))) return { ok: false, error: "Silinemedi; tekrar deneyin." };
  await logPlatformActivity({ actorId: g.staff.id, action: "help_article.delete", entityType: "help_article", entityId: `${kind}:${slug}` });
  refreshLiveHelp();
  return { ok: true, message: codeSlugs(kind).includes(slug) ? "Değişiklik silindi; koddaki metin geri geldi." : "Makale silindi." };
}
