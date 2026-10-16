"use server";

import { revalidatePath } from "next/cache";
import { afterSafe } from "@/lib/after-safe";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { requirePermission } from "@/lib/require-permission";
import { logActivity } from "@/lib/activity";
import { notifyTenant } from "@/lib/notify";
import { autoApprovalReason, canDecide, canDecideApproval, isApprovalKind, isDelegationActive, kindMeta, APPROVAL_DECIDER_ROLES } from "@/lib/approvals";
import { loadApprovalPolicy } from "@/lib/approval-policy";
import { now, trDayKey } from "@/lib/clock";
import { getEffectivePermissions, mergeEffectivePermissions, type RoleOverrideRow, type UserOverrideRow } from "@/lib/permissions-effective";
import { actionErrorMessage } from "@/lib/action-errors";
import { proposalMessage } from "@/lib/price-proposals/model";

export type ApprovalResult = { ok?: boolean; error?: string; id?: string; info?: string };

const PATH = "/app/onaylar";

const NOT_DECIDER = "Onay/ret kararı yalnız karar yetkisi (komisyon düzenleme) olan yöneticiler tarafından verilebilir.";

/**
 * Yeni talep bildiriminin alıcıları: karar düğmesini gören ve karar verebilen yöneticiler — `canDecideApproval` ile
 * AYNI kural (kademe + etkin commissions:edit; ofis rol istisnası ve kişi istisnası dahil). Tek turda üç okuma.
 */
async function approvalDeciderIds(supabase: Awaited<ReturnType<typeof createClient>>, tenantId: string): Promise<string[]> {
  const [{ data: managers }, { data: roleRows }, { data: userRows }] = await Promise.all([
    supabase.from("profiles").select("id, role").eq("tenant_id", tenantId).eq("is_active", true).in("role", [...APPROVAL_DECIDER_ROLES]),
    supabase.from("tenant_role_permissions").select("role, module, action, allowed").eq("tenant_id", tenantId).eq("module", "commissions"),
    supabase.from("user_permission_overrides").select("user_id, module, actions, expires_at").eq("tenant_id", tenantId).eq("module", "commissions"),
  ]);
  const delegate = await activeDelegateId(supabase, tenantId);
  const roleOverrides = (roleRows ?? []) as (RoleOverrideRow & { role: string })[];
  const userOverrides = (userRows ?? []) as (UserOverrideRow & { user_id: string })[];
  return ((managers ?? []) as { id: string; role: string }[])
    .filter((m) => {
      const perms = mergeEffectivePermissions(
        m.role,
        roleOverrides.filter((r) => r.role === m.role),
        m.role === "owner" ? [] : userOverrides.filter((u) => u.user_id === m.id),
      );
      return canDecideApproval(m.role, perms);
    })
    .map((m) => m.id)
    .concat(delegate ? [delegate] : [])
    .filter((id, i, all) => all.indexOf(id) === i);
}

/**
 * Ofisin suresi dolmamis vekil onaylayicisi (OA12; approval_delegations). Tablo yoksa ya da vekalet bitmisse null.
 * SQL tarafindaki `approval_actor_is_delegate()` ile ayni kural (TR gunu dahil).
 */
async function activeDelegateId(supabase: Awaited<ReturnType<typeof createClient>>, tenantId: string): Promise<string | null> {
  const { data, error } = await supabase.from("approval_delegations").select("delegate_id, until_on").eq("tenant_id", tenantId).maybeSingle();
  if (error || !data) return null;
  const row = data as { delegate_id: string; until_on: string };
  return isDelegationActive(row, trDayKey(now())) ? row.delegate_id : null;
}

/** Karar yetkisi: yonetim kademesi + commissions:edit (canDecideApproval) YA DA suresi dolmamis vekil. */
async function deciderGate(gate: { tenantId: string; role: string; userId: string }): Promise<{ allowed: boolean; delegate: boolean }> {
  if (canDecideApproval(gate.role, await getEffectivePermissions(gate.tenantId, gate.role, gate.userId))) return { allowed: true, delegate: false };
  const supabase = await createClient();
  const delegate = (await activeDelegateId(supabase, gate.tenantId)) === gate.userId;
  return { allowed: delegate, delegate };
}

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
  // `write`: modül kapısı view, ama kayıt yazar → salt okunur tavanı (SK10 / B168).
  const gate = await requirePermission("commissions", "view", { write: true });
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

  if (error || !data) return { error: actionErrorMessage(error, "Talep kaydedilemedi.") };

  await logActivity({
    tenantId: gate.tenantId,
    actorId: gate.userId,
    action: "approval_request_created",
    entityType: "approval_request",
    entityId: data.id,
    newValue: { kind, title, current_value: currentValue, requested_value: requestedValue },
  });

  // OA12 otomatik onay: ofis politikası eşiğinin altındaki talep yönetici beklemeden onaylanır (varsayılan KAPALI).
  // Talep sahibi kendi talebini onaylayamadığı için karar satırı sunucuda service_role ile yazılır (koşullu: hâlâ
  // bekliyor + aynı ofis); karar veren boş, gerekçe politika metni, denetim kaydı zorunlu.
  const policy = await loadApprovalPolicy(supabase, gate.tenantId);
  const autoReason = autoApprovalReason({ kind, current: currentValue, requested: requestedValue, amount, description }, policy);
  if (autoReason) {
    const decidedAt = new Date(now()).toISOString();
    const { data: auto, error: autoError } = await createAdminClient()
      .from("approval_requests")
      .update({ status: "onaylandi", decided_by: null, decided_at: decidedAt, decision_note: autoReason, updated_at: decidedAt })
      .eq("id", data.id)
      .eq("tenant_id", gate.tenantId)
      .eq("status", "bekliyor")
      .select("id")
      .maybeSingle();
    if (!autoError && auto) {
      await logActivity({
        tenantId: gate.tenantId,
        actorId: gate.userId,
        action: "approval_request_auto_approved",
        entityType: "approval_request",
        entityId: data.id,
        oldValue: { status: "bekliyor" },
        newValue: { status: "onaylandi", decision_note: autoReason, policy: true },
      });
      revalidatePath(PATH);
      return { ok: true, id: data.id, info: autoReason };
    }
    // Otomatik onay yazılamadıysa talep normal akışta bekler (yöneticilere bildirim gider).
  }

  // Karar verebilen yöneticilere bildirim (canDecideApproval ile aynı kural). Tercih anahtarı GEÇİLMİYOR: bu bir
  // pazarlama/özet bildirimi değil, iş akışını bloklayan bir karar isteği — susturulmamalı. Yanıttan SONRA gider.
  const tenantId = gate.tenantId;
  const actorId = gate.userId;
  afterSafe(async () => {
    const recipients = (await approvalDeciderIds(supabase, tenantId)).filter((id) => id !== actorId);
    await Promise.all(
      recipients.map((userId) =>
        notifyTenant({
          tenantId,
          userId,
          title: `Onay bekliyor: ${title}`,
          body: `${kindMeta(kind).label} · karar bekleniyor`,
          href: "/app/onaylar?durum=bekliyor",
          kind: "warning",
        }),
      ),
    );
  }, "approval.notify_deciders");

  revalidatePath(PATH);
  return { ok: true, id: data.id };
}

/**
 * Onay / ret kararı.
 *
 * ÜÇ KAPI birden:
 *  1. `commissions:edit` — modül yetkisi (tenant override'ları dahil)
 *  2. `canDecideApproval(gate.role, perms)` — kademe + etkin commissions:edit (tek yüklem). accounting rolü commissions'ta
 *     tam CRUD'a sahip ama indirim politikasına karar veremez.
 *  3. `requested_by !== userId` — KENDİ TALEBİNİ ONAYLAYAMAZ. Bu kural olmadan
 *     modülün tamamı anlamsız: yönetici kendi indirimini kendi onaylarsa kayıt
 *     "iz" değil, sadece formalite olur.
 */
export async function decideApproval(
  _prev: ApprovalResult,
  fd: FormData,
): Promise<ApprovalResult> {
  // Modül kapısı view + yazma: vekil onaylayıcı (OA12) commissions:edit taşımayabilir; karar yetkisi aşağıdaki TEK
  // yüklemle (kademe + commissions:edit YA DA süresi dolmamış vekil) verilir, RLS approval_actor_can_decide aynı kuralı uygular.
  const gate = await requirePermission("commissions", "view", { write: true });
  if (!gate.ok) return { error: gate.error };
  const decider = await deciderGate(gate);
  if (!decider.allowed) return { error: NOT_DECIDER };

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
    .select("id, title, kind, status, requested_by, description")
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
    delegate: decider.delegate,
  });
  if (!verdict.ok) return { error: verdict.error };

  const { data: decided, error } = await supabase
    .from("approval_requests")
    .update({
      status: decision,
      decided_by: gate.userId,
      decided_at: new Date(now()).toISOString(),
      decision_note: note || null,
      updated_at: new Date(now()).toISOString(),
    })
    .eq("id", id)
    .eq("tenant_id", gate.tenantId)
    .eq("status", "bekliyor") // yarış koşulu: iki yönetici aynı anda karar veremez
    .select("id")
    .maybeSingle();

  if (error) return { error: actionErrorMessage(error, "Karar kaydedilemedi.") };
  // Sıfır satır = başka yönetici ya da talep sahibi (iptal) bu sırada sonuçlandırdı: kayıt, bildirim ve fiyat
  // uygulaması YAPILMAZ (eskiden "Onaylandı" denip talep sahibine yanlış bildirim gidiyordu).
  if (!decided) return { error: "Bu talep bu sırada sonuçlandı; sayfayı yenileyin." };

  await logActivity({
    tenantId: gate.tenantId,
    actorId: gate.userId,
    action: decision === "onaylandi" ? "approval_request_approved" : "approval_request_rejected",
    entityType: "approval_request",
    entityId: id,
    oldValue: { status: row.status },
    newValue: { status: decision, decision_note: note || null, ...(decider.delegate ? { delegate: true } : {}) },
  });

  if (row.requested_by) {
    // Talep sahibine bildirim yanıttan SONRA gider (karar ekranı beklemez).
    const notice: Parameters<typeof notifyTenant>[0] = {
      tenantId: gate.tenantId,
      userId: row.requested_by as string,
      title: decision === "onaylandi" ? `✅ Onaylandı: ${row.title}` : `❌ Reddedildi: ${note}`,
      body: decision === "onaylandi" ? (note || `${kindMeta(row.kind).label} talebiniz onaylandı.`) : row.title,
      href: `/app/onaylar?durum=${decision}&kim=benim`,
      kind: decision === "onaylandi" ? "success" : "danger",
    };
    afterSafe(() => notifyTenant(notice), "approval.notify_requester");
  }

  // Fiyat önerisi bağlantısı: mülk sahibi onayladı, ofis kuralı yönetici onayı istedi (GUVENLIK-1, 20261012001200).
  // Karar ZATEN yazıldı: fiyat uygulanamazsa onayı geri almayız, nedenini bilgi olarak döndürürüz.
  const info = await settlePriceProposal(supabase, {
    tenantId: gate.tenantId,
    actorId: gate.userId,
    description: row.description as string | null,
    decision,
  });

  revalidatePath(PATH);
  return info ? { ok: true, id, info } : { ok: true, id };
}

const PRICE_DROP_FINGERPRINT = /^\[oversight:price_drop:([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})\]/i;

/**
 * `[oversight:price_drop:<ilan>]` talebine verilen kararı, o ilan için 'yönetici onayı bekleyen' fiyat önerisine yansıtır:
 * onay -> `apply_price_proposal_after_approval` (onayı tüketir, fiyatı ve fiyat izini tek işlemde yazar);
 * ret -> `reject_price_proposal_after_denial`. Öneri yoksa (normal fiyat düşürme talebi) hiçbir şey yapmaz.
 */
async function settlePriceProposal(
  supabase: Awaited<ReturnType<typeof createClient>>,
  ctx: { tenantId: string; actorId: string; description: string | null; decision: "onaylandi" | "reddedildi" },
): Promise<string | undefined> {
  const match = PRICE_DROP_FINGERPRINT.exec(ctx.description ?? "");
  if (!match) return undefined;
  const propertyId = match[1]!;

  const { data: proposal } = await supabase
    .from("property_price_proposals")
    .select("id")
    .eq("tenant_id", ctx.tenantId)
    .eq("property_id", propertyId)
    .eq("status", "awaiting_manager")
    .maybeSingle();
  if (!proposal) return undefined;

  if (ctx.decision === "reddedildi") {
    const { error } = await supabase.rpc("reject_price_proposal_after_denial", { p_proposal_id: proposal.id });
    if (error) console.error("reject_price_proposal_after_denial", { code: error.code });
    revalidatePath(`/app/portfoyler/${propertyId}`);
    return undefined;
  }

  // Karar satırı onay sekmesinden düştüğü için hata yalnız dönüş değerine bırakılmaz: karar vericiye bildirim de düşer.
  const fail = async (message: string): Promise<string> => {
    await notifyTenant({
      tenantId: ctx.tenantId,
      userId: ctx.actorId,
      title: "Fiyat güncellenemedi; portföy sayfasından yeniden deneyin",
      body: message,
      href: `/app/portfoyler/${propertyId}`,
      kind: "warning",
    }).catch(() => undefined);
    return message;
  };

  const { data, error } = await supabase.rpc("apply_price_proposal_after_approval", { p_proposal_id: proposal.id });
  if (error) {
    console.error("apply_price_proposal_after_approval", { code: error.code });
    return fail(`Onay verildi; ${actionErrorMessage(error, "fiyat güncellenemedi")}`);
  }
  const code = (data as { code?: string } | null)?.code ?? "error";
  if (code !== "ok") return fail(`Onay verildi; fiyat güncellenemedi: ${proposalMessage(code).text}`);

  await logActivity({
    tenantId: ctx.tenantId,
    actorId: ctx.actorId,
    action: "property.price_proposal_applied",
    entityType: "property",
    entityId: propertyId,
    newValue: { proposal_id: proposal.id },
  });
  revalidatePath(`/app/portfoyler/${propertyId}`);
  return "Fiyat güncellendi (mülk sahibi + yönetici onaylı).";
}

export type BulkApprovalResult = { error?: string; decided?: number; skipped?: number; firstError?: string; infos?: string[] };

/**
 * Toplu onay/ret: her talep TEK TEK `decideApproval` yolundan geçer (kademe, "kendi talebini
 * onaylayamaz", yarış koşulu, bildirim ve denetim kaydı aynen). Ret için gerekçe zorunlu ve
 * seçilen tüm taleplere aynı gerekçe yazılır. En fazla 50 talep.
 */
export async function decideApprovalsBulk(ids: string[], decision: string, note: string): Promise<BulkApprovalResult> {
  const gate = await requirePermission("commissions", "view", { write: true });
  if (!gate.ok) return { error: gate.error };
  if (!(await deciderGate(gate)).allowed) return { error: NOT_DECIDER };
  if (decision !== "onaylandi" && decision !== "reddedildi") return { error: "Geçersiz karar." };
  const cleanNote = String(note ?? "").trim().slice(0, 2000);
  if (decision === "reddedildi" && !cleanNote) return { error: "Ret için gerekçe zorunludur." };
  const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
  const list = Array.isArray(ids) ? [...new Set(ids.map((v) => String(v)).filter((v) => uuid.test(v)))].slice(0, 50) : [];
  if (list.length === 0) return { error: "Talep seçin." };

  let decided = 0;
  let skipped = 0;
  let firstError: string | undefined;
  const infos: string[] = [];
  for (const id of list) {
    const fd = new FormData();
    fd.set("id", id);
    fd.set("decision", decision);
    fd.set("decision_note", cleanNote);
    const res = await decideApproval({}, fd);
    if (res.ok) {
      decided += 1;
      if (res.info) infos.push(res.info);
    }
    else {
      skipped += 1;
      firstError ??= res.error;
    }
  }
  return { decided, skipped, firstError, infos: infos.length > 0 ? infos : undefined };
}

/** Talebi geri çek — YALNIZ sahibi, YALNIZ bekliyorken. Satır silinmez, `iptal` olur. */
export async function cancelApprovalRequest(
  _prev: ApprovalResult,
  fd: FormData,
): Promise<ApprovalResult> {
  const gate = await requirePermission("commissions", "view", { write: true });
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

  if (error) return { error: actionErrorMessage(error, "Talep iptal edilemedi.") };

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
  const gate = await requirePermission("commissions", "view", { write: true });
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
  if (error) return { error: actionErrorMessage(error, "Not eklenemedi.") };

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

/* -------------------------------------------------------------------------- */
/* Vekil onaylayıcı (OA12)                                                     */
/* -------------------------------------------------------------------------- */

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const MAX_DELEGATION_DAYS = 90;

/** Vekalet yönetimi: yalnız ofis sahibi / genel müdür + ayar düzenleme (RLS approval_delegations aynı kuralı uygular). */
async function delegationGate() {
  const gate = await requirePermission("settings", "edit");
  if (!gate.ok) return gate;
  if (gate.role !== "owner" && gate.role !== "gm") return { ok: false as const, error: "Vekil onaylayıcıyı yalnız ofis sahibi veya genel müdür atayabilir." };
  return gate;
}

/**
 * Vekil onaylayıcı ata (ör. sahip izindeyken). Bitiş günü zorunlu (en çok 90 gün), vekil aktif ve salt okunur olmayan bir
 * ofis üyesi olmalı. Vekil, kendi talebi HARİÇ bekleyen talepleri onaylar/reddeder; her karar denetim kaydında "vekil" işaretlidir.
 */
export async function setApprovalDelegate(_prev: ApprovalResult, fd: FormData): Promise<ApprovalResult> {
  const gate = await delegationGate();
  if (!gate.ok) return { error: gate.error };
  const delegateId = String(fd.get("delegate_id") ?? "").trim();
  const untilOn = String(fd.get("until_on") ?? "").trim();
  const note = String(fd.get("note") ?? "").trim().slice(0, 200) || null;
  if (!UUID_RE.test(delegateId)) return { error: "Vekil seçin." };
  if (delegateId === gate.userId) return { error: "Kendinizi vekil atayamazsınız." };
  const today = trDayKey(now());
  const maxDay = trDayKey(now() + MAX_DELEGATION_DAYS * 86_400_000);
  if (!DATE_RE.test(untilOn)) return { error: "Bitiş tarihi seçin." };
  if (untilOn < today) return { error: "Bitiş tarihi bugünden önce olamaz." };
  if (untilOn > maxDay) return { error: `Vekalet en çok ${MAX_DELEGATION_DAYS} gün sürebilir.` };

  const supabase = await createClient();
  const { data: person } = await supabase
    .from("profiles")
    .select("id, full_name, role, is_active")
    .eq("id", delegateId)
    .eq("tenant_id", gate.tenantId)
    .maybeSingle();
  if (!person || !person.is_active || person.role === "readonly") return { error: "Vekil bu ofisin aktif bir üyesi olmalı." };

  const { error } = await supabase
    .from("approval_delegations")
    .upsert({ tenant_id: gate.tenantId, delegate_id: delegateId, until_on: untilOn, note, set_by: gate.userId }, { onConflict: "tenant_id" });
  if (error) return { error: actionErrorMessage(error, "Vekil kaydedilemedi.") };

  await logActivity({
    tenantId: gate.tenantId,
    actorId: gate.userId,
    action: "approval_delegate_set",
    entityType: "approval_delegation",
    entityId: delegateId,
    newValue: { delegate_id: delegateId, until_on: untilOn, note },
  });
  const tenantId = gate.tenantId;
  afterSafe(
    () =>
      notifyTenant({
        tenantId,
        userId: delegateId,
        title: "Vekil onaylayıcı olarak atandınız",
        body: `${untilOn.split("-").reverse().join(".")} tarihine kadar bekleyen onay taleplerine karar verebilirsiniz.`,
        href: "/app/onaylar?durum=bekliyor&kim=bana",
        kind: "info",
      }),
    "approval.notify_delegate",
  );
  revalidatePath(PATH);
  return { ok: true, info: `${person.full_name} vekil onaylayıcı olarak atandı.` };
}

/** Vekaleti hemen bitir. */
export async function clearApprovalDelegate(_prev: ApprovalResult, _fd: FormData): Promise<ApprovalResult> {
  const gate = await delegationGate();
  if (!gate.ok) return { error: gate.error };
  const supabase = await createClient();
  const { data, error } = await supabase.from("approval_delegations").delete().eq("tenant_id", gate.tenantId).select("delegate_id").maybeSingle();
  if (error) return { error: actionErrorMessage(error, "Vekalet kaldırılamadı.") };
  await logActivity({
    tenantId: gate.tenantId,
    actorId: gate.userId,
    action: "approval_delegate_cleared",
    entityType: "approval_delegation",
    entityId: (data as { delegate_id?: string } | null)?.delegate_id ?? null,
    oldValue: data ?? null,
  });
  revalidatePath(PATH);
  return { ok: true, info: "Vekalet kaldırıldı." };
}
