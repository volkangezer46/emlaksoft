"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { requirePermission } from "@/lib/require-permission";
import { logActivity } from "@/lib/activity";
import { notifyTenant } from "@/lib/notify";
import { now } from "@/lib/clock";
import { actionErrorMessage } from "@/lib/action-errors";
import { DAILY_REQUEST_LIMIT, OPEN_DEMAND_STATUSES, type NetworkResult } from "./shared";

// ============================================================
// Talep paylaşım yönetimi — yalnız kendi talebi, RLS'li client
// ============================================================

export async function shareDemandToNetwork(_prev: NetworkResult, fd: FormData): Promise<NetworkResult> {
  const gate = await requirePermission("network", "create");
  if (!gate.ok) return { error: gate.error };

  const demandId = String(fd.get("demand_id") ?? "").trim();
  const pctRaw = Number(String(fd.get("commission_share_pct") ?? "").replace(",", "."));
  const note = String(fd.get("note") ?? "").trim() || null;

  if (!demandId) return { error: "Paylaşılacak talebi seçin." };
  if (!Number.isFinite(pctRaw) || pctRaw < 0 || pctRaw > 50) {
    return { error: "Komisyon paylaşımı %0–50 aralığında olmalıdır." };
  }

  const supabase = await createClient();

  // Yalnız kendi talebi + açık (new/active/matched) şartı — RLS zaten tenant'a
  // kilitli, tenant_id eşitliği savunma katmanı.
  const { data: demand } = await supabase
    .from("customer_demands")
    .select("id, status")
    .eq("id", demandId)
    .eq("tenant_id", gate.tenantId)
    .maybeSingle();

  if (!demand) return { error: "Talep bulunamadı." };
  if (!OPEN_DEMAND_STATUSES.includes(String(demand.status))) {
    return { error: "Yalnız açık durumdaki talepler ağda paylaşılabilir." };
  }

  // unique(demand_id): tekrar paylaşımda mevcut kaydı güncelle + aktifleştir.
  const { data: row, error } = await supabase
    .from("network_demands")
    .upsert(
      {
        tenant_id: gate.tenantId,
        demand_id: demandId,
        commission_share_pct: pctRaw,
        note,
        status: "active",
        created_by: gate.userId,
      },
      { onConflict: "demand_id" },
    )
    .select("id")
    .single();

  if (error) {
    console.error("shareDemandToNetwork", error);
    return { error: "Talep ağda paylaşılamadı." };
  }

  await logActivity({
    tenantId: gate.tenantId,
    actorId: gate.userId,
    action: "network.demand_share",
    entityType: "network_demand",
    entityId: row.id,
    newValue: { demand_id: demandId, commission_share_pct: pctRaw },
  });

  revalidatePath("/app/ag");
  return { ok: true, id: row.id };
}

async function setDemandStatus(id: string, status: "active" | "paused"): Promise<NetworkResult> {
  const gate = await requirePermission("network", "edit");
  if (!gate.ok) return { error: gate.error };

  const supabase = await createClient();
  const { error } = await supabase
    .from("network_demands")
    .update({ status })
    .eq("id", id)
    .eq("tenant_id", gate.tenantId);

  if (error) {
    console.error("setDemandStatus", error);
    return { error: actionErrorMessage(error, "Ağ talep kaydı güncellenemedi.") };
  }

  await logActivity({
    tenantId: gate.tenantId,
    actorId: gate.userId,
    action: status === "paused" ? "network.demand_pause" : "network.demand_resume",
    entityType: "network_demand",
    entityId: id,
  });

  revalidatePath("/app/ag");
  return { ok: true };
}

export async function pauseDemand(id: string): Promise<NetworkResult> {
  return setDemandStatus(id, "paused");
}

export async function resumeDemand(id: string): Promise<NetworkResult> {
  return setDemandStatus(id, "active");
}

export async function removeDemandFromNetwork(id: string): Promise<NetworkResult> {
  const gate = await requirePermission("network", "edit");
  if (!gate.ok) return { error: gate.error };

  const supabase = await createClient();
  const { error } = await supabase
    .from("network_demands")
    .delete()
    .eq("id", id)
    .eq("tenant_id", gate.tenantId);

  if (error) {
    console.error("removeDemandFromNetwork", error);
    return { error: actionErrorMessage(error, "Ağ talep kaydı kaldırılamadı.") };
  }

  await logActivity({
    tenantId: gate.tenantId,
    actorId: gate.userId,
    action: "network.demand_remove",
    entityType: "network_demand",
    entityId: id,
  });

  revalidatePath("/app/ag");
  return { ok: true };
}

// ============================================================
// Talep yanıtları — "uygun portföyüm var"
// ============================================================

export async function respondToNetworkDemand(_prev: NetworkResult, fd: FormData): Promise<NetworkResult> {
  const gate = await requirePermission("network", "create");
  if (!gate.ok) return { error: gate.error };

  const networkDemandId = String(fd.get("network_demand_id") ?? "").trim();
  const propertyHint = String(fd.get("property_hint") ?? "").trim();
  const message = String(fd.get("message") ?? "").trim() || null;

  if (!networkDemandId) return { error: "Talep bulunamadı." };
  if (!propertyHint) return { error: "Portföy özetini yazın." };
  if (propertyHint.length > 300) return { error: "Portföy özeti en fazla 300 karakter olabilir." };
  if (message && message.length > 1000) return { error: "Mesaj en fazla 1000 karakter olabilir." };

  const admin = createAdminClient();

  // Talep kaydı başka tenant'a ait → doğrulama service role ile.
  const { data: nd } = await admin
    .from("network_demands")
    .select("id, tenant_id, status")
    .eq("id", networkDemandId)
    .maybeSingle();

  if (!nd || nd.status !== "active") return { error: "Talep artık ağda aktif değil." };
  if (nd.tenant_id === gate.tenantId) return { error: "Kendi talebinize yanıt gönderemezsiniz." };

  // Aynı talebe açık (pending/accepted) mükerrer yanıt engeli.
  const { count: dupCount } = await admin
    .from("network_demand_responses")
    .select("id", { count: "exact", head: true })
    .eq("network_demand_id", networkDemandId)
    .eq("from_tenant_id", gate.tenantId)
    .in("status", ["pending", "accepted"]);
  if ((dupCount ?? 0) > 0) return { error: "Bu talebe zaten açık bir yanıtınız var." };

  // Rate limit: ofis başına günde 20 yanıt (portföy tarafıyla aynı desen).
  const dayStart = `${new Date(now()).toISOString().slice(0, 10)}T00:00:00Z`;
  const { count: todayCount } = await admin
    .from("network_demand_responses")
    .select("id", { count: "exact", head: true })
    .eq("from_tenant_id", gate.tenantId)
    .gte("created_at", dayStart);
  if ((todayCount ?? 0) >= DAILY_REQUEST_LIMIT) {
    return { error: `Günlük yanıt sınırına ulaştınız (${DAILY_REQUEST_LIMIT}/gün). Yarın tekrar deneyin.` };
  }

  const { data: row, error } = await admin
    .from("network_demand_responses")
    .insert({
      network_demand_id: networkDemandId,
      from_tenant_id: gate.tenantId,
      to_tenant_id: nd.tenant_id,
      property_hint: propertyHint,
      message,
      created_by: gate.userId,
    })
    .select("id")
    .single();

  if (error) {
    console.error("respondToNetworkDemand", error);
    return { error: actionErrorMessage(error, "Yanıt gönderilemedi.") };
  }

  const { data: myOffice } = await admin.from("tenants").select("name").eq("id", gate.tenantId).maybeSingle();
  await notifyTenant({
    tenantId: nd.tenant_id,
    title: "Talebinize portföy önerisi geldi",
    body: `${myOffice?.name ?? "Bir ofis"} ağdaki talebiniz için uygun portföyü olduğunu bildirdi.`,
    href: "/app/ag#paylastigim-talepler",
    kind: "info",
  });

  await logActivity({
    tenantId: gate.tenantId,
    actorId: gate.userId,
    action: "network.demand_response_sent",
    entityType: "network_demand_response",
    entityId: row.id,
    newValue: { network_demand_id: networkDemandId },
  });

  revalidatePath("/app/ag");
  return { ok: true, id: row.id };
}

async function decideDemandResponse(id: string, decision: "accept" | "reject"): Promise<NetworkResult> {
  const gate = await requirePermission("network", "edit");
  if (!gate.ok) return { error: gate.error };

  const admin = createAdminClient();
  const { data: response } = await admin
    .from("network_demand_responses")
    .select("id, from_tenant_id, to_tenant_id, status")
    .eq("id", id)
    .eq("to_tenant_id", gate.tenantId) // yalnız kendine gelen yanıtı karara bağlar
    .maybeSingle();

  if (!response) return { error: "Yanıt bulunamadı." };
  if (response.status !== "pending") return { error: "Bu yanıt zaten karara bağlanmış." };

  const status = decision === "accept" ? "accepted" : "rejected";

  // to tarafının kendi satır güncellemesi → RLS'li client yeterli
  // (network_demand_responses_respond politikası tam bu geçişe izin verir).
  const supabase = await createClient();
  const { error } = await supabase
    .from("network_demand_responses")
    .update({ status, responded_at: new Date(now()).toISOString() })
    .eq("id", id);

  if (error) {
    console.error("decideDemandResponse", error);
    return { error: actionErrorMessage(error, "Yanıt karara bağlanamadı.") };
  }

  const { data: offices } = await admin
    .from("tenants")
    .select("id, name")
    .in("id", [response.from_tenant_id, response.to_tenant_id]);
  const nameOf = (tid: string) => (offices ?? []).find((o) => o.id === tid)?.name ?? "Bir ofis";

  if (decision === "accept") {
    // Kabulde HER İKİ tarafa bildirim; iletişim detayları listelerde açılır.
    await Promise.all([
      notifyTenant({
        tenantId: response.from_tenant_id,
        title: "Portföy öneriniz kabul edildi",
        body: `${nameOf(response.to_tenant_id)} önerinizi kabul etti — iletişim bilgileri Talep Yanıtlarım bölümünde açıldı.`,
        href: "/app/ag#talep-yanitlarim",
        kind: "success",
      }),
      notifyTenant({
        tenantId: response.to_tenant_id,
        title: "İş birliği başlatıldı",
        body: `${nameOf(response.from_tenant_id)} ofisinin portföy önerisini kabul ettiniz.`,
        href: "/app/ag#paylastigim-talepler",
        kind: "success",
      }),
    ]);
  } else {
    await notifyTenant({
      tenantId: response.from_tenant_id,
      title: "Portföy öneriniz reddedildi",
      body: `${nameOf(response.to_tenant_id)} ağdaki portföy önerinizi reddetti.`,
      href: "/app/ag#talep-yanitlarim",
      kind: "warning",
    });
  }

  await logActivity({
    tenantId: gate.tenantId,
    actorId: gate.userId,
    action: decision === "accept" ? "network.demand_response_accepted" : "network.demand_response_rejected",
    entityType: "network_demand_response",
    entityId: id,
  });

  revalidatePath("/app/ag");
  return { ok: true };
}

export async function acceptDemandResponse(id: string): Promise<NetworkResult> {
  return decideDemandResponse(id, "accept");
}

export async function rejectDemandResponse(id: string): Promise<NetworkResult> {
  return decideDemandResponse(id, "reject");
}

export async function withdrawDemandResponse(id: string): Promise<NetworkResult> {
  const gate = await requirePermission("network", "edit");
  if (!gate.ok) return { error: gate.error };

  // from tarafının kendi satırı → RLS'li client (withdraw politikası).
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("network_demand_responses")
    .update({ status: "withdrawn" })
    .eq("id", id)
    .eq("from_tenant_id", gate.tenantId)
    .eq("status", "pending")
    .select("id");

  if (error) {
    console.error("withdrawDemandResponse", error);
    return { error: "Yanıt geri çekilemedi." };
  }
  if (!data || data.length === 0) return { error: "Yalnız bekleyen yanıtlar geri çekilebilir." };

  await logActivity({
    tenantId: gate.tenantId,
    actorId: gate.userId,
    action: "network.demand_response_withdrawn",
    entityType: "network_demand_response",
    entityId: id,
  });

  revalidatePath("/app/ag");
  return { ok: true };
}
