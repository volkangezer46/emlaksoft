"use server";

import { revalidatePath } from "next/cache";
import { revalidateTenantData } from "@/lib/revalidate";
import { createClient } from "@/lib/supabase/server";
import { requirePermission } from "@/lib/require-permission";
import { logActivity } from "@/lib/activity";

/**
 * Etiket yönetimi (ayarlar/etiketler): ofis genelinde listele, yeniden adlandır (mevcutsa birleştir), kaldır.
 * Tek müşteriye etiket ekleme/çıkarma `actions/customers.ts` içinde kalır.
 */

export type TagManageResult = { ok?: boolean; error?: string; affected?: number };

const TAG_MAX_LEN = 30;
const TAG_MANAGE_LIMIT = 5000;

function normalizeTag(raw: string): string {
  return String(raw ?? "").trim().replace(/\s+/g, " ");
}
function tagKey(tag: string): string {
  return tag.toLocaleLowerCase("tr-TR");
}

/** Etiket → müşteri sayısı (ofis genelinde, silinmemiş müşteriler). */
export async function listTagCounts(): Promise<{ tag: string; count: number }[]> {
  const gate = await requirePermission("customers", "view");
  if (!gate.ok) return [];
  const supabase = await createClient();
  const { data } = await supabase
    .from("customers")
    .select("tags")
    .eq("tenant_id", gate.tenantId)
    .is("deleted_at", null)
    .neq("tags", "{}")
    .limit(TAG_MANAGE_LIMIT);
  const counts = new Map<string, { tag: string; count: number }>();
  for (const row of (data ?? []) as { tags: string[] | null }[]) {
    for (const raw of row.tags ?? []) {
      const t = normalizeTag(raw);
      if (!t) continue;
      const e = counts.get(tagKey(t));
      if (e) e.count += 1;
      else counts.set(tagKey(t), { tag: t, count: 1 });
    }
  }
  return [...counts.values()].sort((a, b) => b.count - a.count || a.tag.localeCompare(b.tag, "tr"));
}

/** `to` null ise etiket kaldırılır; doluysa yeniden adlandırılır (hedef mevcutsa birleşir). */
async function rewriteTag(from: string, to: string | null): Promise<TagManageResult> {
  const gate = await requirePermission("customers", "edit");
  if (!gate.ok) return { error: gate.error };
  const src = normalizeTag(from);
  const dst = to === null ? null : normalizeTag(to);
  if (!src) return { error: "Etiket seçilmedi." };
  if (dst !== null) {
    if (!dst) return { error: "Yeni ad boş olamaz." };
    if (dst.length > TAG_MAX_LEN) return { error: `Etiket en fazla ${TAG_MAX_LEN} karakter olabilir.` };
  }
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("customers")
    .select("id, tags")
    .eq("tenant_id", gate.tenantId)
    .is("deleted_at", null)
    .neq("tags", "{}")
    .limit(TAG_MANAGE_LIMIT);
  if (error) {
    console.error("rewriteTag load", error);
    return { error: "Etiketler yüklenemedi. Lütfen tekrar deneyin." };
  }
  let affected = 0;
  for (const row of (data ?? []) as { id: string; tags: string[] | null }[]) {
    const tags = row.tags ?? [];
    if (!tags.some((t) => tagKey(normalizeTag(t)) === tagKey(src))) continue;
    const next: string[] = [];
    for (const t of tags) {
      const n = tagKey(normalizeTag(t)) === tagKey(src) ? dst : t;
      if (n && !next.some((x) => tagKey(x) === tagKey(n))) next.push(n);
    }
    const { error: upErr } = await supabase
      .from("customers")
      .update({ tags: next })
      .eq("id", row.id)
      .eq("tenant_id", gate.tenantId);
    if (upErr) {
      console.error("rewriteTag update", upErr);
      return { error: "Etiket güncellenirken hata oluştu; işlem yarım kalmış olabilir, tekrar deneyin.", affected };
    }
    affected += 1;
  }
  await logActivity({
    tenantId: gate.tenantId,
    actorId: gate.userId,
    action: dst === null ? "customer.tag_delete_all" : "customer.tag_rename",
    entityType: "customer",
    newValue: { from: src, to: dst, affected },
  });
  revalidatePath("/app/musteriler");
  revalidatePath("/app/ayarlar/etiketler");
  revalidateTenantData(gate.tenantId);
  return { ok: true, affected };
}

export async function renameCustomerTag(from: string, to: string): Promise<TagManageResult> {
  return rewriteTag(from, to);
}

export async function deleteCustomerTagEverywhere(tag: string): Promise<TagManageResult> {
  return rewriteTag(tag, null);
}
