"use server";

import { revalidatePath } from "next/cache";
import { revalidateTenantData } from "@/lib/revalidate";
import { createClient } from "@/lib/supabase/server";
import { requirePermission } from "@/lib/require-permission";
import { logActivity } from "@/lib/activity";
import {
  TAG_MAX_LEN,
  TAG_UPDATE_CHUNK,
  chunkArray,
  describeTagRewrite,
  normalizeTag,
  rewriteTagList,
  tagKey,
} from "@/lib/customer-tags-logic";
import { actionErrorMessage } from "@/lib/action-errors";

/**
 * Etiket yönetimi (ayarlar/etiketler): ofis genelinde listele, yeniden adlandır (mevcutsa birleştir), kaldır.
 * Tek müşteriye etiket ekleme/çıkarma `actions/customers.ts` içinde kalır.
 */

export type TagManageResult = { ok?: boolean; error?: string; affected?: number; failed?: number; message?: string };

const TAG_MANAGE_LIMIT = 5000;

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
    return { error: actionErrorMessage(error, "Etiketler yüklenemedi. Lütfen tekrar deneyin.") };
  }
  // Parçalı toplu güncelleme: değişecek müşteriler hesaplanır, TAG_UPDATE_CHUNK'lık dilimlerle paralel yazılır.
  // Bir dilimdeki hata diğerlerini durdurmaz; sonda kaç müşterinin güncellendiği/başarısız olduğu raporlanır.
  // İşlem idempotenttir: tekrar çalıştırmak yalnız hâlâ eski etiketi taşıyanları işler.
  const pending: { id: string; tags: string[] }[] = [];
  for (const row of (data ?? []) as { id: string; tags: string[] | null }[]) {
    const next = rewriteTagList(row.tags ?? [], src, dst);
    if (next) pending.push({ id: row.id, tags: next });
  }
  let affected = 0;
  let failed = 0;
  for (const part of chunkArray(pending, TAG_UPDATE_CHUNK)) {
    const results = await Promise.all(
      part.map((r) => supabase.from("customers").update({ tags: r.tags }).eq("id", r.id).eq("tenant_id", gate.tenantId)),
    );
    for (const r of results) {
      if (r.error) {
        console.error("rewriteTag update", r.error);
        failed += 1;
      } else affected += 1;
    }
  }
  await logActivity({
    tenantId: gate.tenantId,
    actorId: gate.userId,
    action: dst === null ? "customer.tag_delete_all" : "customer.tag_rename",
    entityType: "customer",
    newValue: { from: src, to: dst, affected, failed },
  });
  revalidatePath("/app/musteriler");
  revalidatePath("/app/ayarlar/etiketler");
  revalidateTenantData(gate.tenantId);
  const message = describeTagRewrite(affected, failed, pending.length);
  if (failed > 0) return { error: message, affected, failed, message };
  return { ok: true, affected, failed, message };
}

export async function renameCustomerTag(from: string, to: string): Promise<TagManageResult> {
  return rewriteTag(from, to);
}

export async function deleteCustomerTagEverywhere(tag: string): Promise<TagManageResult> {
  return rewriteTag(tag, null);
}
