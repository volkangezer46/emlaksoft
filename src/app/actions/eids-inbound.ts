"use server";

import { revalidatePath } from "next/cache";
import { createAdminClient } from "@/lib/supabase/admin";
import { requirePermission } from "@/lib/require-permission";
import { logActivity } from "@/lib/activity";
import { now } from "@/lib/clock";
import { issueInboundAddress } from "@/lib/eids/inbound-address";
import { createSupabaseInboundStore, processInboundMail, reportUnknownFormat, type InboundResult } from "@/lib/eids/inbound";
import { ledgerApplier } from "@/lib/eids/inbound-ledger";
import { EIDS_ADDRESS_ROLES, EIDS_REVIEW_ROLES, MAX_MAIL_BYTES, MAX_PASTE_CHARS } from "@/lib/eids/inbound-policy";
import { getMailKey, rawAad, unseal } from "@/lib/eids/inbound-crypto";
import { mailBodyToNormalizedText, parseEidsText } from "@/lib/eids/mail-parse";
import { parseMime } from "@/lib/eids/mime";
import { isVerifiedAuth } from "@/lib/eids/mail-auth";

/**
 * Bakanlık (EİDS) e-postaları — server action'lar (EP3). Hepsi `requirePermission` kapısından geçer; yazma tabloya
 * service_role ile yapılır (RLS: authenticated yazamaz) ve HER sorgu oturumdaki tenant_id ile süzülür.
 *  - Adres oluştur / yenile: ayarlar düzenleme + rol owner|gm. Yenileme eski adresi HEMEN geçersiz kılar.
 *  - .eml yükleme / metin yapıştırma: portallar düzenleme. Yükleme SMTP ile aynı doğrulamadan geçer (DKIM/ARC);
 *    yapıştırma her zaman "doğrulanamadı" sayılır ve onaya düşer.
 *  - Onay / yok say (kontrol bekliyor kuyruğu): portallar düzenleme + rol owner|gm|branch_manager.
 * İYS: bu akış hiçbir alıcıya gönderim yapmaz (yalnız alım); İYS sözleşmesine yeni yol eklenmedi.
 */

export type EidsActionResult = { ok?: boolean; error?: string; info?: string; address?: string };

const UUID_RE = /^[0-9a-fA-F-]{36}$/;

function revalidateAll() {
  revalidatePath("/app/ayarlar");
  revalidatePath("/app/ilan-kontrol/yetki");
}

const OUTCOME_INFO: Record<string, string> = {
  applied: "E-posta doğrulandı ve portföyün yetki durumu güncellendi. İşlem yetki geçmişinden geri alınabilir.",
  queued: "E-posta kaydedildi ve kontrol bekliyor listesine düştü; ofis sahibi, genel müdür ya da şube müdürü onaylayınca uygulanır.",
  candidate: "E-posta kaydedildi; taşınmaz numarası birden çok portföye uyuyor. Kontrol bekliyor listesinden doğru portföyü seçin.",
  no_match: "E-posta kaydedildi ama bu taşınmaz numarası hiçbir portföyde yok. Kontrol bekliyor listesinden portföyü seçerek bağlayın.",
  duplicate: "Bu e-posta daha önce işlenmiş; yeni bir işlem açılmadı.",
  unknown_format: "E-posta okunamadı: Bakanlık şablonu tanınmadı. Kayıt tutuldu ve EmlakSoft ekibine bildirildi; yetkiyi portföyden elle işaretleyin.",
  rejected: "Bu e-posta eids.yetki@ticaret.gov.tr adresinden gelmiyor; işlenmedi ve içeriği saklanmadı. Bakanlık e-postasının kendisini yükleyin.",
  forward_confirmation: "İletme onay e-postası alındı; kod Ayarlar > Entegrasyonlar kartında görünür.",
};

function resultInfo(r: InboundResult): EidsActionResult {
  if (!r.ok) return { error: r.error };
  if (r.outcome === "queued" && r.applyError) {
    return { ok: true, info: `E-posta kaydedildi ama otomatik uygulanamadı (${r.applyError}) Kontrol bekliyor listesinden yeniden deneyin.` };
  }
  return { ok: true, info: OUTCOME_INFO[r.outcome] ?? "E-posta işlendi." };
}

/**
 * Yönlendirici bağımlılıkları (service_role): depo HER sorguda çağıranın verdiği tenantId ile süzer
 * (`createSupabaseInboundStore`), olay yazımı EP2 defterinden geçer. Kiracı yalnız oturumdan (gate) gelir.
 */
function inboundPipeline() {
  const db = createAdminClient();
  return { store: createSupabaseInboundStore(db, { onUnknownFormat: reportUnknownFormat }), apply: ledgerApplier(db) };
}

/** Alma adresini oluşturur (renew=false) ya da yeniler (renew=true). */
export async function issueEidsAddress(renew: boolean): Promise<EidsActionResult> {
  const gate = await requirePermission("settings", "edit");
  if (!gate.ok) return { error: gate.error };
  if (!(EIDS_ADDRESS_ROLES as readonly string[]).includes(gate.role)) {
    return { error: "Ne oldu: alma adresini yalnız ofis sahibi ya da genel müdür oluşturup yenileyebilir. Ne yapmalı: ofis sahibinizden isteyin." };
  }
  const res = await issueInboundAddress(createAdminClient(), gate.tenantId, gate.userId, renew === true);
  if (!res.ok) return { error: res.error };
  await logActivity({
    tenantId: gate.tenantId,
    actorId: gate.userId,
    action: renew ? "eids.inbound_address_renewed" : "eids.inbound_address_created",
    entityType: "tenant",
    entityId: gate.tenantId,
    newValue: { renewed: renew === true },
  });
  revalidateAll();
  return {
    ok: true,
    address: res.address,
    info: renew ? "Yeni adres oluşturuldu; eski adrese gelen e-postalar artık reddedilir. İletme kuralınızı yeni adresle güncelleyin." : "Alma adresi oluşturuldu.",
  };
}

/**
 * .eml dosyası yükleme. İstemci dosyayı baytı baytına base64 olarak gönderir (Server Action'a ikili gövde gitmez;
 * DKIM imzası korunur). En çok 256 KB.
 */
export async function uploadEidsEml(input: { name: string; base64: string }): Promise<EidsActionResult> {
  const gate = await requirePermission("portals", "edit");
  if (!gate.ok) return { error: gate.error };
  const name = String(input?.name ?? "").slice(0, 200);
  const b64 = String(input?.base64 ?? "");
  if (!b64) return { error: "Ne oldu: dosya seçilmedi. Ne yapmalı: e-postayı .eml olarak indirip seçin." };
  if (b64.length > Math.ceil((MAX_MAIL_BYTES * 4) / 3) + 8) {
    return { error: "Ne oldu: dosya 256 KB sınırını aşıyor. Ne yapmalı: Bakanlık e-postasını eksiz indirin ya da metnini yapıştırın." };
  }
  if (!/\.(eml|txt)$/i.test(name)) {
    return { error: "Ne oldu: dosya .eml biçiminde değil. Ne yapmalı: Gmail'de ⋮ > \"İletiyi indir\", Outlook'ta \"Farklı kaydet\" ile .eml dosyası alın." };
  }
  const bytes = Buffer.from(b64, "base64");
  if (bytes.length === 0 || bytes.length > MAX_MAIL_BYTES) {
    return { error: "Ne oldu: dosya okunamadı ya da 256 KB sınırını aşıyor. Ne yapmalı: e-postayı yeniden indirip yükleyin." };
  }
  const raw = bytes.toString("latin1");
  const { store, apply } = inboundPipeline();
  const res = await processInboundMail(store, apply, {
    tenantId: gate.tenantId,
    via: "eml_upload",
    raw,
    actorId: gate.userId,
  });
  if (res.ok) {
    await logActivity({
      tenantId: gate.tenantId,
      actorId: gate.userId,
      action: "eids.inbound_eml_uploaded",
      entityType: "eids_inbound_message",
      entityId: res.id ?? gate.tenantId,
      newValue: { outcome: res.outcome, auth: res.auth },
    });
    revalidateAll();
  }
  return resultInfo(res);
}

/** Metin yapıştırma (her zaman doğrulanmamış sayılır). */
export async function pasteEidsText(text: string): Promise<EidsActionResult> {
  const gate = await requirePermission("portals", "edit");
  if (!gate.ok) return { error: gate.error };
  const value = String(text ?? "");
  if (!value.trim()) return { error: "Ne oldu: metin boş. Ne yapmalı: Bakanlık e-postasının gövdesini kopyalayıp yapıştırın." };
  if (value.length > MAX_PASTE_CHARS) return { error: "Ne oldu: metin çok uzun. Ne yapmalı: yalnız e-postanın gövdesini (en çok 20.000 karakter) yapıştırın." };
  const { store, apply } = inboundPipeline();
  const res = await processInboundMail(store, apply, {
    tenantId: gate.tenantId,
    via: "paste",
    pasted: value,
    actorId: gate.userId,
  });
  if (res.ok) {
    await logActivity({
      tenantId: gate.tenantId,
      actorId: gate.userId,
      action: "eids.inbound_text_pasted",
      entityType: "eids_inbound_message",
      entityId: res.id ?? gate.tenantId,
      newValue: { outcome: res.outcome },
    });
    revalidateAll();
  }
  return resultInfo(res);
}

type QueueRow = {
  id: string;
  received_via: string;
  auth_result: string;
  parse_kind: string | null;
  eids_property_no: string | null;
  deal_kind: "sale" | "rent" | null;
  valid_until: string | null;
  match_status: string | null;
  property_id: string | null;
  raw_eml_encrypted: string | null;
};

/** Ham e-posta hâlâ saklıysa malik adını yeniden çıkarır (defter maske + özet üretsin); yoksa null. */
function grantorFromRaw(tenantId: string, rawHex: string | null): string | null {
  const key = getMailKey();
  if (!key || !rawHex) return null;
  const hex = rawHex.startsWith("\\x") ? rawHex.slice(2) : rawHex;
  const sealed = Buffer.from(hex, "hex").toString("utf8");
  const raw = unseal(sealed, key, rawAad(tenantId));
  if (!raw) return null;
  const mime = parseMime(raw.toString("latin1"));
  const parsed = parseEidsText(mailBodyToNormalizedText({ html: mime.html, text: mime.text }));
  return parsed.kind === "unknown" ? null : parsed.grantorName;
}

/**
 * Kontrol bekliyor: seçilen portföye uygular (doğrulanmamış e-posta da insan onayıyla uygulanır).
 * `propertyRef`: aday listesinden portföy kimliği ya da (eşleşme yoksa) elle yazılan portföy kodu.
 */
export async function approveEidsMessage(messageId: string, propertyRef: string): Promise<EidsActionResult> {
  const gate = await requirePermission("portals", "edit");
  if (!gate.ok) return { error: gate.error };
  if (!(EIDS_REVIEW_ROLES as readonly string[]).includes(gate.role)) {
    return { error: "Ne oldu: Bakanlık e-postasını yalnız ofis sahibi, genel müdür ya da şube müdürü onaylayabilir. Ne yapmalı: yöneticinizden onaylamasını isteyin." };
  }
  const ref = String(propertyRef ?? "").trim().slice(0, 64);
  if (!UUID_RE.test(String(messageId ?? "")) || !ref) {
    return { error: "Ne oldu: e-posta ya da portföy seçimi geçersiz. Ne yapmalı: sayfayı yenileyip portföyü yeniden seçin." };
  }
  const admin = createAdminClient();
  const { data, error } = await admin
    .from("eids_inbound_messages")
    .select("id, received_via, auth_result, parse_kind, eids_property_no, deal_kind, valid_until, match_status, property_id, raw_eml_encrypted")
    .eq("tenant_id", gate.tenantId)
    .eq("id", messageId)
    .maybeSingle();
  if (error || !data) return { error: "Ne oldu: e-posta kaydı bulunamadı. Ne yapmalı: sayfayı yenileyin; kayıt başka biri tarafından işlenmiş olabilir." };
  const row = data as QueueRow;
  if ((row.parse_kind !== "grant" && row.parse_kind !== "revoke") || !row.eids_property_no || !row.deal_kind) {
    return { error: "Ne oldu: bu e-postada uygulanacak bir yetki bilgisi yok. Ne yapmalı: yetkiyi portföy ekranından elle işaretleyin." };
  }
  if (!["queued", "candidate", "no_match"].includes(String(row.match_status))) {
    return { error: "Ne oldu: bu e-posta artık onay beklemiyor. Ne yapmalı: sayfayı yenileyin." };
  }
  const { data: prop } = await admin
    .from("properties")
    .select("id")
    .eq("tenant_id", gate.tenantId)
    .eq(UUID_RE.test(ref) ? "id" : "property_code", ref)
    .is("deleted_at", null)
    .limit(1)
    .maybeSingle();
  if (!prop) return { error: "Ne oldu: seçilen portföy bulunamadı. Ne yapmalı: portföy kodunu kontrol edin ya da listeden başka bir portföy seçin." };
  const propertyId = (prop as { id: string }).id;

  // Satırı ATOMİK sahiplen: yalnız hâlâ bekliyorsa 'applied' yap (koşullu update). İki yönetici aynı anda onaylarsa
  // ya da çift tıklanırsa yalnız biri sahiplenir; defter çağrısı tek kez yapılır. Defter hata verirse eski duruma döner.
  const nowIso = new Date(now()).toISOString();
  const prevStatus = String(row.match_status);
  const { data: claimed, error: claimErr } = await admin
    .from("eids_inbound_messages")
    .update({ match_status: "applied", property_id: propertyId, reviewed_by: gate.userId, reviewed_at: nowIso })
    .eq("tenant_id", gate.tenantId)
    .eq("id", row.id)
    .eq("match_status", prevStatus)
    .select("id");
  if (claimErr) return { error: "Ne oldu: kayıt güncellenemedi. Ne yapmalı: birkaç saniye sonra tekrar deneyin." };
  if (!claimed || claimed.length === 0) return { error: "Ne oldu: bu e-posta artık onay beklemiyor (başka biri işlemiş olabilir). Ne yapmalı: sayfayı yenileyin." };

  const applied = await ledgerApplier(admin)({
    tenantId: gate.tenantId,
    propertyId,
    kind: row.parse_kind,
    source: isVerifiedAuth(row.auth_result) ? "email_verified" : "email_unverified",
    inboundMessageId: row.id,
    eidsPropertyNo: row.eids_property_no,
    dealKind: row.deal_kind,
    validUntil: row.valid_until,
    grantorName: grantorFromRaw(gate.tenantId, row.raw_eml_encrypted),
    bindPropertyNo: true,
    actorId: gate.userId,
  });
  if (!applied.ok) {
    const { error: revertErr } = await admin
      .from("eids_inbound_messages")
      .update({ match_status: prevStatus, property_id: row.property_id, reviewed_by: null, reviewed_at: null })
      .eq("tenant_id", gate.tenantId)
      .eq("id", row.id)
      .eq("match_status", "applied")
      .is("authority_event_id", null);
    if (revertErr) console.error("approveEidsMessage: sahiplenme geri alınamadı", { code: revertErr.code });
    return { error: applied.error };
  }

  const { error: upErr } = await admin
    .from("eids_inbound_messages")
    .update({ authority_event_id: applied.eventId })
    .eq("tenant_id", gate.tenantId)
    .eq("id", row.id);
  // Olay defterde açıldı; bağlantı yazılamazsa kayıt yine 'applied' kalır (tekrar onaylanamaz → çift olay yok).
  if (upErr) console.error("approveEidsMessage: olay bağlantısı yazılamadı", { code: upErr.code });
  await logActivity({
    tenantId: gate.tenantId,
    actorId: gate.userId,
    action: "eids.inbound_approved",
    entityType: "property",
    entityId: propertyId,
    newValue: { message_id: row.id, kind: row.parse_kind, auth: row.auth_result },
  });
  revalidateAll();
  revalidatePath(`/app/portfoyler/${propertyId}`);
  return { ok: true, info: "Onaylandı; portföyün yetki durumu güncellendi. İşlem yetki geçmişinden geri alınabilir." };
}

/** Kontrol bekliyor: e-postayı yok sayar (durum değişmez; kayıt iz olarak kalır). */
export async function dismissEidsMessage(messageId: string, note?: string): Promise<EidsActionResult> {
  const gate = await requirePermission("portals", "edit");
  if (!gate.ok) return { error: gate.error };
  if (!(EIDS_REVIEW_ROLES as readonly string[]).includes(gate.role)) {
    return { error: "Ne oldu: yalnız ofis sahibi, genel müdür ya da şube müdürü bu listeyi yönetebilir. Ne yapmalı: yöneticinizden isteyin." };
  }
  if (!UUID_RE.test(String(messageId ?? ""))) return { error: "Ne oldu: e-posta seçimi geçersiz. Ne yapmalı: sayfayı yenileyin." };
  const admin = createAdminClient();
  const { data, error } = await admin
    .from("eids_inbound_messages")
    .update({ match_status: "dismissed", reviewed_by: gate.userId, reviewed_at: new Date(now()).toISOString(), review_note: String(note ?? "").trim().slice(0, 300) || null })
    .eq("tenant_id", gate.tenantId)
    .eq("id", messageId)
    .in("match_status", ["queued", "candidate", "no_match"])
    .select("id");
  if (error) return { error: "Ne oldu: kayıt güncellenemedi. Ne yapmalı: birkaç saniye sonra tekrar deneyin." };
  if (!data || data.length === 0) return { error: "Ne oldu: bu e-posta artık onay beklemiyor. Ne yapmalı: sayfayı yenileyin." };
  await logActivity({
    tenantId: gate.tenantId,
    actorId: gate.userId,
    action: "eids.inbound_dismissed",
    entityType: "eids_inbound_message",
    entityId: messageId,
    newValue: { note: Boolean(note) },
  });
  revalidateAll();
  return { ok: true, info: "E-posta yok sayıldı; hiçbir durum değişmedi." };
}
