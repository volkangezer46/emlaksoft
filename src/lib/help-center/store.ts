import "server-only";
import { unstable_cache } from "next/cache";
import { daysAgoIso } from "@/lib/clock";
import { createAdminClient } from "@/lib/supabase/admin";
import { readAllPaged } from "@/lib/supabase/read-all-paged";
import { getEffectiveLegalValues } from "@/lib/legal-constants/store";
import { applyEffectiveEidsPenalty } from "./eids";
import { isHelpKind, mergeHelpContent, voteKey, type HelpArticleRow, type HelpContent, type HelpDraft, type HelpKind, type HelpStatus, type VoteTally } from "./core";

/**
 * Yardım merkezi deposu (yalnız sunucu, service_role): `help_articles` + `help_article_votes` (migration 20261013005100).
 * Kapı çağıranda (admin: guardPlatformAction("sitecontent"); oy: getRequestUser). Tablo yokken okuyucular koddaki
 * içeriğe düşer; admin "kurulum bekliyor" der.
 *
 * Önbellek: okuyucu birleşimi `help-content` etiketiyle (300 sn); yayın/gizleme/silme etiketi ANINDA tazeler, böylece yeni
 * makale yayınlanır yayınlanmaz /app/yardim aramasında ve AI SSS bağlamında görünür.
 */
export const HELP_CONTENT_TAG = "help-content";

/** Tek service_role giriş noktası (kabul listesi: src/lib/admin-client-allowlist.ts). */
function db() {
  return createAdminClient();
}

const COLS = "id, kind, slug, category, status, title, summary, body, href, href_label, sort, draft, published_at, updated_at";

type Raw = {
  id: string;
  kind: string;
  slug: string;
  category: string | null;
  status: string;
  title: string;
  summary: string | null;
  body: string | null;
  href: string | null;
  href_label: string | null;
  sort: number;
  draft: unknown;
  published_at: string | null;
  updated_at: string;
};

function parseDraft(v: unknown): HelpDraft | null {
  if (!v || typeof v !== "object") return null;
  const o = v as Record<string, unknown>;
  const s = (k: string) => (typeof o[k] === "string" ? (o[k] as string) : "");
  const n = (k: string) => (typeof o[k] === "string" && (o[k] as string) ? (o[k] as string) : null);
  return { title: s("title"), summary: s("summary"), body: s("body"), category: n("category"), href: n("href"), hrefLabel: n("hrefLabel") };
}

function toRow(r: Raw): HelpArticleRow | null {
  if (!isHelpKind(r.kind)) return null;
  const status: HelpStatus = r.status === "published" || r.status === "hidden" ? r.status : "draft";
  return {
    id: r.id,
    kind: r.kind,
    slug: r.slug,
    status,
    title: r.title,
    summary: r.summary ?? "",
    body: r.body ?? "",
    category: r.category,
    href: r.href,
    hrefLabel: r.href_label,
    sort: Number(r.sort ?? 100),
    draft: parseDraft(r.draft),
    publishedAt: r.published_at,
    updatedAt: r.updated_at,
  };
}

function isMissing(error: { code?: string; message?: string } | null): boolean {
  if (!error) return false;
  return error.code === "42P01" || error.code === "PGRST205" || /help_articles|help_article_votes|schema cache/i.test(error.message ?? "");
}

const cachedLiveRows = unstable_cache(
  async (): Promise<HelpArticleRow[]> => {
    try {
      const { data, error } = await db().from("help_articles").select(COLS).in("status", ["published", "hidden"]).limit(1000);
      if (error) return [];
      return ((data ?? []) as Raw[]).map(toRow).filter((r): r is HelpArticleRow => r !== null);
    } catch {
      return [];
    }
  },
  ["help-articles-live-v1"],
  { revalidate: 300, tags: [HELP_CONTENT_TAG] },
);

/** Okuyucu birleşimi (kod + yayındaki DB). Okunamazsa koddaki içerik. */
/** Birleşik içerik; EİDS ceza tutarı o gün yürürlükteki mevzuat değeriyle (legal_constants geçmişi). */
export async function getHelpContent(): Promise<HelpContent> {
  const [rows, legal] = await Promise.all([cachedLiveRows(), getEffectiveLegalValues()]);
  return applyEffectiveEidsPenalty(mergeHelpContent(rows), legal);
}

export type HelpList = { status: "ok"; rows: HelpArticleRow[] } | { status: "missing" } | { status: "error"; error: string };

/** Admin: tüm DB satırları (taslak dahil). */
export async function listHelpArticles(): Promise<HelpList> {
  const { data, error } = await db().from("help_articles").select(COLS).order("kind").order("sort").order("title").limit(1000);
  if (error) return isMissing(error) ? { status: "missing" } : { status: "error", error: error.message ?? "okunamadı" };
  return { status: "ok", rows: ((data ?? []) as Raw[]).map(toRow).filter((r): r is HelpArticleRow => r !== null) };
}

export async function readHelpArticle(id: string): Promise<HelpArticleRow | null> {
  const { data, error } = await db().from("help_articles").select(COLS).eq("id", id).maybeSingle();
  if (error || !data) return null;
  return toRow(data as Raw);
}

export async function findHelpArticle(kind: HelpKind, slug: string): Promise<HelpArticleRow | null> {
  const { data, error } = await db().from("help_articles").select(COLS).eq("kind", kind).eq("slug", slug).maybeSingle();
  if (error || !data) return null;
  return toRow(data as Raw);
}

const liveFields = (d: HelpDraft) => ({
  title: d.title,
  summary: d.summary,
  body: d.body,
  category: d.category,
  href: d.href,
  href_label: d.hrefLabel,
});

export async function createHelpArticle(
  input: { kind: HelpKind; slug: string; status: HelpStatus; sort: number; draft: HelpDraft },
  actorId: string,
): Promise<{ ok: true; id: string } | { ok: false; error: string }> {
  const at = daysAgoIso(0);
  const { data, error } = await db()
    .from("help_articles")
    .insert({
      kind: input.kind,
      slug: input.slug,
      status: input.status,
      sort: input.sort,
      ...liveFields(input.draft),
      published_at: input.status === "draft" ? null : at,
      created_by: actorId,
      updated_by: actorId,
    })
    .select("id")
    .single();
  if (error) {
    if (error.code === "23505") return { ok: false, error: "Bu türde aynı kısa adla (slug) bir makale zaten var." };
    if (isMissing(error)) return { ok: false, error: "Yardım tabloları henüz kurulmadı (migration bekliyor)." };
    return { ok: false, error: "Kaydedilemedi; tekrar deneyin." };
  }
  return { ok: true, id: (data as { id: string }).id };
}

/** Yayındaki makalede düzenleme `draft`'a yazılır (okuyucu eski metni görmeye devam eder); diğerlerinde canlı alanlara. */
export async function saveHelpDraft(row: HelpArticleRow, d: HelpDraft, sort: number, actorId: string): Promise<boolean> {
  const at = daysAgoIso(0);
  const patch =
    row.status === "published"
      ? { draft: { title: d.title, summary: d.summary, body: d.body, category: d.category, href: d.href, hrefLabel: d.hrefLabel }, sort, updated_by: actorId, updated_at: at }
      : { ...liveFields(d), sort, updated_by: actorId, updated_at: at };
  const { error } = await db().from("help_articles").update(patch).eq("id", row.id);
  return !error;
}

/** Yayınla: bekleyen taslak varsa canlıya uygulanır, durum yayında olur. */
export async function publishHelpArticle(row: HelpArticleRow, actorId: string): Promise<boolean> {
  const at = daysAgoIso(0);
  const live = row.draft ?? row;
  const { error } = await db()
    .from("help_articles")
    .update({ ...liveFields(live), draft: null, status: "published", published_at: at, updated_by: actorId, updated_at: at })
    .eq("id", row.id);
  return !error;
}

export async function setHelpStatus(id: string, status: HelpStatus, actorId: string): Promise<boolean> {
  const { error } = await db().from("help_articles").update({ status, updated_by: actorId, updated_at: daysAgoIso(0) }).eq("id", id);
  return !error;
}

export async function discardHelpDraft(id: string, actorId: string): Promise<boolean> {
  const { error } = await db().from("help_articles").update({ draft: null, updated_by: actorId, updated_at: daysAgoIso(0) }).eq("id", id);
  return !error;
}

export async function deleteHelpArticle(id: string): Promise<boolean> {
  const { error } = await db().from("help_articles").delete().eq("id", id);
  return !error;
}

/** Kullanıcı başına tek oy (yeniden oylamada güncellenir). */
export async function upsertHelpVote(input: { kind: HelpKind; slug: string; userId: string; tenantId: string | null; helpful: boolean }): Promise<boolean> {
  const { error } = await db()
    .from("help_article_votes")
    .upsert(
      { kind: input.kind, slug: input.slug, user_id: input.userId, tenant_id: input.tenantId, helpful: input.helpful, updated_at: daysAgoIso(0) },
      { onConflict: "kind,slug,user_id" },
    );
  return !error;
}

/** Admin: makale başına oy sayıları (`kind:slug` anahtarıyla). Okunamazsa boş. */
export async function readVoteTallies(): Promise<Map<string, VoteTally>> {
  const out = new Map<string, VoteTally>();
  const admin = db();
  const res = await readAllPaged<{ kind: string; slug: string; helpful: boolean }>(
    (from, to) => admin.from("help_article_votes").select("kind, slug, helpful").order("id").range(from, to),
    { maxRows: 50_000 },
  );
  if (res.error) return out;
  for (const r of res.rows) {
    if (!isHelpKind(r.kind)) continue;
    const k = voteKey(r.kind, r.slug);
    const t = out.get(k) ?? { helpful: 0, notHelpful: 0 };
    if (r.helpful) t.helpful++;
    else t.notHelpful++;
    out.set(k, t);
  }
  return out;
}
