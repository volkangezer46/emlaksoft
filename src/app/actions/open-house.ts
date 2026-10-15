"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { requirePermission } from "@/lib/require-permission";
import { actionErrorMessage } from "@/lib/action-errors";
import { daysFromNowIso } from "@/lib/clock";
import {
  aggregateConvertOutcomes,
  classifyConvertOutcome,
  OPEN_HOUSE_THANKS_MARK,
  type BulkConvertCounts,
  type ConvertRpcOutcome,
} from "@/lib/open-house-bulk";

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
  if (readError) return { error: actionErrorMessage(readError, "Etkinlik durumu okunamadı.") };
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
  if (error) return { error: actionErrorMessage(error, "Durum güncellenemedi.") };
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

export type ConvertAllVisitorsResult = {
  ok?: boolean;
  error?: string;
  counts?: BulkConvertCounts;
  /** Açılan D+1 teşekkür görevi sayısı (seçenek kapalıysa 0). */
  tasksCreated?: number;
};

/** Tek seferde işlenecek üst sınır — açık ev ziyaretçi listesi bunu pratikte aşmaz. */
const BULK_CONVERT_LIMIT = 300;

/**
 * Açık evin henüz müşteriye dönüşmemiş tüm ziyaretçilerini müşteri kaydına çevirir.
 * Her ziyaretçi için tekli dönüştürmeyle AYNI atomik RPC sırayla çağrılır; ziyaretçi zaten
 * dönüştürülmüşse RPC `replay` döner ve atlanır (tekrar çalıştırmak güvenlidir).
 * `createThankYouTasks` seçiliyse bu çalıştırmada açılan/bağlanan her müşteri için ertesi güne
 * "Teşekkür + geri bildirim" görevi açılır (müşteride aynı açık görev varsa tekrar açılmaz).
 */
export async function convertAllVisitors(
  openHouseId: string,
  options: { createThankYouTasks?: boolean } = {},
): Promise<ConvertAllVisitorsResult> {
  const gate = await requirePermission("customers", "create");
  if (!gate.ok) return { error: gate.error };

  const supabase = await createClient();
  const { data: openHouse, error: ohError } = await supabase
    .from("open_houses")
    .select("id")
    .eq("id", openHouseId)
    .eq("tenant_id", gate.tenantId)
    .maybeSingle();
  if (ohError) return { error: actionErrorMessage(ohError, "Açık ev etkinliği okunamadı.") };
  if (!openHouse) return { error: "Açık ev etkinliği bulunamadı." };

  const { data: visitors, error: vError } = await supabase
    .from("open_house_visitors")
    .select("id")
    .eq("open_house_id", openHouseId)
    .is("created_customer_id", null)
    .order("registered_at", { ascending: true })
    .limit(BULK_CONVERT_LIMIT);
  if (vError) return { error: actionErrorMessage(vError, "Ziyaretçiler okunamadı.") };

  // Sırayla: aynı telefonlu ziyaretçiler RPC içinde zaten kilitle sıralanır; paralel çağrı kazanç getirmez.
  const admin = createAdminClient();
  const results: ConvertRpcOutcome[] = [];
  const touchedCustomers = new Set<string>();
  for (const v of visitors ?? []) {
    const { data, error } = await admin.rpc("convert_open_house_visitor_atomic", {
      p_tenant_id: gate.tenantId,
      p_actor_id: gate.userId,
      p_open_house_id: openHouseId,
      p_visitor_id: v.id,
    });
    if (error) {
      console.error("convertAllVisitors", error);
      results.push(null);
      continue;
    }
    const result = (data ?? {}) as ConvertRpcOutcome;
    results.push(result);
    const bucket = classifyConvertOutcome(result);
    if ((bucket === "created" || bucket === "linked") && result?.customer_id) {
      touchedCustomers.add(result.customer_id);
    }
  }
  const counts = aggregateConvertOutcomes(results);

  let tasksCreated = 0;
  if (options.createThankYouTasks && touchedCustomers.size > 0) {
    tasksCreated = await createThankYouTasks(supabase, gate.tenantId, gate.userId, [...touchedCustomers]);
  }

  revalidatePath(`/app/acik-ev/${openHouseId}`);
  revalidatePath("/app/musteriler");
  if (tasksCreated > 0) revalidatePath("/app/gorevler");
  return { ok: true, counts, tasksCreated };
}

/** D+1 teşekkür görevleri; hata dönüştürmeyi geri almaz, yalnızca 0 görev sayılır. */
async function createThankYouTasks(
  supabase: Awaited<ReturnType<typeof createClient>>,
  tenantId: string,
  userId: string,
  customerIds: string[],
): Promise<number> {
  const { data: customers, error: cError } = await supabase
    .from("customers")
    .select("id, full_name, assigned_to")
    .eq("tenant_id", tenantId)
    .in("id", customerIds);
  if (cError) {
    console.error("convertAllVisitors customers", cError);
    return 0;
  }
  const { data: existing, error: tError } = await supabase
    .from("tasks")
    .select("customer_id")
    .eq("tenant_id", tenantId)
    .eq("status", "open")
    .in("customer_id", customerIds)
    .like("title", `%${OPEN_HOUSE_THANKS_MARK}%`);
  if (tError) {
    console.error("convertAllVisitors tasks", tError);
    return 0;
  }
  const alreadyOpen = new Set((existing ?? []).map((t) => t.customer_id as string));
  const fresh = (customers ?? []).filter((c) => !alreadyOpen.has(c.id));
  if (!fresh.length) return 0;

  const dueAt = daysFromNowIso(1);
  const { error } = await supabase.from("tasks").insert(
    fresh.map((c) => ({
      tenant_id: tenantId,
      title: `${c.full_name} — ${OPEN_HOUSE_THANKS_MARK}`,
      notes: "Açık eve katıldığı için teşekkür edin ve mülk hakkındaki geri bildirimini alın.",
      kind: "followup",
      priority: "normal",
      status: "open",
      due_at: dueAt,
      assigned_to: c.assigned_to ?? userId,
      customer_id: c.id,
      created_by: userId,
    })),
  );
  if (error) {
    console.error("convertAllVisitors task insert", error);
    return 0;
  }
  return fresh.length;
}
