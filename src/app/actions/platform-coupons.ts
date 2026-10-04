"use server";

import { revalidatePath } from "next/cache";
import { requirePlatformModule } from "@/lib/platform";
import { logPlatformActivity } from "@/lib/platform-activity";
import { checkRateLimit } from "@/lib/rate-limit";
import { createAdminClient } from "@/lib/supabase/admin";
import { parseCouponForm } from "@/lib/billing/coupon";
import { ALL_PLAN_IDS } from "@/lib/billing/plan-overrides";
import { getPlanSupport } from "@/lib/billing/plan-support";

export type CouponOpResult = { ok?: boolean; error?: string; notice?: string };

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

async function guard(action: string, superOnly: boolean) {
  const staff = await requirePlatformModule("billing");
  if (superOnly && staff.role !== "super_admin") return { error: "Bu işlem yalnız süper admin tarafından yapılabilir." } as const;
  const rl = await checkRateLimit(`coupon:${action}:${staff.id}`, { limit: 30, windowSec: 600, failurePolicy: "deny" });
  if (!rl.allowed) return { error: "Çok sık işlem yaptınız; birkaç dakika sonra tekrar deneyin." } as const;
  const support = await getPlanSupport();
  if (!support.coupons) return { error: "Kupon şeması (20260817000230) henüz uygulanmadı." } as const;
  return { staff } as const;
}

function fieldsOf(fd: FormData): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [k, v] of fd.entries()) if (typeof v === "string") out[k] = v;
  return out;
}

export async function createCoupon(formData: FormData): Promise<CouponOpResult> {
  const g = await guard("create", false);
  if ("error" in g) return { error: g.error };
  const parsed = parseCouponForm(fieldsOf(formData), ALL_PLAN_IDS);
  if ("error" in parsed) return { error: parsed.error };
  const c = parsed.coupon;
  const admin = createAdminClient();
  const { data, error } = await admin
    .from("coupons")
    .insert({
      code: c.code,
      description: c.description || null,
      kind: c.kind,
      value: c.value,
      max_redemptions: c.maxRedemptions,
      valid_from: c.validFrom ? `${c.validFrom}T00:00:00+03:00` : null,
      valid_until: c.validUntil ? `${c.validUntil}T23:59:59+03:00` : null,
      plan_ids: c.planIds,
      created_by: g.staff.id,
    })
    .select("id")
    .single();
  if (error) {
    if (error.code === "23505") return { error: "Bu kod zaten var." };
    console.error("createCoupon", error.message);
    return { error: "Kupon oluşturulamadı." };
  }
  await logPlatformActivity({ actorId: g.staff.id, action: "billing.coupon.create", entityType: "coupon", entityId: data.id, meta: { code: c.code, kind: c.kind, value: c.value } });
  revalidatePath("/admin/billing/kuponlar");
  return { ok: true, notice: `${c.code} kuponu oluşturuldu.` };
}

/** Düzenleme: açıklama, kullanım sınırı, tarihler ve paket kapsamı (kod ve değer sonradan değişmez; yeni kupon açın). */
export async function updateCoupon(formData: FormData): Promise<CouponOpResult> {
  const g = await guard("update", false);
  if ("error" in g) return { error: g.error };
  const id = String(formData.get("id") ?? "");
  if (!UUID.test(id)) return { error: "Geçersiz kupon." };
  const admin = createAdminClient();
  const { data: cur } = await admin.from("coupons").select("code, kind, value, redeemed_count").eq("id", id).maybeSingle();
  if (!cur) return { error: "Kupon bulunamadı." };
  const fields = { ...fieldsOf(formData), code: cur.code, kind: cur.kind, value: String(cur.value) };
  const parsed = parseCouponForm(fields, ALL_PLAN_IDS);
  if ("error" in parsed) return { error: parsed.error };
  const c = parsed.coupon;
  if (c.maxRedemptions !== null && c.maxRedemptions < cur.redeemed_count) {
    return { error: `Kullanım sınırı, şimdiye kadarki kullanımdan (${cur.redeemed_count}) az olamaz.` };
  }
  const { error } = await admin
    .from("coupons")
    .update({
      description: c.description || null,
      max_redemptions: c.maxRedemptions,
      valid_from: c.validFrom ? `${c.validFrom}T00:00:00+03:00` : null,
      valid_until: c.validUntil ? `${c.validUntil}T23:59:59+03:00` : null,
      plan_ids: c.planIds,
      updated_at: new Date().toISOString(),
    })
    .eq("id", id);
  if (error) {
    console.error("updateCoupon", error.message);
    return { error: "Kupon güncellenemedi." };
  }
  await logPlatformActivity({ actorId: g.staff.id, action: "billing.coupon.update", entityType: "coupon", entityId: id, meta: { code: cur.code } });
  revalidatePath("/admin/billing/kuponlar");
  return { ok: true, notice: "Kupon güncellendi." };
}

export async function setCouponActive(formData: FormData): Promise<CouponOpResult> {
  const g = await guard("toggle", false);
  if ("error" in g) return { error: g.error };
  const id = String(formData.get("id") ?? "");
  if (!UUID.test(id)) return { error: "Geçersiz kupon." };
  const active = String(formData.get("active") ?? "") === "1";
  const admin = createAdminClient();
  const { data, error } = await admin.from("coupons").update({ is_active: active, updated_at: new Date().toISOString() }).eq("id", id).select("code").maybeSingle();
  if (error || !data) return { error: "Kupon güncellenemedi." };
  await logPlatformActivity({ actorId: g.staff.id, action: active ? "billing.coupon.activate" : "billing.coupon.deactivate", entityType: "coupon", entityId: id, meta: { code: data.code } });
  revalidatePath("/admin/billing/kuponlar");
  return { ok: true, notice: active ? "Kupon etkin." : "Kupon devre dışı." };
}

/** Yalnız hiç kullanılmamış kupon silinir (süper admin); kullanılmışsa devre dışı bırakılır. */
export async function deleteCoupon(formData: FormData): Promise<CouponOpResult> {
  const g = await guard("delete", true);
  if ("error" in g) return { error: g.error };
  const id = String(formData.get("id") ?? "");
  if (!UUID.test(id)) return { error: "Geçersiz kupon." };
  const admin = createAdminClient();
  const { data, error } = await admin.from("coupons").delete().eq("id", id).eq("redeemed_count", 0).select("code").maybeSingle();
  if (error) return { error: "Kupon silinemedi." };
  if (!data) return { error: "Kullanılmış kupon silinemez; devre dışı bırakın." };
  await logPlatformActivity({ actorId: g.staff.id, action: "billing.coupon.delete", entityType: "coupon", entityId: id, meta: { code: data.code } });
  revalidatePath("/admin/billing/kuponlar");
  return { ok: true, notice: "Kupon silindi." };
}
