"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { requirePermission } from "@/lib/require-permission";
import { logActivity } from "@/lib/activity";
import { notifyTenant } from "@/lib/notify";
import { canDecide, isApprovalKind, kindMeta, MANAGER_ROLES } from "@/lib/approvals";

export type ApprovalResult = { ok?: boolean; error?: string; id?: string };

const PATH = "/app/onaylar";

/** "3,5" gibi TR ondalık girişini de kabul eder; boş/geçersiz → null. */
function num(v: FormDataEntryValue | null): number | null {
  const raw = String(v ?? "").trim().replace(",", ".");
  if (!raw) return null;
  const n = Number(raw);
  return Number.isFinite(n) ? n : null;
}

const ENTITY_TYPES = ["deal", "expense", "property"] as const;

/**
 * Yeni onay talebi.
 *
 * Yetki bilinçli olarak GEVŞEK (`commissions:view`): talep açmak bir imtiyaz
 * değil, sürecin kendisi — danışman zaten bu konuşmayı sözlü yapıyor, amaç onu
 * kayda almak. Karar verme yetkisi ayrı (bkz. `decideApproval`).
 */
export async function createApprovalRequest(
  _prev: ApprovalResult,
  fd: FormData,
): Promise<ApprovalResult> {
  const gate = await requirePermission("commissions", "view");
  if (!gate.ok) return { error: gate.error };

  const kind = String(fd.get("kind") ?? "").trim();
  if (!isApprovalKind(kind)) return { error: "Geçerli bir talep türü seçin." };

  const title = String(fd.get("title") ?? "").trim();
  if (!title) return { error: "Başlık zorunludur." };
  if (title.length > 200) return { error: "Başlık en fazla 200 karakter olabilir." };

  const description = String(fd.get("description") ?? "").trim() || null;
  const currentValue = num(fd.get("current_value"));
  const requestedValue = num(fd.get("requested_value"));
  const amount = num(fd.get("amount")) ?? requestedValue;

  const entityRaw = String(fd.get("entity_type") ?? "").trim();
  const entityType = (ENTITY_TYPES as readonly string[]).includes(entityRaw) ? entityRaw : null;
  const entityId = String(fd.get("entity_id") ?? "").trim() || null;
  // İlgili kayıt ya çift olarak gelir ya hiç — yarım referans linki kırardı.
  const linkedType = entityType && entityId ? entityType : null;
  const linkedId = linkedType ? entityId : null;

  const supabase = await createClient();
  const { data, error } = await supabase
    .from("approval_requests")
    .insert({
      tenant_id: gate.tenantId,
      kind,
      title,
      description,
      amount,
      current_value: currentValue,
      requested_value: requestedValue,
      entity_type: linkedType,
      entity_id: linkedId,
      status: "bekliyor",
      requested_by: gate.userId,
    })
    .select("id")
    .single();

  if (error || !data) return { error: "Talep kaydedilemedi." };

  await logActivity({
    tenantId: gate.tenantId,
    actorId: gate.userId,
    action: "approval_request_created",
    entityType: "approval_request",
    entityId: data.id,
    newValue: { kind, title, current_value: currentValue, requested_value: requestedValue },
  });

  // Yöneticilere bildirim. Tercih anahtarı GEÇİLMİYOR: bu bir pazarlama/özet
  // bildirimi değil, iş akışını bloklayan bir karar isteği — susturulmamalı.
  const { data: managers } = await supabase
    .from("profiles")
    .select("id")
    .eq("tenant_id", gate.tenantId)
    .in("role", [...MANAGER_ROLES]);

  await Promise.all(
    (managers ?? [])
      .filter((m) => m.id !== gate.userId)
      .map((m) =>
        notifyTenant({
          tenantId: gate.tenantId,
          userId: m.id,
          title: `🔔 Onay bekliyor: ${title}`,
          body: `${kindMeta(kind).label} · karar bekleniyor`,
          href: "/app/onaylar?durum=bekliyor",
          kind: "warning",
        }),
      ),
  );

  revalidatePath(PATH);
  return { ok: true, id: data.id };
}

/**
 * Onay / ret kararı.
 *
 * ÜÇ KAPI birden:
 *  1. `commissions:edit` — modül yetkisi (tenant override'ları dahil)
 *  2. `isManagerRole(gate.role)` — kademe kontrolü. accounting rolü commissions'ta
 *     tam CRUD'a sahip ama indirim politikasına karar veremez.
 *  3. `requested_by !== userId` — KENDİ TALEBİNİ ONAYLAYAMAZ. Bu kural olmadan
 *     modülün tamamı anlamsız: yönetici kendi indirimini kendi onaylarsa kayıt
 *     "iz" değil, sadece formalite olur.
 */
export async function decideApproval(
  _prev: ApprovalResult,
  fd: FormData,
): Promise<ApprovalResult> {
  const gate = await requirePermission("commissions", "edit");
  if (!gate.ok) return { error: gate.error };

  const id = String(fd.get("id") ?? "").trim();
  if (!id) return { error: "Talep bulunamadı." };

  const decision = String(fd.get("decision") ?? "").trim();
  if (decision !== "onaylandi" && decision !== "reddedildi") {
    return { error: "Geçersiz karar." };
  }

  const note = String(fd.get("decision_note") ?? "").trim();
  // Ret gerekçesi ZORUNLU — gerekçesiz ret, sözlü redden farksız olurdu.
  if (decision === "reddedildi" && !note) {
    return { error: "Ret için gerekçe zorunludur." };
  }

  const supabase = await createClient();
  const { data: row } = await supabase
    .from("approval_requests")
    .select("id, title, kind, status, requested_by")
    .eq("id", id)
    .eq("tenant_id", gate.tenantId)
    .maybeSingle();

  if (!row) return { error: "Talep bulunamadı." };

  // Kademe + durum + "kendi talebini onaylayamaz" tek yerde (test kapsamında).
  const verdict = canDecide({
    role: gate.role,
    status: row.status,
    requestedBy: row.requested_by,
    userId: gate.userId,
  });
  if (!verdict.ok) return { error: verdict.error };

  const { error } = await supabase
    .from("approval_requests")
    .update({
      status: decision,
      decided_by: gate.userId,
      decided_at: new Date().toISOString(),
      decision_note: note || null,
      updated_at: new Date().toISOString(),
    })
    .eq("id", id)
    .eq("tenant_id", gate.tenantId)
    .eq("status", "bekliyor"); // yarış koşulu: iki yönetici aynı anda karar veremez

  if (error) return { error: "Karar kaydedilemedi." };

  await logActivity({
    tenantId: gate.tenantId,
    actorId: gate.userId,
    action: decision === "onaylandi" ? "approval_request_approved" : "approval_request_rejected",
    entityType: "approval_request",
    entityId: id,
    oldValue: { status: row.status },
    newValue: { status: decision, decision_note: note || null },
  });

  if (row.requested_by) {
    await notifyTenant({
      tenantId: gate.tenantId,
      userId: row.requested_by,
      title: decision === "onaylandi" ? `✅ Onaylandı: ${row.title}` : `❌ Reddedildi: ${note}`,
      body: decision === "onaylandi" ? (note || `${kindMeta(row.kind).label} talebiniz onaylandı.`) : row.title,
      href: `/app/onaylar?durum=${decision}&kim=benim`,
      kind: decision === "onaylandi" ? "success" : "danger",
    });
  }

  revalidatePath(PATH);
  return { ok: true, id };
}

/** Talebi geri çek — YALNIZ sahibi, YALNIZ bekliyorken. Satır silinmez, `iptal` olur. */
export async function cancelApprovalRequest(
  _prev: ApprovalResult,
  fd: FormData,
): Promise<ApprovalResult> {
  const gate = await requirePermission("commissions", "view");
  if (!gate.ok) return { error: gate.error };

  const id = String(fd.get("id") ?? "").trim();
  if (!id) return { error: "Talep bulunamadı." };

  const supabase = await createClient();
  const { data: row } = await supabase
    .from("approval_requests")
    .select("id, title, status, requested_by")
    .eq("id", id)
    .eq("tenant_id", gate.tenantId)
    .maybeSingle();

  if (!row) return { error: "Talep bulunamadı." };
  if (row.requested_by !== gate.userId) return { error: "Yalnızca talebi açan kişi iptal edebilir." };
  if (row.status !== "bekliyor") return { error: "Yalnızca bekleyen talepler iptal edilebilir." };

  const { error } = await supabase
    .from("approval_requests")
    .update({ status: "iptal", updated_at: new Date().toISOString() })
    .eq("id", id)
    .eq("tenant_id", gate.tenantId)
    .eq("requested_by", gate.userId)
    .eq("status", "bekliyor");

  if (error) return { error: "Talep iptal edilemedi." };

  await logActivity({
    tenantId: gate.tenantId,
    actorId: gate.userId,
    action: "approval_request_cancelled",
    entityType: "approval_request",
    entityId: id,
    oldValue: { status: "bekliyor" },
    newValue: { status: "iptal" },
  });

  revalidatePath(PATH);
  return { ok: true, id };
}

/** Talep altına not — herkes (talep eden ↔ yönetici diyaloğu). */
export async function addApprovalComment(
  _prev: ApprovalResult,
  fd: FormData,
): Promise<ApprovalResult> {
  const gate = await requirePermission("commissions", "view");
  if (!gate.ok) return { error: gate.error };

  const requestId = String(fd.get("request_id") ?? "").trim();
  const body = String(fd.get("body") ?? "").trim();
  if (!requestId) return { error: "Talep bulunamadı." };
  if (!body) return { error: "Not boş olamaz." };
  if (body.length > 2000) return { error: "Not en fazla 2000 karakter olabilir." };

  const supabase = await createClient();
  const { data: row } = await supabase
    .from("approval_requests")
    .select("id, title, requested_by")
    .eq("id", requestId)
    .eq("tenant_id", gate.tenantId)
    .maybeSingle();
  if (!row) return { error: "Talep bulunamadı." };

  const { error } = await supabase.from("approval_comments").insert({
    tenant_id: gate.tenantId,
    request_id: requestId,
    author_id: gate.userId,
    body,
  });
  if (error) return { error: "Not eklenemedi." };

  await logActivity({
    tenantId: gate.tenantId,
    actorId: gate.userId,
    action: "approval_comment_added",
    entityType: "approval_request",
    entityId: requestId,
    newValue: { body: body.slice(0, 200) },
  });

  // Not sahibine değil, KARŞI tarafa haber ver.
  if (row.requested_by && row.requested_by !== gate.userId) {
    await notifyTenant({
      tenantId: gate.tenantId,
      userId: row.requested_by,
      title: `💬 Onay talebinize not: ${row.title}`,
      body: body.slice(0, 140),
      href: "/app/onaylar?kim=benim",
      kind: "info",
    });
  }

  revalidatePath(PATH);
  return { ok: true, id: requestId };
}
