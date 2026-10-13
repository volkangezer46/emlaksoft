import "server-only";
import { unstable_cache } from "next/cache";
import { daysAgoIso } from "@/lib/clock";
import { createAdminClient } from "@/lib/supabase/admin";
import { isLegalDocSlug, legalDocTitle, type LegalDocSlug, type ReconsentDocRow } from "./core";

/**
 * Sürümlü yasal belge deposu (yalnız sunucu, service_role): `legal_documents` + `legal_consents` (migration
 * 20261013005100). Tablolar platform düzeyidir; kapı çağıranda (admin: guardPlatformAction("sistem"); onay:
 * getRequestUser). Tablo yokken okuyucular "yok" döner: sayfalar koddaki sürümü çizer, yeniden onay çıkmaz.
 *
 * Önbellek: yayındaki belge ve yeniden onay listesi `legal-docs` etiketiyle (300 sn); yayın/geri alma etiketi tazeler.
 */
export const LEGAL_DOCS_TAG = "legal-docs";

/** Tek service_role giriş noktası (kabul listesi: src/lib/admin-client-allowlist.ts). */
function db() {
  return createAdminClient();
}

type DbError = { code?: string; message?: string } | null;

export function isMissingLegalSchema(error: DbError): boolean {
  if (!error) return false;
  return error.code === "42P01" || error.code === "PGRST205" || /legal_documents|legal_consents|schema cache/i.test(error.message ?? "");
}

export type LegalDocRow = {
  id: string;
  slug: LegalDocSlug;
  version: number;
  status: "draft" | "published" | "archived";
  title: string;
  intro: string;
  body: string;
  requiresReconsent: boolean;
  changeNote: string | null;
  publishedAt: string | null;
  createdAt: string;
  updatedAt: string;
};

const COLS = "id, slug, version, status, title, intro, body, requires_reconsent, change_note, published_at, created_at, updated_at";

type Raw = {
  id: string;
  slug: string;
  version: number;
  status: string;
  title: string;
  intro: string | null;
  body: string;
  requires_reconsent: boolean;
  change_note: string | null;
  published_at: string | null;
  created_at: string;
  updated_at: string;
};

function toRow(r: Raw): LegalDocRow | null {
  if (!isLegalDocSlug(r.slug)) return null;
  return {
    id: r.id,
    slug: r.slug,
    version: Number(r.version),
    status: r.status === "published" || r.status === "archived" ? r.status : "draft",
    title: r.title,
    intro: r.intro ?? "",
    body: r.body,
    requiresReconsent: Boolean(r.requires_reconsent),
    changeNote: r.change_note,
    publishedAt: r.published_at,
    createdAt: r.created_at,
    updatedAt: r.updated_at,
  };
}

export type PublishedLegalDoc = Pick<LegalDocRow, "slug" | "version" | "title" | "intro" | "body" | "publishedAt">;

/** Yayındaki sürüm (önbellekli). Yoksa / tablo yoksa / okunamazsa null → sayfa koddaki sürümü çizer. */
export const readPublishedLegalDoc = unstable_cache(
  async (slug: string): Promise<PublishedLegalDoc | null> => {
    if (!isLegalDocSlug(slug)) return null;
    try {
      const { data, error } = await db()
        .from("legal_documents")
        .select("slug, version, title, intro, body, published_at")
        .eq("slug", slug)
        .eq("status", "published")
        .order("version", { ascending: false })
        .limit(1)
        .maybeSingle();
      if (error || !data) return null;
      const r = data as { slug: LegalDocSlug; version: number; title: string; intro: string | null; body: string; published_at: string | null };
      return { slug: r.slug, version: Number(r.version), title: r.title, intro: r.intro ?? "", body: r.body, publishedAt: r.published_at };
    } catch {
      return null;
    }
  },
  ["legal-doc-published-v1"],
  { revalidate: 300, tags: [LEGAL_DOCS_TAG] },
);

/**
 * Yeniden onay isteyen belgeler (önbellekli; çoğu zaman BOŞ → /app kabuğunda ek DB turu yok). Her belge için yayındaki
 * en yeni sürüm + en yeni "yeniden onay gerekli" sürüm.
 */
export const readReconsentDocs = unstable_cache(
  async (): Promise<ReconsentDocRow[]> => {
    try {
      const { data, error } = await db()
        .from("legal_documents")
        .select("slug, version, status, title, requires_reconsent, published_at")
        .in("status", ["published", "archived"])
        .order("version", { ascending: false });
      if (error || !data) return [];
      const rows = data as { slug: string; version: number; status: string; title: string; requires_reconsent: boolean; published_at: string | null }[];
      const out: ReconsentDocRow[] = [];
      const slugs = [...new Set(rows.map((r) => r.slug))].filter(isLegalDocSlug);
      for (const slug of slugs) {
        const mine = rows.filter((r) => r.slug === slug);
        const live = mine.find((r) => r.status === "published");
        const req = mine.find((r) => r.requires_reconsent && r.published_at);
        if (!live || !req || req.version > live.version) continue;
        out.push({ slug, version: Number(live.version), title: live.title || legalDocTitle(slug), requiredVersion: Number(req.version), requiredPublishedAt: req.published_at! });
      }
      return out;
    } catch {
      return [];
    }
  },
  ["legal-reconsent-docs-v1"],
  { revalidate: 300, tags: [LEGAL_DOCS_TAG] },
);

/** Kullanıcının bu belgelerdeki onayları + hesabın açılış anı (tek turda, paralel). */
export async function readUserConsentState(
  userId: string,
  slugs: readonly string[],
): Promise<{ consents: { document: string; version: number }[]; userCreatedAt: string | null; tenantId: string | null }> {
  const admin = db();
  const [c, p] = await Promise.all([
    admin.from("legal_consents").select("document, version").eq("user_id", userId).in("document", [...slugs]),
    admin.from("profiles").select("created_at, tenant_id").eq("id", userId).maybeSingle(),
  ]);
  if (c.error) throw new Error(c.error.message);
  const prof = (p.data ?? null) as { created_at: string | null; tenant_id: string | null } | null;
  return {
    consents: ((c.data ?? []) as { document: string; version: number }[]).map((r) => ({ document: r.document, version: Number(r.version) })),
    userCreatedAt: prof?.created_at ?? null,
    tenantId: prof?.tenant_id ?? null,
  };
}

/** Onay kayıtları (aynı kullanıcı + belge + sürüm ikinci kez yazılmaz). */
export async function insertConsents(
  rows: { userId: string; tenantId: string | null; document: LegalDocSlug; version: number; ip: string | null; userAgent: string | null }[],
): Promise<boolean> {
  if (!rows.length) return true;
  const { error } = await db()
    .from("legal_consents")
    .upsert(
      rows.map((r) => ({ user_id: r.userId, tenant_id: r.tenantId, document: r.document, version: r.version, ip: r.ip, user_agent: r.userAgent })),
      { onConflict: "user_id,document,version", ignoreDuplicates: true },
    );
  return !error;
}

export type LegalOverview =
  | { status: "missing" }
  | { status: "error"; error: string }
  | { status: "ok"; rows: LegalDocRow[] };

/** Admin: tüm sürümler (taslak dahil, gövdesiz değil; 8 belge × birkaç sürüm küçük). */
export async function readLegalOverview(): Promise<LegalOverview> {
  const { data, error } = await db().from("legal_documents").select(COLS).order("slug").order("version", { ascending: false }).limit(500);
  if (error) return isMissingLegalSchema(error) ? { status: "missing" } : { status: "error", error: error.message ?? "okunamadı" };
  return { status: "ok", rows: ((data ?? []) as Raw[]).map(toRow).filter((r): r is LegalDocRow => r !== null) };
}

export async function readLegalDocVersions(slug: LegalDocSlug): Promise<LegalOverview> {
  const { data, error } = await db().from("legal_documents").select(COLS).eq("slug", slug).order("version", { ascending: false }).limit(200);
  if (error) return isMissingLegalSchema(error) ? { status: "missing" } : { status: "error", error: error.message ?? "okunamadı" };
  return { status: "ok", rows: ((data ?? []) as Raw[]).map(toRow).filter((r): r is LegalDocRow => r !== null) };
}

export type DraftInput = { title: string; intro: string; body: string; requiresReconsent: boolean; changeNote: string | null };

/** Taslağı yazar: varsa günceller, yoksa en yeni sürüm + 1 ile açar. */
export async function upsertLegalDraft(slug: LegalDocSlug, input: DraftInput, actorId: string): Promise<{ ok: true; version: number } | { ok: false; error: string }> {
  const admin = db();
  const { data: rows, error } = await admin.from("legal_documents").select("id, version, status").eq("slug", slug).order("version", { ascending: false }).limit(50);
  if (error) return { ok: false, error: isMissingLegalSchema(error) ? "Yasal belge tabloları henüz kurulmadı (migration bekliyor)." : "Okunamadı; tekrar deneyin." };
  const list = (rows ?? []) as { id: string; version: number; status: string }[];
  const draft = list.find((r) => r.status === "draft");
  const fields = {
    title: input.title,
    intro: input.intro,
    body: input.body,
    requires_reconsent: input.requiresReconsent,
    change_note: input.changeNote,
    updated_at: daysAgoIso(0),
  };
  if (draft) {
    const { error: e } = await admin.from("legal_documents").update(fields).eq("id", draft.id).eq("status", "draft");
    return e ? { ok: false, error: "Taslak kaydedilemedi; tekrar deneyin." } : { ok: true, version: Number(draft.version) };
  }
  // Kod sürümü v1 sayılır: ilk DB sürümü 2'den başlar.
  const version = Math.max(1, ...list.map((r) => Number(r.version))) + 1;
  const { error: e } = await admin.from("legal_documents").insert({ slug, version, status: "draft", created_by: actorId, ...fields });
  if (e) return { ok: false, error: e.code === "23505" ? "Bu belge için başka bir taslak az önce açıldı; sayfayı yenileyin." : "Taslak kaydedilemedi; tekrar deneyin." };
  return { ok: true, version };
}

/** Taslağı yayınlar: önceki yayındaki sürüm arşive iner. Dönen sürüm yayına girendir. */
export async function publishLegalDraft(slug: LegalDocSlug, actorId: string): Promise<{ ok: true; version: number; requiresReconsent: boolean } | { ok: false; error: string }> {
  const admin = db();
  const { data, error } = await admin.from("legal_documents").select("id, version, requires_reconsent").eq("slug", slug).eq("status", "draft").maybeSingle();
  if (error) return { ok: false, error: "Okunamadı; tekrar deneyin." };
  if (!data) return { ok: false, error: "Yayınlanacak taslak yok." };
  const d = data as { id: string; version: number; requires_reconsent: boolean };
  const at = daysAgoIso(0);
  const { error: e1 } = await admin.from("legal_documents").update({ status: "archived", updated_at: at }).eq("slug", slug).eq("status", "published");
  if (e1) return { ok: false, error: "Yayındaki sürüm arşive alınamadı; yayın yapılmadı." };
  const { error: e2 } = await admin
    .from("legal_documents")
    .update({ status: "published", published_at: at, published_by: actorId, updated_at: at })
    .eq("id", d.id)
    .eq("status", "draft");
  if (e2) return { ok: false, error: "Yayınlanamadı; tekrar deneyin." };
  return { ok: true, version: Number(d.version), requiresReconsent: Boolean(d.requires_reconsent) };
}

export async function deleteLegalDraft(slug: LegalDocSlug): Promise<boolean> {
  const { error } = await db().from("legal_documents").delete().eq("slug", slug).eq("status", "draft");
  return !error;
}

/**
 * Eski bir sürümü yeniden yayına alır (geri dönüş): o sürümün metni YENİ sürüm numarasıyla yayınlanır (geçmiş bozulmaz).
 * Bekleyen taslak varsa reddedilir (yazarın işi ezilmez). Yeniden onay istenmez.
 */
export async function restoreLegalVersion(slug: LegalDocSlug, version: number, actorId: string): Promise<{ ok: true; version: number } | { ok: false; error: string }> {
  const admin = db();
  const { data, error } = await admin.from("legal_documents").select("version, status, title, intro, body").eq("slug", slug).order("version", { ascending: false }).limit(200);
  if (error) return { ok: false, error: "Okunamadı; tekrar deneyin." };
  const rows = (data ?? []) as { version: number; status: string; title: string; intro: string | null; body: string }[];
  if (rows.some((r) => r.status === "draft")) return { ok: false, error: "Önce bekleyen taslağı yayınlayın ya da silin." };
  const src = rows.find((r) => Number(r.version) === version);
  if (!src) return { ok: false, error: "Sürüm bulunamadı." };
  const next = Math.max(1, ...rows.map((r) => Number(r.version))) + 1;
  const ins = await admin.from("legal_documents").insert({
    slug,
    version: next,
    status: "draft",
    title: src.title,
    intro: src.intro ?? "",
    body: src.body,
    requires_reconsent: false,
    change_note: `v${version} metnine geri dönüş`,
    created_by: actorId,
  });
  if (ins.error) return { ok: false, error: "Geri dönüş taslağı açılamadı." };
  const pub = await publishLegalDraft(slug, actorId);
  return pub.ok ? { ok: true, version: pub.version } : pub;
}

/**
 * Kod sürümüne dönüş: yayındaki DB sürümü arşive iner, sayfa yeniden koddaki metni (v1) gösterir. Geçmiş silinmez.
 */
export async function archivePublishedLegal(slug: LegalDocSlug): Promise<boolean> {
  const { error } = await db().from("legal_documents").update({ status: "archived", updated_at: daysAgoIso(0) }).eq("slug", slug).eq("status", "published");
  return !error;
}

export type ConsentRow = { userId: string; version: number; acceptedAt: string; ip: string | null };

/** Admin: belgeye ait son onay kayıtları (kanıt görünümü; en çok 50). */
export async function readRecentConsents(slug: LegalDocSlug, limit = 50): Promise<ConsentRow[] | null> {
  const { data, error } = await db()
    .from("legal_consents")
    .select("user_id, version, accepted_at, ip")
    .eq("document", slug)
    .order("accepted_at", { ascending: false })
    .limit(limit);
  if (error) return null;
  return ((data ?? []) as { user_id: string; version: number; accepted_at: string; ip: string | null }[]).map((r) => ({
    userId: r.user_id,
    version: Number(r.version),
    acceptedAt: r.accepted_at,
    ip: r.ip,
  }));
}
