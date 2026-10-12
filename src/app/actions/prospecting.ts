"use server";

import { revalidatePath } from "next/cache";
import { afterSafe } from "@/lib/after-safe";
import { actionErrorMessage } from "@/lib/action-errors";
import { now, parseTrLocalDateTime } from "@/lib/clock";
import { logActivity } from "@/lib/activity";
import { requirePermission } from "@/lib/require-permission";
import { createClient } from "@/lib/supabase/server";
import { parsePhoneStrict } from "@/lib/phone-rules";
import { MANAGER_ROLES } from "@/lib/team/assignable-roles";
import { applyCallOutcome, checkStatusChange } from "@/lib/prospecting/state-machine";
import { fsboSaveSchema } from "@/lib/prospecting/schema";
import { saveFsboLead, type Db } from "@/lib/prospecting/store";
import { phoneHash } from "@/lib/prospecting/phone-hash";
import {
  FSBO_DNC_REASONS,
  isFsboLostReason,
  isFsboOutcome,
  isFsboStatus,
  type FsboDncReason,
  type FsboLostReason,
  type FsboStatus,
} from "@/lib/prospecting/types";

const PATH = "/app/portfoy-avi";

export type ProspectingResult = {
  ok?: boolean;
  error?: string;
  id?: string;
  /** Kullanıcıya gösterilecek uyarılar (çakışma, öneri). Engel değildir. */
  notices?: string[];
  href?: string;
};

type LeadRow = {
  id: string;
  assigned_to: string | null;
  status: string;
  contact_attempts: number | null;
  first_seen_at: string;
  phone: string | null;
  phone_hash: string | null;
  owner_name: string | null;
  title: string | null;
  customer_id: string | null;
  property_id: string | null;
};

const LEAD_SELECT = "id, assigned_to, status, contact_attempts, first_seen_at, phone, phone_hash, owner_name, title, customer_id, property_id";
const isManagerRole = (role: string) => (MANAGER_ROLES as readonly string[]).includes(role);
/** Danışman/çağrı merkezi yalnız kendi ve sahipsiz kayıtlarına dokunur; yönetici ve takım lideri tümüne. */
const canTouch = (role: string, userId: string, lead: Pick<LeadRow, "assigned_to">) =>
  isManagerRole(role) || role === "team_lead" || !lead.assigned_to || lead.assigned_to === userId;

async function loadLead(db: Db, tenantId: string, id: string): Promise<LeadRow | null> {
  if (!/^[0-9a-f-]{36}$/i.test(id)) return null;
  const { data } = await db.from("fsbo_leads").select(LEAD_SELECT).eq("tenant_id", tenantId).eq("id", id).is("deleted_at", null).maybeSingle();
  return (data as LeadRow | null) ?? null;
}

async function isDoNotCall(db: Db, tenantId: string, hash: string | null): Promise<boolean> {
  if (!hash) return false;
  const { data } = await db.from("fsbo_do_not_call").select("id").eq("tenant_id", tenantId).eq("phone_hash", hash).limit(1);
  return ((data as unknown[] | null) ?? []).length > 0;
}

function refresh(id?: string) {
  revalidatePath(PATH);
  if (id) revalidatePath(`${PATH}/${id}`);
}

/** Ortak: sahipsiz kayda dokunan danışman kaydı sahiplenir. */
const claimPatch = (lead: Pick<LeadRow, "assigned_to">, userId: string) => (lead.assigned_to ? {} : { assigned_to: userId });

/** Elle ekleme formu (bağlantı yapıştır + telefon). */
export async function createFsboLead(_prev: ProspectingResult, formData: FormData): Promise<ProspectingResult> {
  const gate = await requirePermission("prospecting", "create");
  if (!gate.ok) return { error: gate.error };

  const phoneRaw = String(formData.get("phone") ?? "").trim();
  if (phoneRaw) {
    const p = parsePhoneStrict(phoneRaw);
    if (!p.ok) return { error: p.error ?? "Telefon numarası geçersiz." };
  }
  const parsed = fsboSaveSchema.safeParse({
    source: "manual",
    url: String(formData.get("url") ?? ""),
    title: String(formData.get("title") ?? ""),
    transactionType: String(formData.get("transaction_type") ?? "sale") === "rent" ? "rent" : "sale",
    price: String(formData.get("price") ?? ""),
    rooms: String(formData.get("rooms") ?? ""),
    grossM2: String(formData.get("gross_m2") ?? ""),
    districtId: String(formData.get("district_id") ?? "") || null,
    provinceId: String(formData.get("province_id") ?? "") || null,
    locationText: String(formData.get("location_text") ?? ""),
    ownerName: String(formData.get("owner_name") ?? ""),
    phone: phoneRaw,
    assignedTo: String(formData.get("assigned_to") ?? "") || null,
  });
  if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? "Girdi geçersiz." };

  const db = (await createClient()) as Db;
  const res = await saveFsboLead({ db, tenantId: gate.tenantId, userId: gate.userId, role: gate.role }, parsed.data);
  if (!res.ok) return { error: res.error };
  refresh(res.id);
  const notices = res.notices.map((n) => n.message);
  if (res.ownership.kind === "other") return { ok: false, id: res.id, error: res.ownership.message };
  if (!res.created) notices.unshift("Bu ilan zaten kayıtlıydı; yeni fiyat gözlemi eklendi.");
  if (res.priceDropPct) notices.push(`Fiyat %${res.priceDropPct} düşmüş.`);
  if (res.relist) notices.push(res.relist.reason === "phone" ? "Aynı numaralı daha önceki bir kaydınızla bağlandı (tekrar ilan)." : "Daha önce kapanan benzer bir ilan var; tekrar ilan olabilir.");
  return { ok: true, id: res.id, notices };
}

/** Arama sonucu kaydı (sonuç, not, sonraki arama tarihi). */
export async function logFsboCall(input: { id: string; outcome: string; note?: string; nextDate?: string }): Promise<ProspectingResult> {
  const gate = await requirePermission("prospecting", "edit");
  if (!gate.ok) return { error: gate.error };
  if (!isFsboOutcome(input.outcome)) return { error: "Arama sonucu seçin." };
  const note = (input.note ?? "").trim().slice(0, 1000);

  const db = (await createClient()) as Db;
  const lead = await loadLead(db, gate.tenantId, input.id);
  if (!lead) return { error: "Kayıt bulunamadı." };
  if (!canTouch(gate.role, gate.userId, lead)) return { error: "Bu kayıt başka bir danışmanın." };
  if (!isFsboStatus(lead.status)) return { error: "Kayıt durumu tanınmadı." };

  const dnc = await isDoNotCall(db, gate.tenantId, lead.phone_hash);
  const nowMs = now();
  const userNextMs = input.nextDate ? (parseTrLocalDateTime(`${input.nextDate}T09:00`)?.getTime() ?? null) : null;
  if (input.outcome === "sonra_ara" && input.nextDate && userNextMs == null) return { error: "Sonraki arama tarihi geçersiz." };
  const result = applyCallOutcome(
    { status: lead.status, contactAttempts: Number(lead.contact_attempts ?? 0), firstSeenMs: Date.parse(lead.first_seen_at), doNotCall: dnc },
    input.outcome,
    { nowMs, userNextMs },
  );
  if (!result.ok) return { error: result.error };

  const nowIso = new Date(nowMs).toISOString();
  const patch: Record<string, unknown> = {
    ...claimPatch(lead, gate.userId),
    status: result.status,
    contact_attempts: result.contactAttempts,
    last_contact_at: nowIso,
    last_activity_at: nowIso,
    next_action_at: result.nextActionMs == null ? null : new Date(result.nextActionMs).toISOString(),
  };
  if (result.status !== lead.status) {
    patch.status_changed_at = nowIso;
    if (result.status === "kayip") patch.lost_reason = result.lostReason;
  }
  const upd = await db.from("fsbo_leads").update(patch).eq("tenant_id", gate.tenantId).eq("id", lead.id);
  if (upd.error) return { error: actionErrorMessage(upd.error, "Arama sonucu kaydedilemedi. Lütfen tekrar deneyin.") };

  await db.from("fsbo_lead_activities").insert({
    tenant_id: gate.tenantId,
    lead_id: lead.id,
    actor_id: gate.userId,
    kind: "call",
    outcome: input.outcome,
    note: note || null,
  });
  if (result.doNotCall) await addDoNotCall(db, gate, lead, "ilan_sahibi_istedi");
  refresh(lead.id);
  const notices: string[] = [];
  if (result.suggestLost) notices.push("6 denemedir ulaşılamıyor; kaydı \"Kayıp: ulaşılamadı\" olarak kapatmayı düşünün.");
  return { ok: true, id: lead.id, notices };
}

async function addDoNotCall(db: Db, gate: { tenantId: string; userId: string }, lead: LeadRow, reason: FsboDncReason): Promise<void> {
  const hash = lead.phone_hash ?? (lead.phone ? phoneHash(gate.tenantId, lead.phone) : null);
  if (!hash) return;
  await db
    .from("fsbo_do_not_call")
    .upsert({ tenant_id: gate.tenantId, phone_hash: hash, reason, created_by: gate.userId }, { onConflict: "tenant_id,phone_hash", ignoreDuplicates: true });
  afterSafe(
    () => logActivity({ tenantId: gate.tenantId, actorId: gate.userId, action: "fsbo.do_not_call_add", entityType: "fsbo_lead", entityId: lead.id, newValue: { reason } }),
    "aranmasın denetim kaydı",
  );
}

/** Tek dokunuşla "Aranmasın": numara ofis genelinde kilitlenir, kayıt kapanır. */
export async function markFsboDoNotCall(input: { id: string; reason?: string }): Promise<ProspectingResult> {
  const gate = await requirePermission("prospecting", "edit");
  if (!gate.ok) return { error: gate.error };
  const reason = (FSBO_DNC_REASONS as readonly string[]).includes(input.reason ?? "") ? (input.reason as FsboDncReason) : "ilan_sahibi_istedi";
  const db = (await createClient()) as Db;
  const lead = await loadLead(db, gate.tenantId, input.id);
  if (!lead) return { error: "Kayıt bulunamadı." };
  if (!canTouch(gate.role, gate.userId, lead)) return { error: "Bu kayıt başka bir danışmanın." };
  if (lead.status === "portfoye_donustu") return { error: "Portföye dönüşen kayıt aranmasın olarak işaretlenemez; müşteri kaydından yönetin." };
  if (!lead.phone_hash && !lead.phone) return { error: "Bu kayıtta telefon yok; aranmasın listesine eklenecek numara bulunamadı." };

  const nowIso = new Date(now()).toISOString();
  const upd = await db
    .from("fsbo_leads")
    .update({ ...claimPatch(lead, gate.userId), status: "kayip", lost_reason: reason === "aslinda_emlakci" ? "aslinda_emlakci" : "emlakci_istemiyor", status_changed_at: nowIso, last_activity_at: nowIso, next_action_at: null })
    .eq("tenant_id", gate.tenantId)
    .eq("id", lead.id);
  if (upd.error) return { error: actionErrorMessage(upd.error, "İşlem kaydedilemedi. Lütfen tekrar deneyin.") };
  await addDoNotCall(db, gate, lead, reason);
  await db.from("fsbo_lead_activities").insert({ tenant_id: gate.tenantId, lead_id: lead.id, actor_id: gate.userId, kind: "call", outcome: "aranmasin", note: null });
  refresh(lead.id);
  return { ok: true, id: lead.id };
}

/** Aranmasın kaydını kaldırır — YALNIZ yönetici (denetim kaydı düşer). */
export async function removeFsboDoNotCall(input: { id: string }): Promise<ProspectingResult> {
  const gate = await requirePermission("prospecting", "delete");
  if (!gate.ok) return { error: gate.error };
  if (!isManagerRole(gate.role)) return { error: "Aranmasın kaydını yalnız yönetici kaldırabilir." };
  const db = (await createClient()) as Db;
  const lead = await loadLead(db, gate.tenantId, input.id);
  if (!lead?.phone_hash) return { error: "Kayıtta telefon özeti yok; kaldırılacak aranmasın kaydı bulunamadı." };
  const del = await db.from("fsbo_do_not_call").delete().eq("tenant_id", gate.tenantId).eq("phone_hash", lead.phone_hash);
  if (del.error) return { error: actionErrorMessage(del.error, "Aranmasın kaydı kaldırılamadı.") };
  afterSafe(() => logActivity({ tenantId: gate.tenantId, actorId: gate.userId, action: "fsbo.do_not_call_remove", entityType: "fsbo_lead", entityId: lead.id }), "aranmasın kaldırma denetimi");
  refresh(lead.id);
  return { ok: true, id: lead.id };
}

/** Zaman çizelgesine not. */
export async function addFsboNote(input: { id: string; note: string }): Promise<ProspectingResult> {
  const gate = await requirePermission("prospecting", "edit");
  if (!gate.ok) return { error: gate.error };
  const note = (input.note ?? "").trim().slice(0, 1000);
  if (!note) return { error: "Not boş olamaz." };
  const db = (await createClient()) as Db;
  const lead = await loadLead(db, gate.tenantId, input.id);
  if (!lead) return { error: "Kayıt bulunamadı." };
  if (!canTouch(gate.role, gate.userId, lead)) return { error: "Bu kayıt başka bir danışmanın." };
  const ins = await db.from("fsbo_lead_activities").insert({ tenant_id: gate.tenantId, lead_id: lead.id, actor_id: gate.userId, kind: "note", note });
  if (ins.error) return { error: actionErrorMessage(ins.error, "Not kaydedilemedi.") };
  await db.from("fsbo_leads").update({ last_activity_at: new Date(now()).toISOString() }).eq("tenant_id", gate.tenantId).eq("id", lead.id);
  refresh(lead.id);
  return { ok: true, id: lead.id };
}

/** Müşteri oluşmadan "Pazartesi tekrar ara" görevi (tasks.fsbo_lead_id). */
export async function createFsboTask(input: { id: string; title?: string; dueDate: string }): Promise<ProspectingResult> {
  const gate = await requirePermission("prospecting", "edit");
  if (!gate.ok) return { error: gate.error };
  const taskGate = await requirePermission("tasks", "create");
  if (!taskGate.ok) return { error: taskGate.error };
  const due = parseTrLocalDateTime(`${input.dueDate}T09:00`);
  if (!due) return { error: "Görev tarihi geçersiz." };
  const db = (await createClient()) as Db;
  const lead = await loadLead(db, gate.tenantId, input.id);
  if (!lead) return { error: "Kayıt bulunamadı." };
  if (!canTouch(gate.role, gate.userId, lead)) return { error: "Bu kayıt başka bir danışmanın." };
  if (lead.status === "portfoye_donustu") return { error: "Portföye dönüşen kayıt için görev açılamaz." };
  if (await isDoNotCall(db, gate.tenantId, lead.phone_hash)) return { error: "Bu numara aranmasın listesinde; görev açılamaz." };
  const suffix = lead.title ? `: ${lead.title}` : "";
  const title = (input.title ?? "").trim().slice(0, 200) || `Sahibinden ilan sahibini tekrar ara${suffix}`.slice(0, 200);
  const ins = await db.from("tasks").insert({
    tenant_id: gate.tenantId,
    title,
    kind: "call",
    priority: "normal",
    status: "open",
    due_at: due.toISOString(),
    assigned_to: lead.assigned_to ?? gate.userId,
    created_by: gate.userId,
    fsbo_lead_id: lead.id,
  });
  if (ins.error) return { error: actionErrorMessage(ins.error, "Görev oluşturulamadı.") };
  await db.from("fsbo_lead_activities").insert({ tenant_id: gate.tenantId, lead_id: lead.id, actor_id: gate.userId, kind: "note", note: `Görev: ${title}`.slice(0, 1000) });
  revalidatePath("/app/gorevler");
  refresh(lead.id);
  return { ok: true, id: lead.id };
}

/**
 * Randevu: randevu müşteri ister → önce "Satıcı" müşterisi (kaynak: Sahibinden ilan) oluşturulur / mevcut müşteri bağlanır,
 * ardından randevu formu müşteri dolu açılır (`href`).
 */
export async function startFsboAppointment(input: { id: string }): Promise<ProspectingResult> {
  const gate = await requirePermission("prospecting", "edit");
  if (!gate.ok) return { error: gate.error };
  const db = (await createClient()) as Db;
  const lead = await loadLead(db, gate.tenantId, input.id);
  if (!lead) return { error: "Kayıt bulunamadı." };
  if (!canTouch(gate.role, gate.userId, lead)) return { error: "Bu kayıt başka bir danışmanın." };
  if (lead.status === "portfoye_donustu") return { error: "Portföye dönüşen kayıt için randevu açılamaz." };
  if (await isDoNotCall(db, gate.tenantId, lead.phone_hash)) return { error: "Bu numara aranmasın listesinde; randevu açılamaz." };

  let customerId = lead.customer_id;
  if (!customerId) {
    const custGate = await requirePermission("customers", "create");
    if (!custGate.ok) return { error: custGate.error };
    if (!lead.phone) return { error: "Randevu için telefon gerekli; kayıtta telefon yok." };
    const { data: existing } = await db.from("customers").select("id").eq("tenant_id", gate.tenantId).eq("phone", lead.phone).limit(1);
    customerId = ((existing as { id: string }[] | null) ?? [])[0]?.id ?? null;
    if (!customerId) {
      const ins = await db
        .from("customers")
        .insert({
          tenant_id: gate.tenantId,
          full_name: (lead.owner_name ?? "").trim() || "Sahibinden ilan sahibi",
          phone: lead.phone,
          customer_types: ["Satıcı"],
          notes: "Kaynak: Sahibinden ilan",
          assigned_to: gate.userId,
          created_by: gate.userId,
        })
        .select("id")
        .single();
      if (ins.error || !ins.data) return { error: actionErrorMessage(ins.error, "Müşteri kaydı oluşturulamadı.") };
      customerId = String((ins.data as { id: string }).id);
      revalidatePath("/app/musteriler");
    }
    await db.from("fsbo_leads").update({ customer_id: customerId, last_activity_at: new Date(now()).toISOString(), ...claimPatch(lead, gate.userId) }).eq("tenant_id", gate.tenantId).eq("id", lead.id);
  }
  refresh(lead.id);
  return { ok: true, id: lead.id, href: `/app/randevular/yeni?customer=${customerId}` };
}

/** Elle durum değişikliği (randevu / yetki alındı / kayıp / yeniden dene). Dönüşüm portföy oluşturma akışından gelir. */
export async function changeFsboStatus(input: { id: string; to: string; lostReason?: string; authorizationDate?: string; authorizationMonths?: number }): Promise<ProspectingResult> {
  const gate = await requirePermission("prospecting", "edit");
  if (!gate.ok) return { error: gate.error };
  if (!isFsboStatus(input.to) || input.to === "portfoye_donustu") return { error: "Bu durum buradan seçilemez." };
  const to: FsboStatus = input.to;
  const lostReason: FsboLostReason | null = isFsboLostReason(input.lostReason) ? input.lostReason : null;
  const db = (await createClient()) as Db;
  const lead = await loadLead(db, gate.tenantId, input.id);
  if (!lead) return { error: "Kayıt bulunamadı." };
  if (!canTouch(gate.role, gate.userId, lead)) return { error: "Bu kayıt başka bir danışmanın." };
  if (!isFsboStatus(lead.status)) return { error: "Kayıt durumu tanınmadı." };
  const check = checkStatusChange({ from: lead.status, to, lostReason });
  if (!check.ok) return { error: check.error };

  const notices: string[] = [];
  let note: string | null = null;
  if (to === "yetki_alindi") {
    const date = /^\d{4}-\d{2}-\d{2}$/.test(input.authorizationDate ?? "") ? input.authorizationDate! : "";
    if (!date) return { error: "Yetki alındı için yetkilendirme sözleşmesi tarihini girin." };
    const months = Number.isFinite(input.authorizationMonths) ? Math.max(1, Math.min(36, Math.round(input.authorizationMonths as number))) : 3;
    note = `Yetkilendirme sözleşmesi: ${date.split("-").reverse().join(".")}, ${months} ay.`;
    if (months > 3) notices.push("Yetkilendirme sözleşmesi süresi en çok 3 ay olmalıdır (uyarı; kayıt engellenmedi).");
    notices.push("İlanı yayınlamadan önce malikin EİDS'te ofisi yetkilendirdiğinden emin olun.");
  }
  if (to === "kayip") note = `Kayıp nedeni: ${lostReason}`;

  const nowIso = new Date(now()).toISOString();
  const patch: Record<string, unknown> = {
    ...claimPatch(lead, gate.userId),
    status: to,
    status_changed_at: nowIso,
    last_activity_at: nowIso,
    lost_reason: to === "kayip" ? lostReason : null,
  };
  if (to === "yeni") patch.next_action_at = nowIso;
  if (to === "kayip" || to === "yetki_alindi") patch.next_action_at = null;
  const upd = await db.from("fsbo_leads").update(patch).eq("tenant_id", gate.tenantId).eq("id", lead.id);
  if (upd.error) return { error: actionErrorMessage(upd.error, "Durum değiştirilemedi. Lütfen tekrar deneyin.") };
  await db.from("fsbo_lead_activities").insert({ tenant_id: gate.tenantId, lead_id: lead.id, actor_id: gate.userId, kind: "status", note });
  // "Aslında emlakçı": o numara ofis genelinde işaretlenir.
  if (to === "kayip" && lostReason === "aslinda_emlakci") await addDoNotCall(db, gate, lead, "aslinda_emlakci");
  refresh(lead.id);
  return { ok: true, id: lead.id, notices };
}

/** Kaydı başka danışmana atar — yalnız yönetici. */
export async function assignFsboLead(input: { id: string; assignedTo: string }): Promise<ProspectingResult> {
  const gate = await requirePermission("prospecting", "edit");
  if (!gate.ok) return { error: gate.error };
  if (!isManagerRole(gate.role) && gate.role !== "team_lead") return { error: "Kaydı yalnız yönetici atayabilir." };
  const db = (await createClient()) as Db;
  const lead = await loadLead(db, gate.tenantId, input.id);
  if (!lead) return { error: "Kayıt bulunamadı." };
  const { data: target } = await db.from("profiles").select("id").eq("id", input.assignedTo).eq("tenant_id", gate.tenantId).eq("is_active", true).maybeSingle();
  if (!target) return { error: "Seçilen danışman bu ofiste bulunamadı." };
  const nowIso = new Date(now()).toISOString();
  const upd = await db.from("fsbo_leads").update({ assigned_to: input.assignedTo, last_activity_at: nowIso }).eq("tenant_id", gate.tenantId).eq("id", lead.id);
  if (upd.error) return { error: actionErrorMessage(upd.error, "Atama yapılamadı.") };
  await db.from("fsbo_lead_activities").insert({ tenant_id: gate.tenantId, lead_id: lead.id, actor_id: gate.userId, kind: "status", note: "Danışman değiştirildi." });
  refresh(lead.id);
  return { ok: true, id: lead.id };
}

/** Tekrar ilan önerisini onaylar (benzerlik önerisi kullanıcı onayı ister). */
export async function confirmFsboRelist(input: { id: string; relistOf: string }): Promise<ProspectingResult> {
  const gate = await requirePermission("prospecting", "edit");
  if (!gate.ok) return { error: gate.error };
  const db = (await createClient()) as Db;
  const [lead, prev] = await Promise.all([loadLead(db, gate.tenantId, input.id), loadLead(db, gate.tenantId, input.relistOf)]);
  if (!lead || !prev || lead.id === prev.id) return { error: "Kayıt bulunamadı." };
  if (!canTouch(gate.role, gate.userId, lead)) return { error: "Bu kayıt başka bir danışmanın." };
  const upd = await db.from("fsbo_leads").update({ relist_of: prev.id }).eq("tenant_id", gate.tenantId).eq("id", lead.id);
  if (upd.error) return { error: actionErrorMessage(upd.error, "Bağlantı kurulamadı.") };
  refresh(lead.id);
  return { ok: true, id: lead.id };
}

/** Kaydı listeden kaldırır (silme yetkisi gerekir; geri alınabilir: deleted_at). */
export async function archiveFsboLead(input: { id: string }): Promise<ProspectingResult> {
  const gate = await requirePermission("prospecting", "delete");
  if (!gate.ok) return { error: gate.error };
  const db = (await createClient()) as Db;
  const lead = await loadLead(db, gate.tenantId, input.id);
  if (!lead) return { error: "Kayıt bulunamadı." };
  if (!canTouch(gate.role, gate.userId, lead)) return { error: "Bu kayıt başka bir danışmanın." };
  const upd = await db.from("fsbo_leads").update({ deleted_at: new Date(now()).toISOString() }).eq("tenant_id", gate.tenantId).eq("id", lead.id);
  if (upd.error) return { error: actionErrorMessage(upd.error, "Kayıt kaldırılamadı.") };
  refresh();
  return { ok: true };
}
