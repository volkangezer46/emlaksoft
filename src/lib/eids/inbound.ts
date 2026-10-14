import type { SupabaseClient } from "@supabase/supabase-js";
import { now } from "@/lib/clock";
import { readTenantSettings } from "@/lib/settings/tenant-read";
import { EIDS_INBOUND_AUTO_APPLY_KEY } from "@/lib/settings/registry/eids-inbound";
import { verifyEmlAuth, type TxtResolver } from "./dkim";
import { classifyMailAuth, type MailAuthEvidence, type MailAuthResult } from "./mail-auth";
import {
  EIDS_SENDER,
  extractForwardConfirmation,
  forwardProviderOf,
  mailBodyToNormalizedText,
  maskGrantorName,
  maskSample,
  normalizeMailText,
  parseEidsText,
  type EidsDealKind,
} from "./mail-parse";
import { extractAddress, parseMime } from "./mime";
import {
  CONFIRM_TTL_HOURS,
  MAX_MAIL_BYTES,
  MAX_PASTE_CHARS,
  RAW_RETENTION_DAYS,
  SEMANTIC_DUP_DAYS,
  decideInbound,
  matchProperties,
  type InboundVia,
  type MatchStatus,
  type PropertyMatchRow,
} from "./inbound-policy";
import { getMailKey, grantorNameHash, maskEmailAddress, rawAad, seal, sha256Hex, toByteaHex } from "./inbound-crypto";

/**
 * EİDS e-postası YÖNLENDİRİCİSİ — tek giriş noktası (SMTP köprüsü, .eml yükleme, metin yapıştırma).
 * Sıra: gönderen kapısı → kaynak doğrulama → ayrıştırma → çift işleme (Message-ID, gövde özeti, anlamsal 7 gün) →
 * eşleştirme → politika (otomatik uygula ya da kontrol kuyruğu) → EP2 defterine tek yazma (applyAuthorityEvent).
 *
 * KVKK: Header From eids.yetki@ticaret.gov.tr olmayan e-postanın GÖVDESİ ve ham hâli YAZILMAZ (yalnız 'rejected' izi,
 * gönderen maskeli). İletme onay e-postalarından yalnız kod/bağlantı 24 saat tutulur. Ham .eml yalnız EIDS_MAIL_KEY
 * tanımlıysa şifreli ve 30 gün durur. Malik adı maskeli + özet.
 *
 * Depo erişimi `InboundStore` arayüzünden geçer: üretimde service_role istemcisiyle (`createSupabaseInboundStore`;
 * HER sorgu tenant_id ile süzülür), testte bellek içi depo. Olay yazımı `applyEvent` ile enjekte edilir (EP2 defteri).
 */

export type InboundApplyInput = {
  tenantId: string;
  propertyId: string;
  kind: "grant" | "revoke";
  source: "email_verified" | "email_unverified";
  inboundMessageId: string;
  eidsPropertyNo: string;
  dealKind: EidsDealKind;
  validUntil: string | null;
  /** Açık ad yalnız bellekte: defter maske + özet üretir, kendisi yazılmaz. Kuyruktan onayda ham yoksa null. */
  grantorName: string | null;
  /** İnsan onayında seçilen portföyde no yoksa bu no yazılsın (EP2 `bindPropertyNo`). */
  bindPropertyNo?: boolean;
  actorId: string | null;
};
export type InboundApplyResult = { ok: true; eventId: string | null } | { ok: false; error: string };
export type InboundApplier = (input: InboundApplyInput) => Promise<InboundApplyResult>;

export type InboundMessageRow = {
  id: string;
  tenant_id: string;
  received_via: InboundVia;
  message_id: string | null;
  body_sha256: string | null;
  auth_result: MailAuthResult;
  parse_kind: "grant" | "revoke" | "unknown" | "forward_confirmation" | null;
  eids_property_no: string | null;
  deal_kind: EidsDealKind | null;
  grantor_masked: string | null;
  grantor_name_hash: string | null;
  valid_until: string | null;
  match_status: MatchStatus | null;
  property_id: string | null;
  received_at: string;
};

export type InboundInsert = Omit<InboundMessageRow, "id"> & {
  address_id: string | null;
  from_addr: string | null;
  auth_detail: Record<string, unknown>;
  candidate_property_ids: string[];
  duplicate_of: string | null;
  sample_masked: string | null;
  confirm_provider: string | null;
  confirm_code: string | null;
  confirm_url: string | null;
  confirm_expires_at: string | null;
  raw_eml_encrypted: string | null;
  raw_purge_after: string | null;
  received_at: string;
  processed_at: string;
  reviewed_by: string | null;
};

export type InboundStore = {
  insertMessage(row: InboundInsert): Promise<{ ok: true; id: string } | { ok: false; conflict: boolean; error?: string }>;
  findExisting(tenantId: string, keys: { messageId: string | null; bodySha: string | null }): Promise<InboundMessageRow | null>;
  updateMessage(tenantId: string, id: string, patch: Partial<InboundInsert> & { authority_event_id?: string | null }): Promise<boolean>;
  /**
   * Anlamsal tekrar adayları: aynı taşınmaz no için pencere içindeki verme/iptal kayıtları (tekrar, ret ve yok sayılanlar
   * hariç), EN YENİDEN eskiye. Karar `pickSemanticDuplicate` ile kodda verilir (sıra + doğrulama durumu gözetilir).
   */
  findSemanticCandidates(tenantId: string, key: { propertyNo: string; sinceIso: string }): Promise<InboundMessageRow[]>;
  findPropertiesByEidsNo(tenantId: string, propertyNo: string): Promise<PropertyMatchRow[]>;
  readAutoApply(tenantId: string): Promise<boolean>;
  touchAddress(tenantId: string, addressId: string | null, atIso: string): Promise<void>;
  alertUnknownFormat(tenantId: string, messageRowId: string): Promise<void>;
};

/**
 * Anlamsal tekrar kararı (SAF). Yalnız bu no için pencere içindeki EN SON verme/iptal olayına bakılır:
 *  - En son olay karşıt türdeyse (verme → iptal → aynı bitişle yeniden verme) tekrar DEĞİLDİR.
 *  - En son olay aynı tür + aynı bitişse ve uygulanmış ya da doğrulanmışsa → 'tekrar'.
 *  - En son olay doğrulanmamış ve hâlâ bekliyorsa: gelen kopya doğrulanmışsa eski kayıt geride bırakılır
 *    ('supersede'; sahte/yapıştırılmış kaydın gerçek e-postayı "tekrar" diye gömmesi engellenir), gelen de
 *    doğrulanmamışsa 'tekrar' (kuyruk şişmez).
 */
export function pickSemanticDuplicate(
  rows: InboundMessageRow[],
  key: { kind: "grant" | "revoke"; validUntil: string | null; auth: MailAuthResult },
): { action: "none" } | { action: "duplicate"; id: string } | { action: "supersede"; id: string } {
  const latest = rows.find((r) => r.parse_kind === "grant" || r.parse_kind === "revoke");
  if (!latest || latest.parse_kind !== key.kind || (latest.valid_until ?? null) !== key.validUntil) return { action: "none" };
  const pending = latest.match_status === "queued" || latest.match_status === "candidate" || latest.match_status === "no_match";
  if (latest.auth_result === "unverified" && pending && isVerifiedResult(key.auth)) return { action: "supersede", id: latest.id };
  return { action: "duplicate", id: latest.id };
}

function isVerifiedResult(a: MailAuthResult) {
  return a === "verified" || a === "verified_via_arc";
}

export type InboundInput = {
  tenantId: string;
  addressId?: string | null;
  via: InboundVia;
  /** Ham .eml (ikili dize, `Buffer.toString("latin1")`). paste için yok. */
  raw?: string | null;
  /** Yapıştırılan metin (yalnız via=paste). */
  pasted?: string | null;
  /** SMTP alıcısının (mailauth) kanıtı; yoksa .eml için uygulama içinde DKIM/ARC doğrulanır. */
  evidence?: MailAuthEvidence | null;
  /** SMTP oturumu Bakanlık sunucusundan mı (iletilmemiş)? Yalnız SPF+DMARC kuralı için. */
  direct?: boolean;
  actorId?: string | null;
  /** Yalnız test: DKIM anahtar çözücüsü (üretimde sistem DNS'i). */
  resolver?: TxtResolver;
};

export type InboundOutcome =
  | "applied"
  | "queued"
  | "candidate"
  | "no_match"
  | "duplicate"
  | "rejected"
  | "unknown_format"
  | "forward_confirmation";

export type InboundResult =
  | { ok: true; outcome: InboundOutcome; id: string | null; auth: MailAuthResult; applyError?: string }
  | { ok: false; error: string };

const MESSAGE_ID_MAX = 300;

function cleanMessageId(v: string | null): string | null {
  const s = (v ?? "").trim();
  return s ? s.slice(0, MESSAGE_ID_MAX) : null;
}

function isoPlusHours(nowMs: number, h: number) {
  return new Date(nowMs + h * 3_600_000).toISOString();
}

export async function processInboundMail(store: InboundStore, applyEvent: InboundApplier, input: InboundInput): Promise<InboundResult> {
  const nowMs = now();
  const nowIso = new Date(nowMs).toISOString();
  const via = input.via;
  const raw = via === "paste" ? null : (input.raw ?? null);
  if (via !== "paste" && !raw) return { ok: false, error: "E-posta içeriği boş; e-postayı .eml olarak yeniden indirip yükleyin." };
  if (raw && raw.length > MAX_MAIL_BYTES) return { ok: false, error: "E-posta 256 KB sınırını aşıyor; ekleri olmadan yeniden iletin ya da metni yapıştırın." };
  if (via === "paste" && (input.pasted ?? "").length > MAX_PASTE_CHARS) return { ok: false, error: "Yapıştırılan metin çok uzun (en çok 20.000 karakter)." };

  const mime = raw ? parseMime(raw) : null;
  const fromHeaders = mime ? mime.headers.filter((h) => h.name.toLowerCase() === "from") : [];
  const fromAddr = mime ? extractAddress(mime.get("from")) : null;
  const messageId = mime ? cleanMessageId(mime.get("message-id")) : null;

  const base = {
    tenant_id: input.tenantId,
    address_id: input.addressId ?? null,
    received_via: via,
    message_id: messageId,
    candidate_property_ids: [] as string[],
    duplicate_of: null,
    sample_masked: null,
    confirm_provider: null,
    confirm_code: null,
    confirm_url: null,
    confirm_expires_at: null,
    raw_eml_encrypted: null,
    raw_purge_after: null,
    received_at: nowIso,
    processed_at: nowIso,
    reviewed_by: null,
    eids_property_no: null,
    deal_kind: null,
    grantor_masked: null,
    grantor_name_hash: null,
    valid_until: null,
    property_id: null,
  } satisfies Partial<InboundInsert>;

  // 1) Gönderen kapısı (yalnız ham e-posta; yapıştırmada başlık yok, her zaman doğrulanmamış sayılır).
  if (mime && (fromHeaders.length !== 1 || fromAddr !== EIDS_SENDER)) {
    const fwd = via === "smtp" || via === "resend" ? forwardProviderOf(fromAddr) : null;
    const ev = fwd ? (input.evidence ?? (await verifyEmlAuth(raw!, input.resolver))) : null;
    const signedByProvider = Boolean(fwd && ev?.dkim.some((d) => d.result === "pass" && fwd.domains.some((dom) => d.domain === dom || d.domain.endsWith(`.${dom}`))));
    if (fwd && signedByProvider && fromHeaders.length === 1) {
      const text = normalizeMailText(mime.html ? mime.html.replace(/<[^>]+>/g, " ") : (mime.text ?? ""));
      const c = extractForwardConfirmation(fwd.provider, mime.get("subject"), `${text} ${mime.html ?? ""}`);
      const ins = await store.insertMessage({
        ...base,
        from_addr: fromAddr,
        body_sha256: null,
        auth_result: "verified",
        auth_detail: { reason: `iletme onayı (${fwd.provider})` },
        parse_kind: "forward_confirmation",
        match_status: null,
        confirm_provider: c.provider,
        confirm_code: c.code,
        confirm_url: c.url,
        confirm_expires_at: isoPlusHours(nowMs, CONFIRM_TTL_HOURS),
      });
      if (!ins.ok && !ins.conflict) return { ok: false, error: ins.error ?? "E-posta kaydı yazılamadı: bağlantı sorunu olabilir; birkaç saniye sonra tekrar deneyin." };
      await store.touchAddress(input.tenantId, input.addressId ?? null, nowIso);
      return { ok: true, outcome: ins.ok ? "forward_confirmation" : "duplicate", id: ins.ok ? ins.id : null, auth: "verified" };
    }
    // Başka gönderici: gövde/ham YAZILMAZ; yalnız maskeli iz.
    const ins = await store.insertMessage({
      ...base,
      from_addr: maskEmailAddress(fromAddr),
      body_sha256: null,
      auth_result: "rejected",
      auth_detail: { reason: fromHeaders.length !== 1 ? "from_count" : fwd ? "forward_unsigned" : "sender_not_eids" },
      parse_kind: null,
      match_status: "rejected",
    });
    if (!ins.ok && !ins.conflict) return { ok: false, error: ins.error ?? "E-posta kaydı yazılamadı: bağlantı sorunu olabilir; birkaç saniye sonra tekrar deneyin." };
    return { ok: true, outcome: "rejected", id: ins.ok ? ins.id : null, auth: "rejected" };
  }

  // 2) Kaynak doğrulama.
  let auth: MailAuthResult = "unverified";
  let authDetail: Record<string, unknown> = { reason: "yapıştırılmış metin (kaynak doğrulanamaz)" };
  if (raw) {
    const ev = input.evidence ?? (await verifyEmlAuth(raw, input.resolver));
    const c = classifyMailAuth(ev, { direct: via === "smtp" && input.direct === true });
    auth = c.result;
    authDetail = { reason: c.reason, dkim: ev.dkim.slice(0, 5), arc: ev.arc ? { result: ev.arc.result, sealers: ev.arc.sets.map((s) => s.sealer) } : null, spf: ev.spf?.result ?? null };
  }

  // 3) Ayrıştırma + gövde özeti (normalleştirilmiş metin; yasal uyarı hariç).
  const normalized = mime ? mailBodyToNormalizedText({ html: mime.html, text: mime.text }) : mailBodyToNormalizedText({ text: input.pasted ?? "" });
  if (!normalized) return { ok: false, error: "E-postada okunabilir metin bulunamadı; Bakanlık e-postasının kendisini (iletilmiş değil) .eml olarak yükleyin ya da metni yapıştırın." };
  const bodySha = sha256Hex(normalized);
  const parsed = parseEidsText(normalized);

  const key = raw ? getMailKey() : null;
  const sealedRaw = raw && key ? toByteaHex(seal(Buffer.from(raw, "latin1"), key, rawAad(input.tenantId))) : null;
  const rawCols = { raw_eml_encrypted: sealedRaw, raw_purge_after: sealedRaw ? new Date(nowMs + RAW_RETENTION_DAYS * 86_400_000).toISOString() : null };

  if (parsed.kind === "unknown") {
    const ins = await store.insertMessage({
      ...base,
      ...rawCols,
      from_addr: fromAddr,
      body_sha256: bodySha,
      auth_result: auth,
      auth_detail: { ...authDetail, parse: parsed.reason },
      parse_kind: "unknown",
      match_status: null,
      sample_masked: maskSample(normalized),
    });
    if (!ins.ok) return ins.conflict ? { ok: true, outcome: "duplicate", id: null, auth } : { ok: false, error: ins.error ?? "E-posta kaydı yazılamadı: bağlantı sorunu olabilir; birkaç saniye sonra tekrar deneyin." };
    await store.touchAddress(input.tenantId, input.addressId ?? null, nowIso);
    await store.alertUnknownFormat(input.tenantId, ins.id);
    return { ok: true, outcome: "unknown_format", id: ins.id, auth };
  }

  const fields = {
    parse_kind: parsed.kind,
    eids_property_no: parsed.propertyNo,
    deal_kind: parsed.dealKind,
    grantor_masked: maskGrantorName(parsed.grantorName),
    grantor_name_hash: grantorNameHash(parsed.grantorName),
    valid_until: parsed.validUntil,
  } as const;

  // 4a) (a)/(b) Aynı Message-ID ya da gövde özeti zaten var: tekrar. İSTİSNA: doğrulanmamış eski kopya hâlâ
  // bekliyorsa ve bu kopya doğrulanmışsa eski kayıt YÜKSELTİLİR (sahte kopyanın gerçek e-postayı "tekrar" diye
  // gömmesi engellenir). Eşzamanlı yarışta tekil dizin (23505) yine "tekrar" döndürür.
  const sinceIso = new Date(nowMs - SEMANTIC_DUP_DAYS * 86_400_000).toISOString();
  let candidates: InboundMessageRow[] | null = null;
  let existing = await store.findExisting(input.tenantId, { messageId, bodySha });
  // Yalnız gövde özeti tuttu (farklı Message-ID) ama bu no için en son olay karşıt türdeyse (verme → iptal → aynı
  // metinle yeniden verme) bu yeni bir olaydır: eski kayıt tekrar sayılmaz; gövde özeti tekil dizine takılmasın diye
  // yeni kayda yazılmaz (anlamsal denetim yine çalışır).
  // Ara olay, eski kayıt ne kadar eskide kalırsa kalsın aranır (7 günlük pencereyle sınırlı değil).
  let staleBody = false;
  if (existing && (!messageId || existing.message_id !== messageId)) {
    const since = existing.received_at && existing.received_at < sinceIso ? existing.received_at : sinceIso;
    const all = await store.findSemanticCandidates(input.tenantId, { propertyNo: parsed.propertyNo, sinceIso: since });
    const latest = all.find((r) => r.parse_kind === "grant" || r.parse_kind === "revoke");
    if (latest && latest.parse_kind !== parsed.kind && latest.id !== existing.id) {
      staleBody = true;
      existing = null;
    }
    candidates = all.filter((r) => r.received_at >= sinceIso);
  }
  const upgradable =
    existing !== null &&
    existing.auth_result === "unverified" &&
    (auth === "verified" || auth === "verified_via_arc") &&
    (existing.match_status === "queued" || existing.match_status === "candidate" || existing.match_status === "no_match");
  if (existing && !upgradable) return { ok: true, outcome: "duplicate", id: existing.id, auth };

  // 4b) (c) Anlamsal tekrar: aynı no + tür + bitiş 7 gün içinde → yeni olay yok, yalnız 'tekrar' kaydı
  // (sıra ve doğrulama durumu gözetilir; bkz. pickSemanticDuplicate).
  const sem = existing
    ? ({ action: "none" } as const)
    : pickSemanticDuplicate(
        candidates ?? (await store.findSemanticCandidates(input.tenantId, { propertyNo: parsed.propertyNo, sinceIso })),
        { kind: parsed.kind, validUntil: parsed.validUntil, auth },
      );
  const dupOf = sem.action === "duplicate" ? sem.id : null;

  // 5) Eşleştirme + politika.
  const props = dupOf ? [] : await store.findPropertiesByEidsNo(input.tenantId, parsed.propertyNo);
  const match = matchProperties(props, parsed.dealKind);
  const autoApply = dupOf ? false : await store.readAutoApply(input.tenantId);
  const decision = decideInbound({ auth, via, match, autoApply });

  const row: InboundInsert = {
    ...base,
    ...rawCols,
    ...fields,
    from_addr: fromAddr,
    body_sha256: staleBody ? null : bodySha,
    auth_result: auth,
    auth_detail: authDetail,
    match_status: dupOf ? "duplicate" : decision.action === "apply" ? "queued" : decision.status,
    duplicate_of: dupOf,
    property_id: match.kind === "exact" ? match.propertyId : null,
    candidate_property_ids: match.kind === "candidate" ? match.propertyIds : [],
  };

  let id: string;
  if (existing) {
    id = existing.id;
    // Yükseltmede ayrıştırılmış alanlar ve gövde özeti de doğrulanmış kopyadan yazılır: eski kayıt aynı Message-ID ile
    // değiştirilmiş bir .eml'den geldiyse satırda sahte no/bitiş/yetki veren kalmasın (defter bu değerlerle uygulanır).
    const patch = {
      ...fields,
      from_addr: fromAddr,
      body_sha256: bodySha,
      auth_result: auth,
      auth_detail: { ...authDetail, upgraded_from: existing.received_via, ...(existing.body_sha256 !== bodySha ? { body_replaced: true } : {}) },
      received_via: via,
      ...rawCols,
      match_status: row.match_status,
      property_id: row.property_id,
      candidate_property_ids: row.candidate_property_ids,
    };
    let ok = await store.updateMessage(input.tenantId, id, patch);
    // Gövde özeti başka bir kayıtta zaten varsa (tekil dizin) özet boş bırakılır; Message-ID tekrarı yine yakalar.
    if (!ok && existing.body_sha256 !== bodySha) ok = await store.updateMessage(input.tenantId, id, { ...patch, body_sha256: null });
    if (!ok) return { ok: false, error: "E-posta kaydı güncellenemedi: bağlantı sorunu olabilir; birkaç saniye sonra tekrar deneyin." };
  } else {
    const ins = await store.insertMessage(row);
    if (!ins.ok) return ins.conflict ? { ok: true, outcome: "duplicate", id: null, auth } : { ok: false, error: ins.error ?? "E-posta kaydı yazılamadı: bağlantı sorunu olabilir; birkaç saniye sonra tekrar deneyin." };
    id = ins.id;
    // Doğrulanmış kopya geldi: bekleyen doğrulanmamış eski kayıt 'tekrar' olarak bu kayda bağlanır (kuyruktan düşer).
    if (sem.action === "supersede") {
      await store.updateMessage(input.tenantId, sem.id, { match_status: "duplicate", duplicate_of: id, auth_detail: { reason: "doğrulanmış kopya geldi", superseded_by: id } });
    }
  }
  await store.touchAddress(input.tenantId, input.addressId ?? null, nowIso);

  if (dupOf) return { ok: true, outcome: "duplicate", id, auth };
  if (decision.action !== "apply") return { ok: true, outcome: decision.status, id, auth };

  // 6) Otomatik uygulama (tek yazma noktası: EP2 applyAuthorityEvent). Hata olursa kayıt kuyrukta kalır.
  const applied = await applyEvent({
    tenantId: input.tenantId,
    propertyId: decision.propertyId,
    kind: parsed.kind,
    source: "email_verified",
    inboundMessageId: id,
    eidsPropertyNo: parsed.propertyNo,
    dealKind: parsed.dealKind,
    validUntil: parsed.validUntil,
    grantorName: parsed.grantorName,
    actorId: input.actorId ?? null,
  });
  if (!applied.ok) {
    await store.updateMessage(input.tenantId, id, { auth_detail: { ...authDetail, apply_error: applied.error.slice(0, 200) } });
    return { ok: true, outcome: "queued", id, auth, applyError: applied.error };
  }
  await store.updateMessage(input.tenantId, id, { match_status: "applied", property_id: decision.propertyId, authority_event_id: applied.eventId });
  return { ok: true, outcome: "applied", id, auth };
}

// ---------------------------------------------------------------------------------------------------------------
// Supabase deposu (service_role; HER sorgu tenant_id ile süzülür — RLS atlandığından izolasyon bu filtreye dayanır).

const ROW_COLUMNS =
  "id, tenant_id, received_via, message_id, body_sha256, auth_result, parse_kind, eids_property_no, deal_kind, grantor_masked, grantor_name_hash, valid_until, match_status, property_id, received_at";

export function createSupabaseInboundStore(
  db: SupabaseClient,
  opts: { onUnknownFormat?: (tenantId: string, rowId: string) => Promise<void> } = {},
): InboundStore {
  return {
    async insertMessage(row) {
      const { data, error } = await db.from("eids_inbound_messages").insert(row).select("id").single();
      if (error) return { ok: false, conflict: error.code === "23505", error: error.code === "23505" ? undefined : "E-posta kaydı yazılamadı: tablo henüz kurulmamış ya da bağlantı sorunu olabilir; birkaç dakika sonra tekrar deneyin." };
      return { ok: true, id: (data as { id: string }).id };
    },
    async findExisting(tenantId, keys) {
      for (const [col, val] of [
        ["message_id", keys.messageId],
        ["body_sha256", keys.bodySha],
      ] as const) {
        if (!val) continue;
        const { data } = await db.from("eids_inbound_messages").select(ROW_COLUMNS).eq("tenant_id", tenantId).eq(col, val).limit(1).maybeSingle();
        if (data) return data as InboundMessageRow;
      }
      return null;
    },
    async updateMessage(tenantId, id, patch) {
      const { error } = await db.from("eids_inbound_messages").update(patch).eq("tenant_id", tenantId).eq("id", id);
      return !error;
    },
    async findSemanticCandidates(tenantId, key) {
      const { data } = await db
        .from("eids_inbound_messages")
        .select(ROW_COLUMNS)
        .eq("tenant_id", tenantId)
        .eq("eids_property_no", key.propertyNo)
        .in("parse_kind", ["grant", "revoke"])
        .gte("received_at", key.sinceIso)
        .not("match_status", "in", "(duplicate,rejected,dismissed)")
        .order("received_at", { ascending: false })
        .limit(20);
      return (data ?? []) as InboundMessageRow[];
    },
    async findPropertiesByEidsNo(tenantId, propertyNo) {
      const { data } = await db
        .from("properties")
        .select("id, transaction_type")
        .eq("tenant_id", tenantId)
        .eq("eids_property_no", propertyNo)
        .is("deleted_at", null)
        .limit(10);
      return (data ?? []) as PropertyMatchRow[];
    },
    async readAutoApply(tenantId) {
      const v = await readTenantSettings(db, tenantId, [EIDS_INBOUND_AUTO_APPLY_KEY]);
      return v[EIDS_INBOUND_AUTO_APPLY_KEY] !== false;
    },
    async touchAddress(tenantId, addressId, atIso) {
      if (!addressId) return;
      await db.from("eids_inbound_addresses").update({ last_received_at: atIso }).eq("tenant_id", tenantId).eq("id", addressId);
    },
    async alertUnknownFormat(tenantId, rowId) {
      await opts.onUnknownFormat?.(tenantId, rowId);
    },
  };
}

/** Bilinmeyen biçim: platform hata triyajına tek satır (Admin > Operasyon); örnek maskeli olarak kayıtta durur. */
export async function reportUnknownFormat(tenantId: string, rowId: string): Promise<void> {
  const { logError } = await import("@/lib/error-log");
  await logError({
    source: "server",
    message: "EİDS e-postası tanınmayan biçimde (unknown_format): Bakanlık şablonu değişmiş olabilir",
    path: "/api/inbound/eids",
    tenantId,
    digest: `eids-unknown:${rowId}`.slice(0, 160),
  });
}
