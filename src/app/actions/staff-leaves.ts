"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { requirePermission } from "@/lib/require-permission";
import { getEffectivePermissions, effectiveHasPermission } from "@/lib/permissions-effective";
import { logActivity } from "@/lib/activity";
import { notifyTenant } from "@/lib/notify";
import { asLeaveKind, leaveDaysCount, LEAVE_KIND_LABELS } from "@/lib/leave-utils";

export type LeaveResult = { ok?: boolean; error?: string };

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
/** Tek kayıtta makul üst sınır — yanlış yıl girişini ("2036") erken yakalar. */
const MAX_LEAVE_DAYS = 366;

/**
 * İzin kapısı: modül görüntüleme yetkisi + "başkası adına / onaylama" yetkisi.
 *
 * KURAL (spec): kendi izni için `team:view` yeter (kendi adına TALEP açar);
 * başkası adına kayıt açmak, onaylamak/reddetmek ve silmek `team:edit` ister.
 * `requirePermission` yalnız tek aksiyon bakar; ikinci seviyeyi burada
 * etkin izinlerden (tenant override'ları dahil) okuyoruz.
 */
async function leaveGate() {
  const gate = await requirePermission("team", "view");
  if (!gate.ok) return gate;
  const perms = await getEffectivePermissions(gate.tenantId, gate.role, gate.userId);
  return { ...gate, canManage: effectiveHasPermission(perms, "team", "edit") };
}

/** Türkçe tarih — bildirim metinleri için ("14 Ağustos 2026"). */
function trDate(dateKey: string): string {
  return new Intl.DateTimeFormat("tr-TR", {
    day: "numeric",
    month: "long",
    year: "numeric",
    timeZone: "UTC",
  }).format(new Date(`${dateKey}T12:00:00.000Z`));
}

function rangeLabel(startsOn: string, endsOn: string): string {
  return startsOn === endsOn ? trDate(startsOn) : `${trDate(startsOn)} – ${trDate(endsOn)}`;
}

/**
 * İzin kaydı oluşturur.
 *
 * Yönetici (`team:edit`) kimin adına isterse yazabilir ve kayıt DOĞRUDAN
 * 'onayli' başlar. Yetkisi olmayan kullanıcı yalnız KENDİ adına yazabilir ve
 * kaydı 'talep' olarak açılır — onayı yönetici verir. Bu ayrım form'dan gelen
 * `status` alanına GÜVENMEZ; durum tamamen sunucuda belirlenir.
 */
export async function createLeave(fd: FormData): Promise<LeaveResult> {
  const gate = await leaveGate();
  if (!gate.ok) return { error: gate.error };

  const rawStaff = String(fd.get("staff_id") ?? "").trim();
  const staffId = gate.canManage && UUID_RE.test(rawStaff) ? rawStaff : gate.userId;
  if (!gate.canManage && rawStaff && rawStaff !== gate.userId) {
    return { error: "Yalnızca kendi adınıza izin talebi oluşturabilirsiniz." };
  }

  const startsOn = String(fd.get("starts_on") ?? "").trim();
  const endsOn = String(fd.get("ends_on") ?? "").trim() || startsOn;
  if (!DATE_RE.test(startsOn) || !DATE_RE.test(endsOn)) {
    return { error: "Geçerli bir tarih aralığı seçin." };
  }
  if (endsOn < startsOn) return { error: "Bitiş tarihi başlangıçtan önce olamaz." };
  const days = leaveDaysCount(startsOn, endsOn);
  if (days < 1 || days > MAX_LEAVE_DAYS) {
    return { error: `İzin aralığı en fazla ${MAX_LEAVE_DAYS} gün olabilir. Tarihleri kontrol edin.` };
  }

  const kind = asLeaveKind(fd.get("kind"));
  const note = String(fd.get("note") ?? "").trim().slice(0, 500);
  const status = gate.canManage ? "onayli" : "talep";

  const supabase = await createClient();
  // staff_id'nin AYNI kiracıda olduğunu doğrula: RLS insert'i tenant_id ile
  // kapatıyor ama staff_id başka kiracının profili olabilirdi.
  if (staffId !== gate.userId) {
    const { data: target } = await supabase.from("profiles").select("id").eq("id", staffId).maybeSingle();
    if (!target) return { error: "Seçilen personel bulunamadı." };
  }

  const { data: created, error } = await supabase
    .from("staff_leaves")
    .insert({
      tenant_id: gate.tenantId,
      staff_id: staffId,
      starts_on: startsOn,
      ends_on: endsOn,
      kind,
      note: note || null,
      status,
      created_by: gate.userId,
    })
    .select("id")
    .single();

  if (error || !created) {
    console.error("createLeave", error);
    return { error: "İzin kaydedilemedi. Lütfen tekrar deneyin." };
  }

  await logActivity({
    tenantId: gate.tenantId,
    actorId: gate.userId,
    action: "staff_leave.create",
    entityType: "staff_leave",
    entityId: created.id as string,
    newValue: { staff_id: staffId, starts_on: startsOn, ends_on: endsOn, kind, status },
  });

  // Talep akışı: personelin kendisi açtıysa yöneticiye haber gitmesi gerekir.
  // Kiracı geneli bildirim (userId yok) — zil tarafı kişi bazlı süzer.
  if (status === "talep") {
    try {
      await notifyTenant({
        tenantId: gate.tenantId,
        title: `🗓️ İzin talebi: ${rangeLabel(startsOn, endsOn)}`,
        body: `${LEAVE_KIND_LABELS[kind]} talebi onay bekliyor (${days} gün).`,
        href: "/app/ekip/izinler",
        kind: "info",
      });
    } catch (e) {
      console.error("createLeave notify", e);
    }
  }

  revalidatePath("/app/ekip/izinler");
  revalidatePath("/app/ekip");
  return { ok: true };
}

/** Onay/ret ortak gövdesi — tek yerde yetki, bildirim ve denetim kaydı. */
async function setLeaveStatus(fd: FormData, next: "onayli" | "reddedildi"): Promise<LeaveResult> {
  const gate = await leaveGate();
  if (!gate.ok) return { error: gate.error };
  if (!gate.canManage) return { error: "İzin onayı için yetkiniz yok." };

  const id = String(fd.get("id") ?? "").trim();
  if (!UUID_RE.test(id)) return { error: "Geçersiz kayıt." };

  const supabase = await createClient();
  // Satırı önce oku: bildirim metni için kişi/tarih gerekiyor ve RLS zaten
  // kiracı dışını görünmez kılıyor (bulunamadı = başka kiracı).
  const { data: row } = await supabase
    .from("staff_leaves")
    .select("id, staff_id, starts_on, ends_on, kind, status")
    .eq("id", id)
    .maybeSingle();
  if (!row) return { error: "İzin kaydı bulunamadı." };

  const { error } = await supabase.from("staff_leaves").update({ status: next }).eq("id", id);
  if (error) {
    console.error("setLeaveStatus", error);
    return { error: "İşlem tamamlanamadı. Lütfen tekrar deneyin." };
  }

  await logActivity({
    tenantId: gate.tenantId,
    actorId: gate.userId,
    action: next === "onayli" ? "staff_leave.approve" : "staff_leave.reject",
    entityType: "staff_leave",
    entityId: id,
    oldValue: { status: row.status },
    newValue: { status: next },
  });

  // İlgili personele bildirim — kendi kaydını kendi onayladıysa gereksiz.
  if (String(row.staff_id) !== gate.userId) {
    const label = rangeLabel(String(row.starts_on), String(row.ends_on));
    try {
      await notifyTenant({
        tenantId: gate.tenantId,
        userId: String(row.staff_id),
        title: next === "onayli" ? `✅ İzniniz onaylandı: ${label}` : `❌ İzin talebiniz reddedildi: ${label}`,
        body:
          next === "onayli"
            ? `${LEAVE_KIND_LABELS[asLeaveKind(row.kind)]} kaydınız onaylandı. Bu tarihlerde online randevu linkiniz kapalı olacak.`
            : `${LEAVE_KIND_LABELS[asLeaveKind(row.kind)]} talebiniz reddedildi. Ayrıntı için yöneticinizle görüşün.`,
        href: "/app/ekip/izinler",
        kind: next === "onayli" ? "success" : "warning",
      });
    } catch (e) {
      console.error("setLeaveStatus notify", e);
    }
  }

  revalidatePath("/app/ekip/izinler");
  revalidatePath("/app/ekip");
  return { ok: true };
}

export async function approveLeave(fd: FormData): Promise<LeaveResult> {
  return setLeaveStatus(fd, "onayli");
}

export async function rejectLeave(fd: FormData): Promise<LeaveResult> {
  return setLeaveStatus(fd, "reddedildi");
}

/*
 * `<form action={...}>` ve ConfirmDialog `formAction` void bekler; sonuç
 * dönen action'ları doğrudan bağlamak tip hatası verir. Duyuru modülündeki
 * `deleteAnnouncementForm` deseniyle aynı: ince void sarmalayıcılar.
 * Hata durumunda sunucu log'u zaten action içinde yazılıyor.
 */
export async function approveLeaveForm(fd: FormData): Promise<void> {
  await approveLeave(fd);
}

export async function rejectLeaveForm(fd: FormData): Promise<void> {
  await rejectLeave(fd);
}

export async function deleteLeaveForm(fd: FormData): Promise<void> {
  await deleteLeave(fd);
}

/**
 * İzin kaydını siler.
 * Yönetici her kaydı silebilir; yetkisiz kullanıcı yalnız KENDİ ve henüz
 * onaylanmamış ('talep') kaydını geri çekebilir — onaylı izni tek taraflı
 * silip randevu bloklamasını kaldıramaz.
 */
export async function deleteLeave(fd: FormData): Promise<LeaveResult> {
  const gate = await leaveGate();
  if (!gate.ok) return { error: gate.error };

  const id = String(fd.get("id") ?? "").trim();
  if (!UUID_RE.test(id)) return { error: "Geçersiz kayıt." };

  const supabase = await createClient();
  const { data: row } = await supabase
    .from("staff_leaves")
    .select("id, staff_id, status, starts_on, ends_on")
    .eq("id", id)
    .maybeSingle();
  if (!row) return { error: "İzin kaydı bulunamadı." };

  if (!gate.canManage) {
    if (String(row.staff_id) !== gate.userId) return { error: "Bu kaydı silme yetkiniz yok." };
    if (String(row.status) !== "talep") return { error: "Onaylanmış izni yalnızca yöneticiniz kaldırabilir." };
  }

  const { error } = await supabase.from("staff_leaves").delete().eq("id", id);
  if (error) {
    console.error("deleteLeave", error);
    return { error: "İzin silinemedi. Lütfen tekrar deneyin." };
  }

  await logActivity({
    tenantId: gate.tenantId,
    actorId: gate.userId,
    action: "staff_leave.delete",
    entityType: "staff_leave",
    entityId: id,
    oldValue: { staff_id: row.staff_id, starts_on: row.starts_on, ends_on: row.ends_on, status: row.status },
  });

  revalidatePath("/app/ekip/izinler");
  revalidatePath("/app/ekip");
  return { ok: true };
}
