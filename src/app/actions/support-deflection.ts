"use server";

import { createAdminClient } from "@/lib/supabase/admin";
import { requirePermission } from "@/lib/require-permission";
import { checkRateLimit } from "@/lib/rate-limit";
import { getHelpContent } from "@/lib/help-center/store";
import { suggestHelpArticles, type ArticleSuggestion } from "@/lib/help-center/search";
import { HELP_SLUG_RE } from "@/lib/help-center/core";
import { bustAdminCounters } from "@/lib/admin/counter-tags";

/**
 * PA-7 talep saptırma (deflection): yeni destek talebinin konusu yazılırken ilgili yardım makaleleri ve "Bu sorunumu
 * çözdü" ölçümü. Kapı: `support:create` (talep açabilen kullanıcı). Öneri okuması önbellekli yardım içeriğinden (kod +
 * yayındaki DB makaleleri); kayıt `support_article_deflections` (migration 20261019070004, yalnız service_role).
 */
export type SuggestResult = { items: ArticleSuggestion[] };
export type DeflectResult = { ok?: boolean; error?: string; recorded?: boolean };

export async function suggestTicketArticles(q: string): Promise<SuggestResult> {
  const gate = await requirePermission("support", "create");
  if (!gate.ok) return { items: [] };
  const query = String(q ?? "").slice(0, 200);
  if (query.trim().length < 4) return { items: [] };
  const rl = await checkRateLimit(`ticket-suggest:${gate.userId}`, { limit: 120, windowSec: 300, failurePolicy: "allow" });
  if (!rl.allowed) return { items: [] };
  const content = await getHelpContent().catch(() => null);
  if (!content) return { items: [] };
  return { items: suggestHelpArticles(content, query, 3) };
}

export async function recordTicketDeflection(formData: FormData): Promise<DeflectResult> {
  const gate = await requirePermission("support", "create");
  if (!gate.ok) return { error: gate.error };
  const kind = String(formData.get("kind") ?? "");
  const slug = String(formData.get("slug") ?? "");
  if ((kind !== "guide" && kind !== "faq") || !HELP_SLUG_RE.test(slug)) return { error: "Geçersiz makale." };
  const query = String(formData.get("q") ?? "").replace(/\s+/g, " ").trim().slice(0, 200) || null;
  const rl = await checkRateLimit(`ticket-deflect:${gate.userId}`, { limit: 20, windowSec: 600, failurePolicy: "deny" });
  if (!rl.allowed) return { ok: true, recorded: false };
  const { error } = await createAdminClient()
    .from("support_article_deflections")
    .insert({ tenant_id: gate.tenantId, user_id: gate.userId, kind, slug, query });
  // Ölçüm yazılamasa da (tablo yok) kullanıcı akışı bozulmaz: sorunu çözüldü, talep açılmaz.
  if (error) {
    console.error("[support-deflection] kayıt yazılamadı", error.code ?? error.message);
    return { ok: true, recorded: false };
  }
  bustAdminCounters();
  return { ok: true, recorded: true };
}
