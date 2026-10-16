"use server";

import { createClient } from "@/lib/supabase/server";
import { requirePermission } from "@/lib/require-permission";
import { actionErrorMessage } from "@/lib/action-errors";
import { revalidateTenantData } from "@/lib/revalidate";
import { fetchAllRows } from "@/lib/supabase/fetch-all";
import { now } from "@/lib/clock";
import { logActivity } from "@/lib/activity";
import { describeSkipReasons, gateIysRecipients } from "@/lib/iys/gate";
import { strictIysAllowedIds } from "@/lib/match-bulk-send";
import { isTenantSmsAvailable, isTenantWhatsAppAvailable, prepareTenantSmsSender, prepareTenantWhatsAppSender } from "@/lib/messaging/tenant-providers";
import { isValidWhatsAppTemplateLanguage, isValidWhatsAppTemplateName } from "@/lib/messaging/whatsapp-contract";
import { isUuid } from "@/lib/building-management/input";
import {
  audienceCustomerIds,
  buildAnnouncementSms,
  isAnnouncementAudience,
  isAnnouncementCategory,
  parseDelivery,
  planAnnouncementSend,
  type AnnouncementAudience,
  type AnnouncementChannel,
  type AnnouncementPlan,
  type ResidentCustomer,
} from "@/lib/building-management/announcements";

/**
 * Bina DUYURU action'ları (`expenses` modül kapısı: oluşturma = create, sabitleme/portal görünürlüğü/arşiv/gönderim = edit).
 * Duyuru ofis ekranında ve malik/kiracı portalında görünür. SMS/WhatsApp TOPLU gönderimdir ve ticari ileti gibi ele alınır:
 * merkezi İYS kapısından `kind: "bulk_message"` ile geçer ve YALNIZ kanal izni onaylı (granted) sakinlere gider
 * (ofis "yalnız uyar" modunda olsa bile; izni olmayanlar sayılarak raporlanır, duyuru portalda yine görünür).
 * Her duyuru her kanaldan EN ÇOK BİR KEZ gönderilir (koşullu talep: `delivery-><kanal>` boşken). service_role YOK.
 */

export type AnnouncementResult = { ok?: boolean; error?: string; id?: string; info?: string };
export type AnnouncementPreview = {
  ok?: boolean;
  error?: string;
  channelReady?: boolean;
  counts?: AnnouncementPlan["counts"] & { send: number };
  iysNote?: string;
  alreadySent?: boolean;
};

const MISSING_MSG = "Bina duyuruları için veritabanı güncellemesi henüz uygulanmamış.";
const PATHS = ["/app/aidat"] as const;

function isMissingSchema(e: { code?: string | null; message?: string | null } | null): boolean {
  if (!e) return false;
  const code = String(e.code ?? "");
  return ["42P01", "42703", "PGRST204", "PGRST205"].includes(code) || /does not exist|schema cache|could not find/i.test(String(e.message ?? ""));
}

/** Yeni duyuru (portalda görünür). */
export async function createBuildingAnnouncement(input: {
  buildingId: string;
  title: string;
  body: string;
  category: string;
  pinned?: boolean;
  visibleInPortal?: boolean;
}): Promise<AnnouncementResult> {
  const gate = await requirePermission("expenses", "create");
  if (!gate.ok) return { error: gate.error };
  if (!isUuid(input.buildingId)) return { error: "Bina bulunamadı." };
  const title = String(input.title ?? "").trim();
  const body = String(input.body ?? "").trim();
  if (title.length < 1 || title.length > 120) return { error: "Başlık 1-120 karakter olmalı." };
  if (body.length < 1 || body.length > 2000) return { error: "Duyuru metni 1-2000 karakter olmalı." };
  if (!isAnnouncementCategory(input.category)) return { error: "Duyuru türünü seçin." };
  const supabase = await createClient();
  const { data: building } = await supabase.from("buildings").select("id").eq("id", input.buildingId).eq("tenant_id", gate.tenantId).is("archived_at", null).maybeSingle();
  if (!building) return { error: "Bina bulunamadı." };
  const { data, error } = await supabase
    .from("building_announcements")
    .insert({
      tenant_id: gate.tenantId, building_id: input.buildingId, title, body, category: input.category,
      pinned: Boolean(input.pinned), visible_in_portal: input.visibleInPortal !== false, created_by: gate.userId,
    })
    .select("id")
    .single();
  if (error || !data) {
    if (isMissingSchema(error)) return { error: MISSING_MSG };
    console.error("createBuildingAnnouncement", { code: error?.code });
    return { error: actionErrorMessage(error, "Duyuru kaydedilemedi") };
  }
  revalidateTenantData(gate.tenantId, PATHS);
  return { ok: true, id: data.id as string, info: input.visibleInPortal !== false ? "Duyuru yayımlandı; sakinler portalda görür." : "Duyuru kaydedildi (portalda gizli)." };
}

/** Sabitle / portal görünürlüğü / arşivle. */
export async function updateBuildingAnnouncement(input: { id: string; pinned?: boolean; visibleInPortal?: boolean; archive?: boolean }): Promise<AnnouncementResult> {
  const gate = await requirePermission("expenses", "edit");
  if (!gate.ok) return { error: gate.error };
  if (!isUuid(input.id)) return { error: "Duyuru bulunamadı." };
  const patch: Record<string, unknown> = {};
  if (typeof input.pinned === "boolean") patch.pinned = input.pinned;
  if (typeof input.visibleInPortal === "boolean") patch.visible_in_portal = input.visibleInPortal;
  if (input.archive) patch.archived_at = new Date(now()).toISOString();
  if (Object.keys(patch).length === 0) return { ok: true };
  const supabase = await createClient();
  const { data, error } = await supabase.from("building_announcements").update(patch).eq("id", input.id).eq("tenant_id", gate.tenantId).is("archived_at", null).select("id").maybeSingle();
  if (error) {
    if (isMissingSchema(error)) return { error: MISSING_MSG };
    return { error: actionErrorMessage(error, "Duyuru güncellenemedi") };
  }
  if (!data) return { error: "Duyuru bulunamadı." };
  revalidateTenantData(gate.tenantId, PATHS);
  return { ok: true };
}

type Loaded = {
  announcement: { id: string; building_id: string; title: string; body: string; delivery: unknown };
  buildingName: string;
  plan: AnnouncementPlan;
  iysNote: string;
};

/** Duyuru + bina sakinleri + İYS kapısı → gönderim planı (yazma yok). */
async function buildPlan(
  supabase: Awaited<ReturnType<typeof createClient>>,
  tenantId: string,
  announcementId: string,
  channel: AnnouncementChannel,
  audience: AnnouncementAudience,
): Promise<Loaded | { error: string }> {
  const { data: ann, error } = await supabase
    .from("building_announcements")
    .select("id, building_id, title, body, delivery, building:buildings!building_announcements_building_tenant_fkey(name)")
    .eq("id", announcementId)
    .eq("tenant_id", tenantId)
    .is("archived_at", null)
    .maybeSingle();
  if (error) return { error: isMissingSchema(error) ? MISSING_MSG : actionErrorMessage(error, "Duyuru okunamadı") };
  if (!ann) return { error: "Duyuru bulunamadı." };
  const a = ann as unknown as Loaded["announcement"] & { building: { name: string } | { name: string }[] | null };
  const b = Array.isArray(a.building) ? a.building[0] : a.building;

  const { data: units, error: uErr } = await fetchAllRows<{ owner_customer_id: string | null; tenant_customer_id: string | null }>((from, to) =>
    supabase.from("building_units").select("id, owner_customer_id, tenant_customer_id")
      .eq("tenant_id", tenantId).eq("building_id", a.building_id).eq("active", true)
      .order("id", { ascending: true }).range(from, to), 1000, 5);
  if (uErr) return { error: "Sakinler okunamadı. Sayfayı yenileyip tekrar deneyin." };
  const ids = audienceCustomerIds(units.map((u) => ({ ownerCustomerId: u.owner_customer_id, tenantCustomerId: u.tenant_customer_id })), audience);

  let customers: ResidentCustomer[] = [];
  if (ids.length > 0) {
    type CustRaw = { id: string; full_name: string | null; phone: string | null; blacklist: boolean | null; is_sample: boolean | null; deleted_at: string | null };
    const rows: CustRaw[] = [];
    for (let i = 0; i < ids.length; i += 200) {
      const { data, error: cErr } = await supabase
        .from("customers")
        .select("id, full_name, phone, blacklist, is_sample, deleted_at")
        .eq("tenant_id", tenantId)
        .in("id", ids.slice(i, i + 200));
      if (cErr) return { error: actionErrorMessage(cErr, "Sakinler okunamadı") };
      rows.push(...((data ?? []) as CustRaw[]));
    }
    customers = (rows as { id: string; full_name: string | null; phone: string | null; blacklist: boolean | null; is_sample: boolean | null; deleted_at: string | null }[]).map((c) => ({
      id: c.id, fullName: c.full_name, phone: c.phone, blacklist: Boolean(c.blacklist), isSample: Boolean(c.is_sample), deleted: Boolean(c.deleted_at),
    }));
  }
  const iys = await gateIysRecipients(supabase, { tenantId, kind: "bulk_message", channel, customerIds: ids });
  const allowed = strictIysAllowedIds(iys);
  const plan = planAnnouncementSend({ customerIds: ids, customers, allowed });
  const strictReasons = { ...iys.reasons };
  for (const w of iys.warned ?? []) strictReasons[w.reason] = (strictReasons[w.reason] ?? 0) + 1;
  return { announcement: a, buildingName: b?.name ?? "Bina", plan, iysNote: describeSkipReasons(strictReasons) };
}

function readChannel(v: unknown): AnnouncementChannel | null {
  return v === "sms" || v === "whatsapp" ? v : null;
}

/** Onay penceresi sayıları: kaç sakine gidecek, kaçı telefonsuz / izinsiz / engelli. Hiçbir şey yazılmaz. */
export async function previewAnnouncementSend(input: { id: string; channel: string; audience: string }): Promise<AnnouncementPreview> {
  const gate = await requirePermission("expenses", "edit");
  if (!gate.ok) return { error: gate.error };
  const channel = readChannel(input.channel);
  if (!isUuid(input.id) || !channel || !isAnnouncementAudience(input.audience)) return { error: "Gönderim bilgilerini kontrol edin." };
  const supabase = await createClient();
  const [planned, ready] = await Promise.all([
    buildPlan(supabase, gate.tenantId, input.id, channel, input.audience),
    channel === "sms" ? isTenantSmsAvailable(gate.tenantId) : isTenantWhatsAppAvailable(gate.tenantId),
  ]);
  if ("error" in planned) return { error: planned.error };
  return {
    ok: true,
    channelReady: ready,
    counts: { ...planned.plan.counts, send: planned.plan.send.length },
    iysNote: planned.iysNote,
    alreadySent: Boolean(parseDelivery(planned.announcement.delivery)[channel]),
  };
}

/** Duyuruyu SMS ya da WhatsApp (onaylı şablon) ile İYS izni olan sakinlere gönder; her kanal bir kez. */
export async function sendBuildingAnnouncement(input: {
  id: string;
  channel: string;
  audience: string;
  templateName?: string;
  templateLanguage?: string;
}): Promise<AnnouncementResult> {
  const gate = await requirePermission("expenses", "edit");
  if (!gate.ok) return { error: gate.error };
  const channel = readChannel(input.channel);
  if (!isUuid(input.id) || !channel || !isAnnouncementAudience(input.audience)) return { error: "Gönderim bilgilerini kontrol edin." };
  const audience = input.audience;
  const templateName = String(input.templateName ?? "").trim();
  const templateLanguage = String(input.templateLanguage ?? "tr").trim() || "tr";
  if (channel === "whatsapp" && (!isValidWhatsAppTemplateName(templateName) || !isValidWhatsAppTemplateLanguage(templateLanguage))) {
    return { error: "WhatsApp için Meta'da onaylı şablon adını ve dilini girin (ör. bina_duyurusu · tr)." };
  }
  const ready = channel === "sms" ? await isTenantSmsAvailable(gate.tenantId) : await isTenantWhatsAppAvailable(gate.tenantId);
  if (!ready) return { error: channel === "sms" ? "SMS yapılandırması yok. Ayarlar → Entegrasyonlar bölümünden Netgsm bilgilerinizi girin." : "WhatsApp entegrasyonu yok. Ayarlar → Entegrasyonlar bölümünden bağlayın." };

  const supabase = await createClient();
  const planned = await buildPlan(supabase, gate.tenantId, input.id, channel, audience);
  if ("error" in planned) return { error: planned.error };
  const current = parseDelivery(planned.announcement.delivery);
  if (current[channel]) return { error: "Bu duyuru bu kanaldan zaten gönderildi." };
  if (planned.plan.send.length === 0) return { error: "Gönderilebilecek sakin yok (telefon, İYS izni ve engel kontrollerinden sonra)." };

  // Koşullu talep: aynı anda ikinci gönderim başlatılamaz.
  const at = new Date(now()).toISOString();
  const prior = (planned.announcement.delivery && typeof planned.announcement.delivery === "object" ? planned.announcement.delivery : {}) as Record<string, unknown>;
  const claimDelivery = { ...prior, [channel]: { at, sent: 0, failed: 0, skipped: 0, audience, pending: true } };
  const { data: claimed, error: claimErr } = await supabase
    .from("building_announcements")
    .update({ delivery: claimDelivery })
    .eq("id", input.id)
    .eq("tenant_id", gate.tenantId)
    .is(`delivery->${channel}`, null)
    .select("id")
    .maybeSingle();
  if (claimErr) return { error: actionErrorMessage(claimErr, "Gönderim başlatılamadı") };
  if (!claimed) return { error: "Bu duyuru bu kanaldan zaten gönderiliyor ya da gönderildi." };

  const { data: tenant } = await supabase.from("tenants").select("name").eq("id", gate.tenantId).maybeSingle();
  const text = buildAnnouncementSms({
    officeName: (tenant?.name as string | null | undefined) ?? null,
    buildingName: planned.buildingName,
    title: planned.announcement.title,
    body: planned.announcement.body,
  });
  const smsSender = channel === "sms" ? await prepareTenantSmsSender(gate.tenantId, { source: "building_announcement", audience: "contact" }) : null;
  const waSender = channel === "whatsapp" ? await prepareTenantWhatsAppSender(gate.tenantId, { source: "building_announcement", audience: "contact" }) : null;
  const waParam = `${planned.buildingName}: ${planned.announcement.title}`.slice(0, 600);

  let sent = 0;
  let failed = 0;
  let stoppedReason: string | null = null;
  const comms: Record<string, unknown>[] = [];
  for (const r of planned.plan.send) {
    const res = smsSender
      ? await smsSender(r.phone, text)
      : await waSender!(r.phone, { name: templateName, language: templateLanguage, bodyParameter: waParam });
    if (!res.ok) {
      failed += 1;
      if (res.code === "50" || res.code === "51") {
        stoppedReason = "SMS kredisi yetersiz; Netgsm bakiyenizi kontrol edin.";
        break;
      }
      if (res.code === "tenant_provider_unconfigured" || res.code === "provider_resolution_error" || res.code === "unknown_provider_outcome") {
        stoppedReason = res.error ?? "Mesaj sağlayıcısı çözümlenemedi.";
        break;
      }
      continue;
    }
    sent += 1;
    comms.push({
      tenant_id: gate.tenantId, customer_id: r.customerId, created_by: gate.userId, channel, direction: "outbound",
      subject: `Bina duyurusu · ${planned.buildingName}`.slice(0, 200), body: channel === "sms" ? text : `WhatsApp şablonu (${templateName}): ${waParam}`,
    });
  }
  const c = planned.plan.counts;
  const skipped = c.noPhone + c.noConsent + c.blocked + c.overCap;
  // Hiç gönderilemediyse talep geri bırakılır (yeniden denenebilir); en az bir gönderim varsa kanal kapanır.
  const finalDelivery = sent > 0 ? { ...prior, [channel]: { at, sent, failed, skipped, audience } } : prior;
  await supabase.from("building_announcements").update({ delivery: finalDelivery }).eq("id", input.id).eq("tenant_id", gate.tenantId);
  if (comms.length > 0) {
    const { error: commErr } = await supabase.from("communications").insert(comms);
    if (commErr) console.error("sendBuildingAnnouncement: iletişim geçmişi yazılamadı", { code: commErr.code });
  }
  await logActivity({
    tenantId: gate.tenantId,
    actorId: gate.userId,
    action: "building_announcement.sent",
    entityType: "building_announcement",
    entityId: input.id,
    newValue: { channel, audience, sent, failed, skipped, no_consent: c.noConsent, stopped: stoppedReason != null },
  });
  revalidateTenantData(gate.tenantId, PATHS);
  const base = `${sent} sakine gönderildi${failed > 0 ? ` · ${failed} başarısız` : ""}${skipped > 0 ? ` · ${skipped} atlandı` : ""}`;
  if (stoppedReason) return { ok: sent > 0, error: sent > 0 ? undefined : stoppedReason, info: `${base}. Gönderim durdu: ${stoppedReason}` };
  return { ok: true, info: base };
}
