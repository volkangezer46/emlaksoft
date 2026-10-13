"use server";

import { closeCallPriorityAfterContact } from "@/lib/insights/close-on-contact";
import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { requirePermission } from "@/lib/require-permission";
import { logActivity } from "@/lib/activity";
import { actionErrorMessage } from "@/lib/action-errors";
import { now } from "@/lib/clock";
import { isValidTurkishMobile, normalizeTurkishPhone, toWhatsAppLink } from "@/lib/phone";
import { isSignerSmsAvailable, sendSignerSms } from "@/app/imza/_lib/sms";
import { gateIysRecipient, IYS_SKIP_LABELS } from "@/lib/iys/gate";
import { DEMO_BLOCKED } from "@/lib/sample-scope";
import {
  buildAuthorityReminderText,
  canSendReminder,
  EIDS_MANUAL_SOURCES,
  isEidsExemptReason,
  isEidsVerifyStatus,
  validateManualAuthorityTerm,
  type EidsSource,
} from "@/lib/eids/authority-status";
import { applyAuthorityEvent, undoAuthorityEvent, type LedgerResult } from "@/lib/eids/ledger";
import { findAuthorityMatch, type AuthorityMatchLoad } from "@/lib/eids/load";
import { AUTHORITY_OVERRIDE_MIN_REASON, AUTHORITY_OVERRIDE_TTL_HOURS } from "@/lib/authority-shield";
import { EIDS_MATCH_WARNING_LABELS, type EidsDealKind } from "@/lib/eids/match";
import { isMissingSchema } from "@/lib/listing-control/server/db";

export type AuthorityActionResult = { ok?: boolean; error?: string; waUrl?: string; info?: string };

/** Elle yetki durumu girişi ("Yetki durumu" kartı). */
export type ManualAuthorityInput = {
  status: string;
  source: string;
  /** YYYY-MM-DD; durum "onaylandı" iken zorunlu (en az 3 ay kuralı). */
  validUntil?: string | null;
  /**
   * YYYY-MM-DD; yetki veriliş tarihi (3 ay kuralının başlangıcı). Doluysa portföyün `authorization_start` değerine
   * defterden yazılır (geri alınabilir). Boşsa portföydeki mevcut başlangıç, o da yoksa bugün esas alınır.
   */
  grantedOn?: string | null;
  /** "Portalda doğrulandı" işareti: teyit zamanı yazılır. */
  portalVerified?: boolean;
  /** e-Devlet ekran görüntüsü (portföy medyasında belge olarak yüklenmiş dosya). */
  evidenceMediaId?: string | null;
  note?: string | null;
};

/** Bildirim olguları (elle eşleştirme): Bakanlık e-postasındaki bilgiler. */
export type AuthorityMatchInput = {
  propertyNo: string;
  dealKind?: string | null;
  grantorName?: string | null;
  validUntil?: string | null;
  /** grant = yetki verildi, revoke = yetki iptal edildi. */
  kind?: "grant" | "revoke";
  /** Bekleyen bildirimden gelindiyse EP3 `eids_inbound_messages.id` (defter olayına iz olarak yazılır). */
  inboundMessageId?: string | null;
};

const DAY_RE = /^\d{4}-\d{2}-\d{2}$/;
const STATUS_KIND = { approved: "manual_set", pending: "manual_set", unknown: "manual_set", rejected: "manual_set", revoked: "revoke", expired: "expire" } as const;

function ledgerError(r: LedgerResult): AuthorityActionResult {
  return r.ok ? { ok: true } : { error: r.error };
}

function parseDealKind(v: string | null | undefined): EidsDealKind | null {
  return v === "sale" || v === "rent" ? v : null;
}

const UUID_RE = /^[0-9a-fA-F-]{36}$/;
const DOC_NO_MAX = 60;

function revalidate(propertyId: string) {
  revalidatePath("/app/ilan-kontrol/yetki");
  revalidatePath("/app/ilan-kontrol");
  revalidatePath(`/app/portfoyler/${propertyId}`);
}

/**
 * Kuyruk satırından hızlı güncelleme: yetki belgesi no ve/veya EİDS durumu. Durum değişikliği TEK YAZMA NOKTASINDAN
 * (`applyAuthorityEvent`, kaynak "elle giriş") geçer ve defterde iz bırakır; belge no yetki durumu değildir, doğrudan yazılır.
 * Defter kurulmamışsa (migration uygulanmamış) yalnız eski üç durum (bekliyor/onaylandı/reddedildi) eski yoldan yazılır.
 * Bu resmi bir EİDS sorgusu değildir.
 */
export async function updateAuthorityStatus(
  propertyId: string,
  patch: { docNo?: string | null; eidsStatus?: string; ownerApproved?: boolean },
): Promise<AuthorityActionResult> {
  const gate = await requirePermission("portals", "edit");
  if (!gate.ok) return { error: gate.error };
  if (!UUID_RE.test(String(propertyId ?? ""))) return { error: "Portföy bulunamadı." };

  const status = patch.eidsStatus ?? (patch.ownerApproved === true ? "approved" : patch.ownerApproved === false ? "pending" : undefined);
  if (status !== undefined && !isEidsVerifyStatus(status)) return { error: "Geçersiz EİDS durumu." };
  let docNo: string | null | undefined;
  if (patch.docNo !== undefined) {
    const doc = String(patch.docNo ?? "").trim();
    if (doc.length > DOC_NO_MAX) return { error: `Yetki belgesi numarası en fazla ${DOC_NO_MAX} karakter olabilir.` };
    docNo = doc || null;
  }
  if (status === undefined && docNo === undefined) return { error: "Güncellenecek alan yok." };

  const supabase = await createClient();
  if (docNo !== undefined) {
    const { data, error } = await supabase
      .from("properties")
      .update({ authority_doc_no: docNo })
      .eq("id", propertyId)
      .eq("tenant_id", gate.tenantId)
      .is("deleted_at", null)
      .select("id");
    if (error) {
      console.error("updateAuthorityStatus", { code: error.code });
      return { error: actionErrorMessage(error, "Yetki belgesi numarası kaydedilemedi.") };
    }
    if (!data || data.length === 0) return { error: "Portföy bulunamadı ya da güncelleme yetkiniz yok." };
  }

  if (status !== undefined) {
    const res = await applyAuthorityEvent(supabase, {
      tenantId: gate.tenantId,
      propertyId,
      kind: STATUS_KIND[status],
      source: "manual",
      newStatus: status,
    });
    if (!res.ok && res.code === "schema_pending" && (status === "pending" || status === "approved" || status === "rejected")) {
      // Defter yokken eski yol (iz yalnız etkinlik günlüğünde).
      const { data, error } = await supabase
        .from("properties")
        .update({ authority_eids_status: status, authority_owner_approved_at: status === "approved" ? new Date(now()).toISOString() : null })
        .eq("id", propertyId)
        .eq("tenant_id", gate.tenantId)
        .is("deleted_at", null)
        .select("id");
      if (error) {
        console.error("updateAuthorityStatus legacy", { code: error.code });
        return { error: actionErrorMessage(error, "Yetki durumu güncellenemedi.") };
      }
      if (!data || data.length === 0) return { error: "Portföy bulunamadı ya da güncelleme yetkiniz yok." };
    } else if (!res.ok) {
      return { error: res.error };
    }
  }

  await logActivity({
    tenantId: gate.tenantId,
    actorId: gate.userId,
    action: "property.authority_status",
    entityType: "property",
    entityId: propertyId,
    newValue: { eids_status: status ?? null, doc_no_changed: docNo !== undefined },
  });
  revalidate(propertyId);
  return { ok: true, info: status !== undefined ? "Yetki durumu kaydedildi; geri almak için 'Son işlemi geri al'." : undefined };
}

/**
 * Mal sahibine e-Devlet EİDS onay hatırlatması gönderir. İYS KAPISINDAN GEÇER (merkezi `gateIysRecipient`):
 * izin yoksa/geri alınmışsa gönderilmez, neden söylenir. SMS ofisin kendi sağlayıcısıyla gider; WhatsApp için gönderim
 * yapılmaz, danışmanın kendi hattından açacağı hazır bağlantı üretilir (serbest metin WhatsApp şablon sözleşmesine aykırıdır).
 * Gönderim izi (zaman, adet, kanal) portföyde tutulur; 24 saatte bir kez.
 */
export async function sendAuthorityReminder(propertyId: string, channel: "sms" | "whatsapp"): Promise<AuthorityActionResult> {
  const gate = await requirePermission("portals", "edit");
  if (!gate.ok) return { error: gate.error };
  if (!UUID_RE.test(String(propertyId ?? ""))) return { error: "Portföy bulunamadı." };
  if (channel !== "sms" && channel !== "whatsapp") return { error: "Geçersiz kanal." };

  const supabase = await createClient();
  const { data: p } = await supabase
    .from("properties")
    .select("id, property_code, title, authorization_start, authorization_end, authority_eids_status, authority_reminder_sent_at, authority_reminder_count")
    .eq("id", propertyId)
    .eq("tenant_id", gate.tenantId)
    .is("deleted_at", null)
    .maybeSingle();
  if (!p) return { error: "Portföy bulunamadı." };

  const nowMs = now();
  const can = canSendReminder(
    {
      authority_eids_status: p.authority_eids_status ?? null,
      authority_reminder_sent_at: p.authority_reminder_sent_at ?? null,
      authorization_end: p.authorization_end ?? null,
      authorization_start: p.authorization_start ?? null,
    },
    nowMs,
  );
  if (!can.ok) return { error: can.reason ?? "Hatırlatma şu an gönderilemez." };

  const { data: ownerInfo } = await supabase
    .from("property_owner_info")
    .select("customer_id")
    .eq("tenant_id", gate.tenantId)
    .eq("property_id", propertyId)
    .maybeSingle();
  const ownerId = (ownerInfo as { customer_id?: string | null } | null)?.customer_id ?? null;
  if (!ownerId) return { error: "Bu portföyde mal sahibi kaydı yok; önce ilan sahibi bilgisini girin." };

  const { data: owner } = await supabase
    .from("customers")
    .select("id, full_name, phone, is_sample, blacklist")
    .eq("id", ownerId)
    .eq("tenant_id", gate.tenantId)
    .is("deleted_at", null)
    .maybeSingle();
  if (!owner) return { error: "Mal sahibi bulunamadı veya görüntüleme yetkiniz yok." };
  if (owner.is_sample) return { error: `Demo kayıt: gerçek gönderim engellendi (${DEMO_BLOCKED}).` };
  if (owner.blacklist) return { error: "Mal sahibi kara listede; mesaj gönderilmez." };
  const phone = normalizeTurkishPhone(owner.phone ?? "");
  if (!owner.phone || !isValidTurkishMobile(phone)) return { error: "Mal sahibinin geçerli bir cep telefonu yok." };

  // Merkezi İYS kapısı: izinsiz alıcıya hatırlatma gitmez.
  const iys = await gateIysRecipient(supabase, { tenantId: gate.tenantId, kind: "authority_reminder", channel, customerId: ownerId });
  if (!iys.allowed) {
    return { error: `İYS izni yok (${IYS_SKIP_LABELS[iys.reason ?? "no_record"]}); mesaj gönderilmedi. Uyum sayfasından ${channel === "sms" ? "SMS" : "WhatsApp"} iznini kaydedin.` };
  }

  const { data: tenant } = await supabase.from("tenants").select("name").eq("id", gate.tenantId).maybeSingle();
  const label = [p.property_code, p.title].filter(Boolean).join(" ") || "portföyünüz";
  const text = buildAuthorityReminderText({
    ownerName: owner.full_name,
    office: (tenant as { name?: string } | null)?.name ?? null,
    propertyLabel: label,
    endDate: p.authorization_end,
  });

  let waUrl: string | undefined;
  if (channel === "sms") {
    if (!(await isSignerSmsAvailable(gate.tenantId, owner.phone))) {
      return { error: "SMS yapılandırması yok — Ayarlar → Entegrasyonlar bölümünden Netgsm bilgilerinizi girin." };
    }
    const res = await sendSignerSms(gate.tenantId, owner.phone, text);
    if (!res.ok) {
      if (res.code === "50" || res.code === "51") return { error: "SMS kredisi yetersiz — Netgsm bakiyenizi kontrol edin." };
      return { error: res.error ?? "SMS gönderilemedi; birkaç dakika sonra tekrar deneyin." };
    }
  } else {
    waUrl = toWhatsAppLink(owner.phone, text) ?? undefined;
    if (!waUrl) return { error: "WhatsApp bağlantısı üretilemedi." };
  }

  const nowIso = new Date(nowMs).toISOString();
  const { error: upErr } = await supabase
    .from("properties")
    .update({
      authority_reminder_sent_at: nowIso,
      authority_reminder_count: (p.authority_reminder_count ?? 0) + 1,
      authority_reminder_channel: channel,
    })
    .eq("id", propertyId)
    .eq("tenant_id", gate.tenantId);
  if (upErr) console.error("sendAuthorityReminder: iz yazılamadı", { code: upErr.code });

  // Zaman tüneli kaydı (best-effort; gönderimi geri almaz).
  await supabase.from("communications").insert({
    tenant_id: gate.tenantId,
    customer_id: ownerId,
    property_id: propertyId,
    created_by: gate.userId,
    channel,
    direction: "outbound",
    subject: "Yetki onayı hatırlatması",
    body: text,
  });
  // Mal sahibine hatırlatma gitti = temas: açık "Bugün ara" kartı kapanır.
  closeCallPriorityAfterContact(ownerId);

  await logActivity({
    tenantId: gate.tenantId,
    actorId: gate.userId,
    action: "property.authority_reminder",
    entityType: "property",
    entityId: propertyId,
    newValue: { channel, via: channel === "sms" ? "sms" : "wa_link" },
  });
  revalidate(propertyId);
  revalidatePath(`/app/musteriler/${ownerId}`);
  return {
    ok: true,
    waUrl,
    info: channel === "sms" ? "Hatırlatma SMS'i gönderildi." : "WhatsApp mesajı hazır; bağlantıyı açıp gönderin.",
  };
}

/**
 * Portföy "Yetki durumu" kartından elle giriş: durum, bitiş tarihi (en az 3 ay kuralı; ihlal "ne oldu, ne yapmalı"
 * hatasıyla REDDEDİLİR), kaynak (elle / belge / portal kontrolü), e-Devlet ekran görüntüsü ve "Portalda doğrulandı".
 * Yazım `applyAuthorityEvent` ile defterden geçer ve geri alınabilir.
 */
export async function setPropertyAuthority(propertyId: string, input: ManualAuthorityInput): Promise<AuthorityActionResult> {
  const gate = await requirePermission("portals", "edit");
  if (!gate.ok) return { error: gate.error };
  if (!UUID_RE.test(String(propertyId ?? ""))) return { error: "Portföy bulunamadı." };
  const status = String(input?.status ?? "");
  if (!isEidsVerifyStatus(status)) return { error: "Ne oldu: yetki durumu seçilmedi. Ne yapmalı: listeden bir durum seçin." };
  const source = String(input?.source ?? "manual") as EidsSource;
  if (!EIDS_MANUAL_SOURCES.includes(source)) return { error: "Ne oldu: kaynak geçersiz. Ne yapmalı: elle giriş, belge ya da portal kontrolünden birini seçin." };
  const validUntil = String(input.validUntil ?? "").trim() || null;
  const grantedOn = String(input.grantedOn ?? "").trim() || null;
  if ((validUntil && !DAY_RE.test(validUntil)) || (grantedOn && !DAY_RE.test(grantedOn))) {
    return { error: "Ne oldu: tarih okunamadı. Ne yapmalı: tarihleri takvimden seçin." };
  }
  if (status === "approved" && !validUntil) {
    return { error: "Ne oldu: onaylı yetki için bitiş tarihi girilmedi. Ne yapmalı: e-Devlet EİDS ekranındaki yetki bitiş tarihini girin." };
  }
  const supabase = await createClient();
  // Veriliş tarihi boşsa portföyde kayıtlı başlangıç esas alınır (2 ay önce verilmiş geçerli yetki "bugün" sayılıp reddedilmesin).
  let termStart = grantedOn;
  if (!termStart && status === "approved") {
    const { data: cur } = await supabase.from("properties").select("authorization_start").eq("id", propertyId).eq("tenant_id", gate.tenantId).maybeSingle();
    const start = (cur as { authorization_start?: string | null } | null)?.authorization_start;
    termStart = start ? String(start).slice(0, 10) : null;
  }
  const term = validateManualAuthorityTerm({ grantedOn: termStart, validUntil: status === "approved" ? validUntil : null }, now());
  if (!term.ok) return { error: term.error };

  const evidenceMediaId = String(input.evidenceMediaId ?? "").trim() || null;
  if (evidenceMediaId) {
    if (!UUID_RE.test(evidenceMediaId)) return { error: "Ne oldu: seçilen belge bulunamadı. Ne yapmalı: listeden yeniden seçin." };
    const { data: media } = await supabase
      .from("property_media")
      .select("id")
      .eq("id", evidenceMediaId)
      .eq("property_id", propertyId)
      .eq("tenant_id", gate.tenantId)
      .maybeSingle();
    if (!media) return { error: "Ne oldu: seçilen belge bu portföye ait değil. Ne yapmalı: Medya sekmesinden bu portföye yükleyip yeniden seçin." };
  }
  if (source === "document" && !evidenceMediaId) {
    return { error: "Ne oldu: kaynak 'belge' seçildi ama ekran görüntüsü seçilmedi. Ne yapmalı: e-Devlet ekran görüntüsünü Medya sekmesinden belge olarak yükleyip burada seçin." };
  }
  const verified = Boolean(input.portalVerified) || source === "portal_check" || (source === "document" && Boolean(evidenceMediaId));
  const res = await applyAuthorityEvent(supabase, {
    tenantId: gate.tenantId,
    propertyId,
    kind: STATUS_KIND[status],
    source: input.portalVerified ? "portal_check" : source,
    newStatus: status,
    validUntil: status === "approved" ? validUntil : null,
    setValidUntil: status === "approved" && Boolean(validUntil),
    validFrom: status === "approved" ? grantedOn : null,
    setValidFrom: status === "approved" && Boolean(grantedOn),
    verified,
    evidenceMediaId,
    note: input.note ?? null,
  });
  if (!res.ok) return ledgerError(res);
  await logActivity({
    tenantId: gate.tenantId,
    actorId: gate.userId,
    action: "property.authority_status",
    entityType: "property",
    entityId: propertyId,
    newValue: { eids_status: status, source, verified, granted_on: status === "approved" ? grantedOn : null, event_id: res.eventId },
  });
  revalidate(propertyId);
  return { ok: true, info: "Yetki durumu kaydedildi." };
}

/**
 * EİDS istisnası ("Tapum yok" / "e-Devlet erişimi olmayan yabancı malik"). İşaretlemek için yanıltıcı beyan uyarısının
 * okunduğu onaylanmalıdır; işaretli portföy EİDS kontrolünden (bekleyen/iptal/bilinmiyor kovaları) çıkar. Defterden geçer.
 */
export async function setAuthorityExemption(propertyId: string, reason: string | null, acknowledged: boolean, note?: string | null): Promise<AuthorityActionResult> {
  const gate = await requirePermission("portals", "edit");
  if (!gate.ok) return { error: gate.error };
  if (!UUID_RE.test(String(propertyId ?? ""))) return { error: "Portföy bulunamadı." };
  if (reason !== null && !isEidsExemptReason(reason)) return { error: "Ne oldu: istisna türü geçersiz. Ne yapmalı: listeden seçin." };
  if (reason !== null && !acknowledged) {
    return { error: "Ne oldu: yanıltıcı beyan uyarısı onaylanmadı. Ne yapmalı: uyarıyı okuyup onay kutusunu işaretleyin." };
  }
  const supabase = await createClient();
  const res = await applyAuthorityEvent(supabase, {
    tenantId: gate.tenantId,
    propertyId,
    kind: "manual_set",
    source: "manual",
    exemptReason: reason,
    note: note ?? null,
  });
  if (!res.ok) return ledgerError(res);
  await logActivity({
    tenantId: gate.tenantId,
    actorId: gate.userId,
    action: "property.authority_exemption",
    entityType: "property",
    entityId: propertyId,
    newValue: { exempt_reason: reason, event_id: res.eventId },
  });
  revalidate(propertyId);
  return { ok: true, info: reason ? "İstisna işaretlendi; portföy EİDS kontrolünden çıkarıldı." : "İstisna kaldırıldı." };
}

/** Son yetki işlemini geri alır (önceki duruma döner; geri alma da defterde ayrı bir olaydır). */
export async function undoAuthorityChange(propertyId: string, eventId: string): Promise<AuthorityActionResult> {
  const gate = await requirePermission("portals", "edit");
  if (!gate.ok) return { error: gate.error };
  if (!UUID_RE.test(String(propertyId ?? "")) || !UUID_RE.test(String(eventId ?? ""))) return { error: "Kayıt bulunamadı." };
  const supabase = await createClient();
  const res = await undoAuthorityEvent(supabase, gate.tenantId, eventId);
  if (!res.ok) return ledgerError(res);
  await logActivity({
    tenantId: gate.tenantId,
    actorId: gate.userId,
    action: "property.authority_undo",
    entityType: "property",
    entityId: propertyId,
    newValue: { undone_event_id: eventId, event_id: res.eventId, restored_status: res.newStatus },
  });
  revalidate(propertyId);
  return { ok: true, info: "İşlem geri alındı; önceki yetki durumuna dönüldü." };
}

/**
 * Yayın engelini aşma (yalnız ofis sahibi, gerekçe zorunlu): iptal edilmiş / süresi dolmuş yetkide yeni yayın ve portal
 * aktarımı `AUTHORITY_OVERRIDE_TTL_HOURS` saat serbest kalır. Durum değişmez; izin defterde "override" olayıdır.
 */
export async function overrideAuthorityBlock(propertyId: string, reason: string): Promise<AuthorityActionResult> {
  const gate = await requirePermission("portals", "edit");
  if (!gate.ok) return { error: gate.error };
  if (gate.role !== "owner") return { error: "Ne oldu: yayın engelini yalnız ofis sahibi aşabilir. Ne yapmalı: ofis sahibinden izni vermesini isteyin." };
  if (!UUID_RE.test(String(propertyId ?? ""))) return { error: "Portföy bulunamadı." };
  const text = String(reason ?? "").trim();
  if (text.length < AUTHORITY_OVERRIDE_MIN_REASON) {
    return { error: `Ne oldu: gerekçe çok kısa. Ne yapmalı: engeli neden aştığınızı en az ${AUTHORITY_OVERRIDE_MIN_REASON} karakterle yazın.` };
  }
  const supabase = await createClient();
  const res = await applyAuthorityEvent(supabase, { tenantId: gate.tenantId, propertyId, kind: "override", source: "manual", note: text });
  if (!res.ok) return ledgerError(res);
  await logActivity({
    tenantId: gate.tenantId,
    actorId: gate.userId,
    action: "property.authority_override",
    entityType: "property",
    entityId: propertyId,
    newValue: { event_id: res.eventId, ttl_hours: AUTHORITY_OVERRIDE_TTL_HOURS },
  });
  revalidate(propertyId);
  return { ok: true, info: `Yayın engeli ${AUTHORITY_OVERRIDE_TTL_HOURS} saatliğine kaldırıldı; gerekçe kayda geçti.` };
}

export type AuthorityMatchActionResult =
  | { ok: false; error: string }
  | {
      ok: true;
      match: Extract<AuthorityMatchLoad, { ok: true }>;
      exact: { id: string; property_code: string | null; title: string | null; warnings: string[] } | null;
    };

/** Elle eşleştirme (İlan Kontrol > Yetki > Eşleştir): birebir eşleşme ya da en çok 5 aday. HİÇBİR ŞEY YAZMAZ. */
export async function findAuthorityMatchAction(input: AuthorityMatchInput): Promise<AuthorityMatchActionResult> {
  const gate = await requirePermission("portals", "view");
  if (!gate.ok) return { ok: false, error: gate.error };
  const validUntil = String(input?.validUntil ?? "").trim() || null;
  if (validUntil && !DAY_RE.test(validUntil)) return { ok: false, error: "Ne oldu: bitiş tarihi okunamadı. Ne yapmalı: tarihi takvimden seçin." };
  const supabase = await createClient();
  const match = await findAuthorityMatch(supabase, gate.tenantId, {
    propertyNo: String(input?.propertyNo ?? ""),
    dealKind: parseDealKind(input?.dealKind),
    grantorName: String(input?.grantorName ?? "").trim().slice(0, 120) || null,
    validUntil,
  });
  if (!match.ok) return { ok: false, error: match.error };
  let exact: { id: string; property_code: string | null; title: string | null; warnings: string[] } | null = null;
  if (match.result.kind === "exact") {
    const { data } = await supabase.from("properties").select("id, property_code, title").eq("id", match.result.propertyId).eq("tenant_id", gate.tenantId).maybeSingle();
    const p = data as { id: string; property_code: string | null; title: string | null } | null;
    exact = { id: match.result.propertyId, property_code: p?.property_code ?? null, title: p?.title ?? null, warnings: match.result.warnings.map((w) => EIDS_MATCH_WARNING_LABELS[w]) };
  }
  return { ok: true, match, exact };
}

/**
 * Eşleştirilen bildirimi portföye uygular. `bind` = adaydan bağlama: portföyde no yoksa bildirimdeki taşınmaz no yazılır
 * (bağlayan kişi = işlemi yapan kullanıcı, defterde "link"). Yetki verildi → onaylandı + bitiş; iptal → iptal edildi.
 */
export async function applyAuthorityMatch(propertyId: string, input: AuthorityMatchInput, bind: boolean): Promise<AuthorityActionResult> {
  const gate = await requirePermission("portals", "edit");
  if (!gate.ok) return { error: gate.error };
  if (!UUID_RE.test(String(propertyId ?? ""))) return { error: "Portföy bulunamadı." };
  const validUntil = String(input?.validUntil ?? "").trim() || null;
  if (validUntil && !DAY_RE.test(validUntil)) return { error: "Ne oldu: bitiş tarihi okunamadı. Ne yapmalı: tarihi takvimden seçin." };
  const kind = input?.kind === "revoke" ? "revoke" : "grant";
  if (kind === "grant" && !validUntil) return { error: "Ne oldu: yetki verildi bildiriminde bitiş tarihi yok. Ne yapmalı: e-postadaki 'tarihine kadar' tarihini girin." };
  const supabase = await createClient();
  // Bildirim izi: kimlik bu ofisin bekleyen bildirimi olmalı. Tablo yoksa (EP3 kurulmamış) iz düşülmez.
  // EP3 SÖZLEŞMESİ: mesajın match_status'unu ("matched") güncellemek EP3 alıcısının işidir; burada yalnız olaya kimlik yazılır.
  let inboundMessageId: string | null = null;
  const rawMsg = String(input?.inboundMessageId ?? "").trim();
  if (rawMsg) {
    if (!UUID_RE.test(rawMsg)) return { error: "Ne oldu: bildirim bulunamadı. Ne yapmalı: bekleyen bildirimler listesinden yeniden seçin." };
    const msg = await supabase.from("eids_inbound_messages").select("id").eq("id", rawMsg).eq("tenant_id", gate.tenantId).maybeSingle();
    if (msg.error && !isMissingSchema(msg.error)) return { error: "Ne oldu: bildirim okunamadı. Ne yapmalı: birkaç saniye sonra tekrar deneyin." };
    if (!msg.error && !msg.data) return { error: "Ne oldu: bildirim bu ofiste bulunamadı. Ne yapmalı: bekleyen bildirimler listesinden yeniden seçin." };
    if (!msg.error) inboundMessageId = rawMsg;
  }
  const res = await applyAuthorityEvent(supabase, {
    tenantId: gate.tenantId,
    propertyId,
    kind: bind ? "link" : kind,
    source: "manual",
    newStatus: kind === "grant" ? "approved" : "revoked",
    validUntil: kind === "grant" ? validUntil : null,
    setValidUntil: kind === "grant" && Boolean(validUntil),
    eidsPropertyNo: String(input?.propertyNo ?? ""),
    bindPropertyNo: bind,
    dealKind: parseDealKind(input?.dealKind),
    grantorName: String(input?.grantorName ?? "").trim().slice(0, 120) || null,
    inboundMessageId,
    note: bind ? "Aday listesinden elle bağlandı." : null,
  });
  if (!res.ok) return ledgerError(res);
  await logActivity({
    tenantId: gate.tenantId,
    actorId: gate.userId,
    action: "property.authority_match",
    entityType: "property",
    entityId: propertyId,
    newValue: { kind, bind, event_id: res.eventId, inbound_message_id: inboundMessageId },
  });
  revalidate(propertyId);
  return { ok: true, info: kind === "grant" ? "Yetki portföye işlendi." : "Yetki iptali portföye işlendi; yayın ve aktarım durduruldu." };
}
