import "server-only";
import { createHash } from "node:crypto";
import type { SupabaseClient } from "@supabase/supabase-js";
import { now } from "@/lib/clock";
import { isMissingSchema } from "@/lib/listing-control/server/db";
import { authorityPublishBlock, AUTHORITY_OVERRIDE_TTL_HOURS } from "@/lib/authority-shield";
import { authorityPublishWarning, isEidsExemptReason, isEidsSource, isEidsVerifyStatus, type EidsExemptReason, type EidsSource, type EidsVerifyStatus } from "./authority-status";
import { canonicalGrantorName, maskGrantorName, type EidsDealKind, type EidsMatchFacts } from "./match";
import { parseEidsPropertyNo } from "./property-no";
import { activeOverride, findAuthorityMatch, loadAuthorityEvents, type AuthorityMatchLoad } from "./load";

/**
 * EİDS YETKİ DEFTERİ — TEK YAZMA NOKTASI (EP2). Portföyün yetki durumu yalnız buradan değişir; EP3 (Bakanlık e-postası
 * alıcısı) ve EP4 (aksiyon motoru / cron) YALNIZ `applyAuthorityEvent` ve `undoAuthorityEvent` çağırır.
 *
 * Yazma `eids_apply_authority_event` / `eids_undo_authority_event` RPC'leriyle (20261013007100) yapılır: SECURITY INVOKER,
 * portföy satırı kilitlenir, durum + olay aynı işlemde yazılır, olay tablosu yalnız eklenir. Oturumlu istemcide RLS ve
 * danışman kapsamı geçerlidir (kiracı = JWT, aktör = auth.uid()); service_role çağrısında (EP3/EP4) kiracı parametredir.
 * Malik adı AÇIK SAKLANMAZ: maskeli biçim + Türkçe katlamalı adın sha256 özeti yazılır.
 */

export type AuthorityEventKind = "grant" | "revoke" | "extend" | "expire" | "manual_set" | "link" | "override";
export type AuthorityEventSource = EidsSource | "system";

export type ApplyAuthorityEventInput = {
  tenantId: string;
  /** null = eşleşmeyen bildirim kaydı (yalnız iz düşülür; override/link/manual_set için geçersiz). */
  propertyId: string | null;
  kind: AuthorityEventKind;
  source: AuthorityEventSource;
  /** Yeni durum; verilmezse durum değişmez (ör. yalnız bağlama ya da override). */
  newStatus?: EidsVerifyStatus | null;
  /** YYYY-MM-DD; `setValidUntil` true ise portföyün `authorization_end` değeri de buna yazılır. */
  validUntil?: string | null;
  setValidUntil?: boolean;
  eidsPropertyNo?: string | null;
  /** true: portföyde no yoksa bu no yazılır (aday bağlama). Farklı no varsa `no_conflict` döner, hiçbir şey yazılmaz. */
  bindPropertyNo?: boolean;
  dealKind?: EidsDealKind | null;
  /** Açık ad: yalnız maske + özet üretmek için kullanılır, kendisi yazılmaz. */
  grantorName?: string | null;
  inboundMessageId?: string | null;
  /** undefined = dokunma; null = istisnayı kaldır. */
  exemptReason?: EidsExemptReason | null;
  /** Teyit edildi (doğrulanmış e-posta / belge / portal kontrolü): authority_eids_verified_at = şimdi. */
  verified?: boolean;
  /** Bakanlık e-postası görüldü: authority_last_email_at = şimdi. */
  emailSeen?: boolean;
  note?: string | null;
  evidenceMediaId?: string | null;
  /** Yalnız service_role çağrısında anlamlı (oturumlu çağrıda aktör daima auth.uid()). */
  actorId?: string | null;
};

export type LedgerErrorCode =
  | "schema_pending"
  | "invalid_input"
  | "forbidden"
  | "not_found"
  | "owner_only"
  | "note_required"
  | "no_conflict"
  | "not_undoable"
  | "already_undone"
  | "superseded"
  | "failed";

export type LedgerResult =
  | { ok: true; eventId: string; prevStatus: string | null; newStatus: string | null; logged?: boolean }
  | { ok: false; code: LedgerErrorCode; error: string };

/** Kullanıcıya "ne oldu, ne yapmalı" biçiminde hata metinleri. */
export const LEDGER_ERRORS: Record<LedgerErrorCode, string> = {
  schema_pending: "Ne oldu: yetki defteri henüz kurulmadı. Ne yapmalı: sistem güncellemesi tamamlanınca tekrar deneyin.",
  invalid_input: "Ne oldu: gönderilen yetki bilgisi geçersiz. Ne yapmalı: durum, kaynak ve tarihleri kontrol edip tekrar kaydedin.",
  forbidden: "Ne oldu: bu portföyün yetki durumunu değiştirme izniniz yok. Ne yapmalı: ofis yöneticinizden İlan Kontrol düzenleme izni isteyin.",
  not_found: "Ne oldu: portföy bulunamadı ya da size açık değil. Ne yapmalı: sayfayı yenileyip portföyün silinmediğini kontrol edin.",
  owner_only: "Ne oldu: yayın engelini yalnız ofis sahibi aşabilir. Ne yapmalı: ofis sahibinden izni vermesini isteyin.",
  note_required: "Ne oldu: gerekçe çok kısa. Ne yapmalı: engeli neden aştığınızı en az 10 karakterle yazın.",
  no_conflict: "Ne oldu: bu portföyde başka bir taşınmaz no kayıtlı. Ne yapmalı: doğru portföyü seçin ya da önce portföydeki numarayı düzeltin.",
  not_undoable: "Ne oldu: bu kayıt geri alınamaz (geri alma ve yayın izni kayıtları geri alınmaz). Ne yapmalı: durumu karttan yeniden işaretleyin.",
  already_undone: "Ne oldu: bu işlem zaten geri alınmış. Ne yapmalı: sayfayı yenileyin.",
  superseded: "Ne oldu: bu işlemden sonra başka bir yetki değişikliği yapılmış. Ne yapmalı: önce en son işlemi geri alın ya da durumu karttan yeniden işaretleyin.",
  failed: "Ne oldu: yetki durumu kaydedilemedi. Ne yapmalı: birkaç saniye sonra tekrar deneyin; sürerse destek ekibine bildirin.",
};

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

/** Malik adının kararlı özeti (eşleştirme/dedupe için; açık ad saklanmaz). */
export function hashGrantorName(name: string | null | undefined): string | null {
  const canon = canonicalGrantorName(name);
  return canon ? createHash("sha256").update(canon, "utf8").digest("hex") : null;
}

function fail(code: LedgerErrorCode): LedgerResult {
  return { ok: false, code, error: LEDGER_ERRORS[code] };
}

function mapOutcome(data: unknown): LedgerResult {
  const r = (data ?? {}) as { outcome?: string; event_id?: string; prev_status?: string | null; new_status?: string | null };
  if ((r.outcome === "applied" || r.outcome === "logged") && r.event_id) {
    return { ok: true, eventId: r.event_id, prevStatus: r.prev_status ?? null, newStatus: r.new_status ?? null, logged: r.outcome === "logged" };
  }
  const code = String(r.outcome ?? "failed") as LedgerErrorCode;
  return fail(code in LEDGER_ERRORS ? code : "failed");
}

/**
 * Yetki olayını uygular: portföy durumunu günceller ve olayı deftere ekler (atomik). Girdi burada da doğrulanır
 * (RPC aynı denetimi tekrarlar). Migration uygulanmamışsa `schema_pending` döner — çağıran eski yola düşebilir.
 */
export async function applyAuthorityEvent(db: SupabaseClient, input: ApplyAuthorityEventInput): Promise<LedgerResult> {
  if (!input.tenantId) return fail("invalid_input");
  if (input.newStatus != null && !isEidsVerifyStatus(input.newStatus)) return fail("invalid_input");
  if (input.source !== "system" && !isEidsSource(input.source)) return fail("invalid_input");
  if (input.exemptReason != null && !isEidsExemptReason(input.exemptReason)) return fail("invalid_input");
  if (input.validUntil && !DATE_RE.test(input.validUntil)) return fail("invalid_input");
  let no: string | null = null;
  if (input.eidsPropertyNo) {
    const parsed = parseEidsPropertyNo(input.eidsPropertyNo);
    if (!parsed.ok) return fail("invalid_input");
    no = parsed.value;
  }
  const note = (input.note ?? "").trim().slice(0, 1000) || null;
  const event: Record<string, unknown> = {
    kind: input.kind,
    source: input.source,
    new_status: input.newStatus ?? null,
    valid_until: input.validUntil ?? null,
    set_valid_until: Boolean(input.setValidUntil && input.validUntil),
    eids_property_no: no,
    bind_property_no: Boolean(input.bindPropertyNo),
    deal_kind: input.dealKind ?? null,
    grantor_masked: maskGrantorName(input.grantorName),
    grantor_name_hash: hashGrantorName(input.grantorName),
    inbound_message_id: input.inboundMessageId ?? null,
    verified: Boolean(input.verified),
    email_seen: Boolean(input.emailSeen),
    note,
    evidence_media_id: input.evidenceMediaId ?? null,
    actor_id: input.actorId ?? null,
  };
  if (input.exemptReason !== undefined) event.exempt_reason = input.exemptReason;

  const { data, error } = await db.rpc("eids_apply_authority_event", {
    p_tenant_id: input.tenantId,
    p_property_id: input.propertyId,
    p_event: event,
  });
  if (error) {
    if (isMissingSchema(error)) return fail("schema_pending");
    console.error("applyAuthorityEvent", { code: error.code });
    return fail("failed");
  }
  return mapOutcome(data);
}

/** Bir olayı geri alır: portföy olay öncesi anlık görüntüye döner, geri alma da ayrı bir olay olarak yazılır. */
export async function undoAuthorityEvent(db: SupabaseClient, tenantId: string, eventId: string, note?: string | null): Promise<LedgerResult> {
  const { data, error } = await db.rpc("eids_undo_authority_event", {
    p_tenant_id: tenantId,
    p_event_id: eventId,
    p_note: (note ?? "").trim().slice(0, 1000) || null,
  });
  if (error) {
    if (isMissingSchema(error)) return fail("schema_pending");
    console.error("undoAuthorityEvent", { code: error.code });
    return fail("failed");
  }
  return mapOutcome(data);
}

export type MatchedApplyResult =
  | { applied: true; propertyId: string; ledger: LedgerResult; match: AuthorityMatchLoad }
  | { applied: false; match: AuthorityMatchLoad };

/**
 * Bildirimi eşleştirip uygular (EP3 için): YALNIZ taşınmaz no ile birebir (tek portföy ya da türle ayrışan tek portföy)
 * eşleşmede olay o portföye yazılır. Belirsiz/eşleşmeyen durumda HİÇBİR portföye yazılmaz; aday listesi (en çok 5) döner.
 */
export async function applyMatchedAuthorityEvent(
  db: SupabaseClient,
  input: Omit<ApplyAuthorityEventInput, "propertyId" | "eidsPropertyNo" | "dealKind" | "grantorName" | "validUntil"> & { facts: EidsMatchFacts },
): Promise<MatchedApplyResult> {
  const match = await findAuthorityMatch(db, input.tenantId, input.facts);
  if (!match.ok || match.result.kind !== "exact") return { applied: false, match };
  const { facts, ...rest } = input;
  const ledger = await applyAuthorityEvent(db, {
    ...rest,
    propertyId: match.result.propertyId,
    eidsPropertyNo: facts.propertyNo ?? null,
    dealKind: facts.dealKind ?? null,
    grantorName: facts.grantorName ?? null,
    validUntil: facts.validUntil ?? null,
  });
  return { applied: true, propertyId: match.result.propertyId, ledger, match };
}

export type PublishGate = { blocked: false; warning?: string } | { blocked: true; error: string; code: "revoked" | "expired" };

/**
 * Yayın / portal aktarımı kapısı. Yetkisi iptal edilmiş ya da süresi dolmuş portföy ENGELLENİR; yalnız ofis sahibinin
 * son durum değişikliğinden sonra verdiği ve 24 saati geçmemiş gerekçeli izni (override olayı) engeli kaldırır.
 * Defter sütunları yoksa (migration uygulanmamış) engel UYGULANMAZ, yalnız eski uyarı döner (izin verilemeyen engel olmasın).
 */
export async function authorityPublishGate(db: SupabaseClient, tenantId: string, propertyId: string): Promise<PublishGate> {
  const nowMs = now();
  const full = await db
    .from("properties")
    .select("authorization_start, authorization_end, authority_eids_status, eids_exempt_reason")
    .eq("id", propertyId)
    .eq("tenant_id", tenantId)
    .maybeSingle();
  if (full.error) {
    if (!isMissingSchema(full.error)) return { blocked: false };
    const legacy = await db
      .from("properties")
      .select("authorization_start, authorization_end, authority_eids_status")
      .eq("id", propertyId)
      .eq("tenant_id", tenantId)
      .maybeSingle();
    const row = legacy.data as { authorization_start?: string | null; authorization_end?: string | null; authority_eids_status?: string | null } | null;
    if (!row) return { blocked: false };
    const warning = authorityPublishWarning(
      { authorization_start: row.authorization_start ?? null, authorization_end: row.authorization_end ?? null, authority_eids_status: row.authority_eids_status ?? null },
      nowMs,
    );
    return warning ? { blocked: false, warning } : { blocked: false };
  }
  const row = full.data as { authorization_start: string | null; authorization_end: string | null; authority_eids_status: string | null; eids_exempt_reason: string | null } | null;
  if (!row) return { blocked: false };
  const block = authorityPublishBlock(row, nowMs);
  if (block) {
    const events = await loadAuthorityEvents(db, tenantId, propertyId, 10);
    const override = events.available ? activeOverride(events.events, nowMs, AUTHORITY_OVERRIDE_TTL_HOURS) : null;
    if (!override) return { blocked: true, error: block.message, code: block.code };
    return { blocked: false, warning: "Uyarı: yetki iptal/dolmuş durumda; ofis sahibinin gerekçeli geçici izniyle yayınlanıyor." };
  }
  const warning = authorityPublishWarning(row, nowMs);
  return warning ? { blocked: false, warning } : { blocked: false };
}
