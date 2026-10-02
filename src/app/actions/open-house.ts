"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { requirePermission } from "@/lib/require-permission";

export type OpenHouseActionResult = { ok?: boolean; error?: string; id?: string };

const OPEN_HOUSE_STATUSES = ["planned", "active", "completed", "cancelled"] as const;
type OpenHouseStatus = (typeof OPEN_HOUSE_STATUSES)[number];

const OPEN_HOUSE_TRANSITIONS: Record<OpenHouseStatus, readonly OpenHouseStatus[]> = {
  planned: ["active", "cancelled"],
  active: ["completed", "cancelled"],
  completed: [],
  cancelled: [],
};

function isOpenHouseStatus(value: string): value is OpenHouseStatus {
  return (OPEN_HOUSE_STATUSES as readonly string[]).includes(value);
}

/** Açık ev etkinliğinin durumunu değiştirir (planned → active → completed / cancelled). */
export async function updateOpenHouseStatus(
  openHouseId: string,
  status: string,
): Promise<OpenHouseActionResult> {
  const gate = await requirePermission("open_house", "edit");
  if (!gate.ok) return { error: gate.error };
  if (!isOpenHouseStatus(status)) {
    return { error: "Geçersiz durum." };
  }

  const supabase = await createClient();
  const { data: current, error: readError } = await supabase
    .from("open_houses")
    .select("status")
    .eq("id", openHouseId)
    .eq("tenant_id", gate.tenantId)
    .maybeSingle();
  if (readError) return { error: "Etkinlik durumu okunamadı." };
  if (!current || !isOpenHouseStatus(current.status)) return { error: "Açık ev etkinliği bulunamadı." };
  if (current.status === status) return { ok: true };
  if (!OPEN_HOUSE_TRANSITIONS[current.status].includes(status)) {
    return { error: "Bu durum geçişine izin verilmiyor." };
  }

  const { data: updated, error } = await supabase
    .from("open_houses")
    .update({ status })
    .eq("id", openHouseId)
    .eq("tenant_id", gate.tenantId)
    .eq("status", current.status)
    .select("id")
    .maybeSingle();
  if (error) return { error: "Durum güncellenemedi." };
  if (!updated) return { error: "Etkinlik durumu başka bir işlemde değişti. Sayfayı yenileyip tekrar deneyin." };

  revalidatePath("/app/acik-ev");
  revalidatePath(`/app/acik-ev/${openHouseId}`);
  return { ok: true };
}

/**
 * Açık ev ziyaretçisini müşteri kaydına dönüştürür.
 * Aynı telefon zaten kayıtlıysa yeni kayıt açmaz, mevcut müşteriye bağlar
 * (lead-intake'teki mükerrer önleme davranışıyla aynı).
 */
export async function convertVisitorToCustomer(
  visitorId: string,
  openHouseId: string,
): Promise<OpenHouseActionResult> {
  const gate = await requirePermission("customers", "create");
  if (!gate.ok) return { error: gate.error };

  const admin = createAdminClient();
  const { data, error } = await admin.rpc("convert_open_house_visitor_atomic", {
    p_tenant_id: gate.tenantId,
    p_actor_id: gate.userId,
    p_open_house_id: openHouseId,
    p_visitor_id: visitorId,
  });
  if (error) {
    console.error("convertVisitorToCustomer", error);
    return { error: "Ziyaretçi müşteriye dönüştürülemedi." };
  }
  const result = (data ?? {}) as { outcome?: string; customer_id?: string };
  if (result.outcome === "not_found") return { error: "Ziyaretçi bu açık ev etkinliğinde bulunamadı." };
  if (result.outcome === "invalid_visitor") return { error: "Ziyaretçi bilgileri müşteri kaydı için geçersiz." };
  if (!["created", "linked", "replay"].includes(result.outcome ?? "") || !result.customer_id) {
    return { error: "Ziyaretçi müşteriye dönüştürülemedi." };
  }

  revalidatePath(`/app/acik-ev/${openHouseId}`);
  revalidatePath("/app/musteriler");
  return { ok: true, id: result.customer_id };
}
