"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { requirePermission } from "@/lib/require-permission";
import { logActivity } from "@/lib/activity";
import { actionErrorMessage } from "@/lib/action-errors";
import { now, trDayKey } from "@/lib/clock";
import { isOnLeave, type LeaveLike } from "@/lib/leave-utils";
import { addDays, balancedFill, isDutySlot, weekDays, weekStartOf, type DutyShift } from "@/lib/duty/logic";

export type DutyResult = { ok?: boolean; error?: string; info?: string; added?: number };

const PATH = "/app/ekip/izinler";
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const DAY_RE = /^\d{4}-\d{2}-\d{2}$/;
/** Nöbete yazılabilecek roller (dengeli dağıtımda); elle atamada her aktif, salt okunur olmayan üye seçilebilir. */
const DUTY_ROLES = ["advisor", "team_lead", "branch_manager"];
const NOT_READY = "Nöbet çizelgesi bu ortamda henüz etkin değil (kurulum bekliyor).";

function tableMissing(error: { code?: string; message?: string } | null): boolean {
  return Boolean(error && (error.code === "42P01" || error.code === "PGRST205" || /duty_shifts/.test(error.message ?? "")));
}

/** Tarih aralığı: geçmiş 7 gün ile ileri 120 gün (yanlışlıkla yıllar sonrasına yazmayı önler). */
function dayInRange(day: string): boolean {
  if (!DAY_RE.test(day)) return false;
  const today = trDayKey(now());
  return day >= addDays(today, -7) && day <= addDays(today, 120);
}

/** Tek nöbet ekle (yönetici: team:edit; RLS aynı kuralı uygular, tetikleyici nöbetçinin bu ofisten olduğunu doğrular). */
export async function addDutyShift(_prev: DutyResult, fd: FormData): Promise<DutyResult> {
  const gate = await requirePermission("team", "edit");
  if (!gate.ok) return { error: gate.error };
  const profileId = String(fd.get("profile_id") ?? "").trim();
  const day = String(fd.get("duty_date") ?? "").trim();
  const slot = String(fd.get("slot") ?? "tam").trim();
  const note = String(fd.get("note") ?? "").trim().slice(0, 200) || null;
  if (!UUID_RE.test(profileId)) return { error: "Nöbetçi seçin." };
  if (!dayInRange(day)) return { error: "Tarih geçmiş 7 gün ile önümüzdeki 120 gün arasında olmalı." };
  if (!isDutySlot(slot)) return { error: "Geçersiz nöbet dilimi." };

  const supabase = await createClient();
  const { data, error } = await supabase
    .from("duty_shifts")
    .insert({ tenant_id: gate.tenantId, profile_id: profileId, duty_date: day, slot, note, created_by: gate.userId })
    .select("id")
    .single();
  if (error) {
    if (tableMissing(error)) return { error: NOT_READY };
    if (error.code === "23505") return { error: "Bu kişi o gün bu dilimde zaten nöbetçi." };
    return { error: actionErrorMessage(error, "Nöbet eklenemedi.") };
  }
  await logActivity({
    tenantId: gate.tenantId,
    actorId: gate.userId,
    action: "duty.add",
    entityType: "duty_shift",
    entityId: data.id,
    newValue: { profile_id: profileId, duty_date: day, slot },
  });
  revalidatePath(PATH);
  return { ok: true };
}

export async function removeDutyShift(_prev: DutyResult, fd: FormData): Promise<DutyResult> {
  const gate = await requirePermission("team", "edit");
  if (!gate.ok) return { error: gate.error };
  const id = String(fd.get("id") ?? "").trim();
  if (!UUID_RE.test(id)) return { error: "Nöbet bulunamadı." };
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("duty_shifts")
    .delete()
    .eq("id", id)
    .eq("tenant_id", gate.tenantId)
    .select("profile_id, duty_date, slot")
    .maybeSingle();
  if (error) return { error: tableMissing(error) ? NOT_READY : actionErrorMessage(error, "Nöbet kaldırılamadı.") };
  if (!data) return { error: "Nöbet bulunamadı." };
  await logActivity({ tenantId: gate.tenantId, actorId: gate.userId, action: "duty.remove", entityType: "duty_shift", entityId: id, oldValue: data });
  revalidatePath(PATH);
  return { ok: true };
}

async function weekContext(fd: FormData) {
  const today = trDayKey(now());
  const start = weekStartOf(String(fd.get("hafta") ?? ""), weekStartOf(today, today));
  return { start, days: weekDays(start) };
}

/**
 * Haftayı dengeli doldur: boş günlere (pazar hariç) tam gün nöbetçi; izinli danışman atlanır, nöbeti az olan öne geçer,
 * aynı kişi art arda iki gün verilmez. Dolu günler korunur.
 */
export async function fillDutyWeek(_prev: DutyResult, fd: FormData): Promise<DutyResult> {
  const gate = await requirePermission("team", "edit");
  if (!gate.ok) return { error: gate.error };
  const { start, days } = await weekContext(fd);
  const end = days[days.length - 1]!;
  const supabase = await createClient();
  const [members, existing, leaves] = await Promise.all([
    supabase.from("profiles").select("id, role").eq("tenant_id", gate.tenantId).eq("is_active", true).in("role", DUTY_ROLES).order("full_name").limit(200),
    supabase.from("duty_shifts").select("profile_id, duty_date, slot").eq("tenant_id", gate.tenantId).gte("duty_date", start).lte("duty_date", end).limit(500),
    supabase.from("staff_leaves").select("staff_id, starts_on, ends_on, status").lte("starts_on", end).gte("ends_on", start).limit(500),
  ]);
  if (existing.error) return { error: tableMissing(existing.error) ? NOT_READY : actionErrorMessage(existing.error, "Nöbetler okunamadı.") };
  const ids = ((members.data ?? []) as { id: string }[]).map((m) => m.id);
  if (ids.length === 0) return { error: "Nöbete yazılabilecek aktif danışman yok." };
  const leaveRows = (leaves.data ?? []) as LeaveLike[];
  const plan = balancedFill({
    days: days.filter((d) => dayInRange(d)),
    members: ids,
    existing: (existing.data ?? []) as DutyShift[],
    isOnLeave: (m, d) => isOnLeave(leaveRows, m, d),
  });
  if (plan.length === 0) return { ok: true, added: 0, info: "Bu haftada boş gün yok; mevcut nöbetler korundu." };
  const { error } = await supabase
    .from("duty_shifts")
    .insert(plan.map((p) => ({ ...p, tenant_id: gate.tenantId, created_by: gate.userId })));
  if (error) return { error: actionErrorMessage(error, "Nöbetler yazılamadı.") };
  await logActivity({ tenantId: gate.tenantId, actorId: gate.userId, action: "duty.fill_week", entityType: "duty_week", entityId: null, newValue: { week: start, added: plan.length } });
  revalidatePath(PATH);
  return { ok: true, added: plan.length, info: `${plan.length} güne nöbetçi atandı.` };
}

/** Geçen haftanın çizelgesini bu haftanın BOŞ günlerine kopyala (aynı gün adı, aynı dilim). */
export async function copyPreviousDutyWeek(_prev: DutyResult, fd: FormData): Promise<DutyResult> {
  const gate = await requirePermission("team", "edit");
  if (!gate.ok) return { error: gate.error };
  const { start, days } = await weekContext(fd);
  const prevStart = addDays(start, -7);
  const supabase = await createClient();
  const [prev, cur] = await Promise.all([
    supabase.from("duty_shifts").select("profile_id, duty_date, slot, note").eq("tenant_id", gate.tenantId).gte("duty_date", prevStart).lt("duty_date", start).limit(500),
    supabase.from("duty_shifts").select("duty_date").eq("tenant_id", gate.tenantId).gte("duty_date", start).lte("duty_date", days[6]!).limit(500),
  ]);
  if (prev.error) return { error: tableMissing(prev.error) ? NOT_READY : actionErrorMessage(prev.error, "Nöbetler okunamadı.") };
  const filled = new Set(((cur.data ?? []) as { duty_date: string }[]).map((r) => r.duty_date));
  const rows = ((prev.data ?? []) as { profile_id: string; duty_date: string; slot: string; note: string | null }[])
    .map((r) => ({ ...r, duty_date: addDays(r.duty_date, 7) }))
    .filter((r) => !filled.has(r.duty_date) && dayInRange(r.duty_date));
  if (rows.length === 0) return { ok: true, added: 0, info: "Kopyalanacak nöbet yok (geçen hafta boş ya da bu hafta dolu)." };
  // Pasifleşen üyenin satırı tetikleyicide reddedilir: tek tek yazılır, başarısız olan atlanır.
  let added = 0;
  for (const r of rows) {
    const { error } = await supabase.from("duty_shifts").insert({ ...r, tenant_id: gate.tenantId, created_by: gate.userId });
    if (!error) added += 1;
  }
  await logActivity({ tenantId: gate.tenantId, actorId: gate.userId, action: "duty.copy_week", entityType: "duty_week", entityId: null, newValue: { week: start, added } });
  revalidatePath(PATH);
  return { ok: true, added, info: added ? `${added} nöbet kopyalandı.` : "Nöbet kopyalanamadı (üyeler pasif olabilir)." };
}
