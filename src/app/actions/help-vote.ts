"use server";

import { helpArticleExists, isHelpKind, HELP_SLUG_RE } from "@/lib/help-center/core";
import { getHelpContent, upsertHelpVote } from "@/lib/help-center/store";
import { checkRateLimit } from "@/lib/rate-limit";
import { getRequestUser } from "@/lib/supabase/auth-cache";

/**
 * Yardım makalesi "işe yaradı mı" oyu (oturumlu kullanıcı; kullanıcı başına makale başına tek oy, yeniden oylamada
 * güncellenir). Oy yalnız sayılır; kişisel veri yazılmaz (kullanıcı kimliği tekillik içindir). Ofis kimliği oturum
 * claim'inden (yoksa boş). Slug yayındaki birleşik içerikte (kod + yayındaki DB; önbellekli) yoksa oy yazılmaz: rastgele
 * slug'larla sayım tablosu doldurulamaz.
 */
export async function voteHelpArticle(kind: string, slug: string, helpful: boolean): Promise<{ ok: boolean; error?: string }> {
  const user = await getRequestUser();
  if (!user) return { ok: false, error: "Oturum bulunamadı." };
  if (!isHelpKind(kind) || !HELP_SLUG_RE.test(String(slug))) return { ok: false, error: "Makale bulunamadı." };
  const { allowed } = await checkRateLimit(`help-vote:${user.id}`, { limit: 60, windowSec: 3600, failurePolicy: "allow" });
  if (!allowed) return { ok: false, error: "Çok sık oy verildi; biraz sonra tekrar deneyin." };
  if (!helpArticleExists(await getHelpContent(), kind, slug)) return { ok: false, error: "Makale bulunamadı." };
  const meta = (user.app_metadata ?? {}) as Record<string, unknown>;
  const tenantId = typeof meta.tenant_id === "string" && /^[0-9a-f-]{36}$/i.test(meta.tenant_id) ? meta.tenant_id : null;
  const ok = await upsertHelpVote({ kind, slug, userId: user.id, tenantId, helpful: helpful === true });
  return ok ? { ok: true } : { ok: false, error: "Oy kaydedilemedi; tekrar deneyin." };
}
