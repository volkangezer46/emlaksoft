"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { requirePermission } from "@/lib/require-permission";
import { logActivity } from "@/lib/activity";
import { actionErrorMessage } from "@/lib/action-errors";
import type { NetworkResult } from "./shared";

// ============================================================
// Paylaşım yönetimi — yalnız kendi portföyü, RLS'li client
// ============================================================

export async function shareToNetwork(_prev: NetworkResult, fd: FormData): Promise<NetworkResult> {
  const gate = await requirePermission("network", "create");
  if (!gate.ok) return { error: gate.error };

  const propertyId = String(fd.get("property_id") ?? "").trim();
  const pctRaw = Number(String(fd.get("commission_share_pct") ?? "").replace(",", "."));
  const note = String(fd.get("note") ?? "").trim() || null;

  if (!propertyId) return { error: "Paylaşılacak portföyü seçin." };
  if (!Number.isFinite(pctRaw) || pctRaw < 0 || pctRaw > 50) {
    return { error: "Komisyon paylaşımı %0–50 aralığında olmalıdır." };
  }

  const supabase = await createClient();

  // Yalnız kendi portföyü + yayında (live) şartı — RLS zaten tenant'a kilitli,
  // yine de tenant_id eşitliğini açık yazıyoruz (savunma katmanı).
  const { data: property } = await supabase
    .from("properties")
    .select("id, status, deleted_at")
    .eq("id", propertyId)
    .eq("tenant_id", gate.tenantId)
    .maybeSingle();

  if (!property || property.deleted_at) return { error: "Portföy bulunamadı." };
  const st = String(property.status).toLocaleLowerCase("tr-TR");
  if (st !== "live" && st !== "yayında") {
    return { error: "Yalnız yayında (live) durumundaki portföyler ağda paylaşılabilir." };
  }

  // unique(property_id): tekrar paylaşımda mevcut kaydı güncelle + aktifleştir.
  const { data: row, error } = await supabase
    .from("network_listings")
    .upsert(
      {
        tenant_id: gate.tenantId,
        property_id: propertyId,
        commission_share_pct: pctRaw,
        note,
        status: "active",
        created_by: gate.userId,
      },
      { onConflict: "property_id" },
    )
    .select("id")
    .single();

  if (error) {
    console.error("shareToNetwork", error);
    return { error: "Portföy ağda paylaşılamadı." };
  }

  await logActivity({
    tenantId: gate.tenantId,
    actorId: gate.userId,
    action: "network.share",
    entityType: "network_listing",
    entityId: row.id,
    newValue: { property_id: propertyId, commission_share_pct: pctRaw },
  });

  revalidatePath("/app/ag");
  return { ok: true, id: row.id };
}

async function setListingStatus(id: string, status: "active" | "paused"): Promise<NetworkResult> {
  const gate = await requirePermission("network", "edit");
  if (!gate.ok) return { error: gate.error };

  const supabase = await createClient();
  const { error } = await supabase
    .from("network_listings")
    .update({ status })
    .eq("id", id)
    .eq("tenant_id", gate.tenantId);

  if (error) {
    console.error("setListingStatus", error);
    return { error: actionErrorMessage(error, "Ağ kaydı güncellenemedi.") };
  }

  await logActivity({
    tenantId: gate.tenantId,
    actorId: gate.userId,
    action: status === "paused" ? "network.pause" : "network.resume",
    entityType: "network_listing",
    entityId: id,
  });

  revalidatePath("/app/ag");
  return { ok: true };
}

export async function pauseNetworkListing(id: string): Promise<NetworkResult> {
  return setListingStatus(id, "paused");
}

export async function resumeNetworkListing(id: string): Promise<NetworkResult> {
  return setListingStatus(id, "active");
}

export async function removeFromNetwork(id: string): Promise<NetworkResult> {
  const gate = await requirePermission("network", "edit");
  if (!gate.ok) return { error: gate.error };

  const supabase = await createClient();
  const { error } = await supabase
    .from("network_listings")
    .delete()
    .eq("id", id)
    .eq("tenant_id", gate.tenantId);

  if (error) {
    console.error("removeFromNetwork", error);
    return { error: actionErrorMessage(error, "Ağ kaydı kaldırılamadı.") };
  }

  await logActivity({
    tenantId: gate.tenantId,
    actorId: gate.userId,
    action: "network.remove",
    entityType: "network_listing",
    entityId: id,
  });

  revalidatePath("/app/ag");
  return { ok: true };
}
