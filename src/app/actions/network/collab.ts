"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { requirePermission } from "@/lib/require-permission";
import { logActivity } from "@/lib/activity";
import { notifyTenant } from "@/lib/notify";
import { now } from "@/lib/clock";
import { actionErrorMessage } from "@/lib/action-errors";
import { DAILY_REQUEST_LIMIT, type NetworkResult } from "./shared";

// ============================================================
// Talepler
// ============================================================

export async function sendCollabRequest(_prev: NetworkResult, fd: FormData): Promise<NetworkResult> {
  const gate = await requirePermission("network", "create");
  if (!gate.ok) return { error: gate.error };

  const listingId = String(fd.get("listing_id") ?? "").trim();
  const message = String(fd.get("message") ?? "").trim();
  if (!listingId) return { error: "İlan bulunamadı." };
  if (!message) return { error: "Karşı ofise kısa bir mesaj yazın." };
  if (message.length > 1000) return { error: "Mesaj en fazla 1000 karakter olabilir." };

  const admin = createAdminClient();

  // İlan başka bir tenant'a ait → doğrulama service role ile (RLS bizi görmez).
  const { data: listing } = await admin
    .from("network_listings")
    .select("id, tenant_id, status")
    .eq("id", listingId)
    .maybeSingle();

  if (!listing || listing.status !== "active") return { error: "İlan artık ağda aktif değil." };
  if (listing.tenant_id === gate.tenantId) return { error: "Kendi ilanınıza talep gönderemezsiniz." };

  // Aynı ilana açık (pending/accepted) mükerrer talep engeli.
  const { count: dupCount } = await admin
    .from("network_requests")
    .select("id", { count: "exact", head: true })
    .eq("listing_id", listingId)
    .eq("from_tenant_id", gate.tenantId)
    .in("status", ["pending", "accepted"]);
  if ((dupCount ?? 0) > 0) return { error: "Bu ilana zaten açık bir talebiniz var." };

  // Rate limit: ofis başına günde 20 talep (basit sayım, gün başlangıcı UTC).
  const dayStart = `${new Date(now()).toISOString().slice(0, 10)}T00:00:00Z`;
  const { count: todayCount } = await admin
    .from("network_requests")
    .select("id", { count: "exact", head: true })
    .eq("from_tenant_id", gate.tenantId)
    .gte("created_at", dayStart);
  if ((todayCount ?? 0) >= DAILY_REQUEST_LIMIT) {
    return { error: `Günlük talep sınırına ulaştınız (${DAILY_REQUEST_LIMIT}/gün). Yarın tekrar deneyin.` };
  }

  const { data: row, error } = await admin
    .from("network_requests")
    .insert({
      listing_id: listingId,
      from_tenant_id: gate.tenantId,
      to_tenant_id: listing.tenant_id,
      message,
      created_by: gate.userId,
    })
    .select("id")
    .single();

  if (error) {
    console.error("sendCollabRequest", error);
    return { error: actionErrorMessage(error, "Talep gönderilemedi.") };
  }

  const { data: myOffice } = await admin.from("tenants").select("name").eq("id", gate.tenantId).maybeSingle();
  await notifyTenant({
    tenantId: listing.tenant_id,
    title: "Ağdan iş birliği talebi",
    body: `${myOffice?.name ?? "Bir ofis"} ağdaki ilanınız için iş birliği talep etti.`,
    href: "/app/ag#paylastiklarim",
    kind: "info",
  });

  await logActivity({
    tenantId: gate.tenantId,
    actorId: gate.userId,
    action: "network.request_sent",
    entityType: "network_request",
    entityId: row.id,
    newValue: { listing_id: listingId },
  });

  revalidatePath("/app/ag");
  return { ok: true, id: row.id };
}

export async function respondCollabRequest(id: string, decision: "accept" | "reject"): Promise<NetworkResult> {
  const gate = await requirePermission("network", "edit");
  if (!gate.ok) return { error: gate.error };

  const admin = createAdminClient();
  const { data: request } = await admin
    .from("network_requests")
    .select("id, listing_id, from_tenant_id, to_tenant_id, status")
    .eq("id", id)
    .eq("to_tenant_id", gate.tenantId) // yalnız kendine gelen talebi yanıtlar
    .maybeSingle();

  if (!request) return { error: "Talep bulunamadı." };
  if (request.status !== "pending") return { error: "Bu talep zaten yanıtlanmış." };

  const status = decision === "accept" ? "accepted" : "rejected";

  // Yanıt to tarafının kendi satır güncellemesi → RLS'li client yeterli
  // (network_requests_respond politikası tam bu geçişe izin verir).
  const supabase = await createClient();
  const { error } = await supabase
    .from("network_requests")
    .update({ status, responded_at: new Date(now()).toISOString() })
    .eq("id", id);

  if (error) {
    console.error("respondCollabRequest", error);
    return { error: "Talep yanıtlanamadı." };
  }

  const { data: offices } = await admin
    .from("tenants")
    .select("id, name")
    .in("id", [request.from_tenant_id, request.to_tenant_id]);
  const nameOf = (tid: string) => (offices ?? []).find((o) => o.id === tid)?.name ?? "Bir ofis";

  if (decision === "accept") {
    // Kabulde HER İKİ tarafa bildirim; iletişim detayları listelerde açılır.
    await Promise.all([
      notifyTenant({
        tenantId: request.from_tenant_id,
        title: "İş birliği talebiniz kabul edildi",
        body: `${nameOf(request.to_tenant_id)} talebinizi kabul etti — iletişim bilgileri Taleplerim bölümünde açıldı.`,
        href: "/app/ag#taleplerim",
        kind: "success",
      }),
      notifyTenant({
        tenantId: request.to_tenant_id,
        title: "İş birliği başlatıldı",
        body: `${nameOf(request.from_tenant_id)} ile iş birliği talebini kabul ettiniz.`,
        href: "/app/ag#paylastiklarim",
        kind: "success",
      }),
    ]);
  } else {
    await notifyTenant({
      tenantId: request.from_tenant_id,
      title: "İş birliği talebi reddedildi",
      body: `${nameOf(request.to_tenant_id)} ağdaki talebinizi reddetti.`,
      href: "/app/ag#taleplerim",
      kind: "warning",
    });
  }

  await logActivity({
    tenantId: gate.tenantId,
    actorId: gate.userId,
    action: decision === "accept" ? "network.request_accepted" : "network.request_rejected",
    entityType: "network_request",
    entityId: id,
  });

  revalidatePath("/app/ag");
  return { ok: true };
}

export async function withdrawRequest(id: string): Promise<NetworkResult> {
  const gate = await requirePermission("network", "edit");
  if (!gate.ok) return { error: gate.error };

  // from tarafının kendi satırı → RLS'li client (network_requests_withdraw politikası).
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("network_requests")
    .update({ status: "withdrawn" })
    .eq("id", id)
    .eq("from_tenant_id", gate.tenantId)
    .eq("status", "pending")
    .select("id");

  if (error) {
    console.error("withdrawRequest", error);
    return { error: "Talep geri çekilemedi." };
  }
  if (!data || data.length === 0) return { error: "Yalnız bekleyen talepler geri çekilebilir." };

  await logActivity({
    tenantId: gate.tenantId,
    actorId: gate.userId,
    action: "network.request_withdrawn",
    entityType: "network_request",
    entityId: id,
  });

  revalidatePath("/app/ag");
  return { ok: true };
}
