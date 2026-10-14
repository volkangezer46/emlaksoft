import { createHash, randomBytes, randomInt, randomUUID } from "node:crypto";
import type { SupabaseClient } from "@supabase/supabase-js";
import { DAY_MS, trDayStartMs } from "@/lib/clock";
import { isValidEmail, normalizeEmail } from "@/lib/email";
import { hashOtpForStorage, verifyOtpHash } from "@/lib/otp-hmac";
import { parsePhoneStrict } from "@/lib/phone-rules";
import {
  DETAILS_MAX,
  DETAILS_MIN,
  PLATFORM_KVKK_OPEN_STATUSES,
  PLATFORM_KVKK_QUEUE_STATUSES,
  PLATFORM_KVKK_STATUS_LABELS,
  PLATFORM_KVKK_TYPE_LABELS,
  PLATFORM_KVKK_WARN_DAYS,
  RESPONSE_MAX,
  RESPONSE_MIN,
  UNVERIFIED_RETENTION_DAYS,
  VERIFY_CODE_TTL_MINUTES,
  VERIFY_MAX_ATTEMPTS,
  VERIFY_MAX_SENDS,
  buildKvkkRef,
  buildPackageRows,
  erasureBlocker,
  identityBlocker,
  isIdentityMethod,
  isPlatformKvkkType,
  packageBlocker,
  platformKvkkDaysLeft,
  platformKvkkDueIso,
  platformKvkkTone,
  respondBlocker,
  summarizeRecords,
  type IdentityMethod,
  type PackageRow,
  type PackageSummary,
  type PlatformKvkkOutcome,
  type PlatformKvkkType,
  type SubjectCustomer,
  type SubjectRecords,
  type SubjectSimple,
} from "./platform-kvkk";
import type { KvkkTone } from "./kvkk-queue";

/**
 * PLATFORM KVKK BAŞVURULARI — SUNUCU servisi (DG6). Tüm işlevler service_role istemcisini PARAMETRE alır (istemciyi
 * kapılı çağıran eylem/sayfa/cron verir; `createAdminClient` kabul listesi çağıranda gerekçelidir) ve e-posta
 * gönderimini bağımlılık olarak alır (AD7 `sendTemplateEmail`; testte sahte). Kişisel veri: e-posta yanıt için düz,
 * eşleşme/tekrar freni SHA-256 özetiyle; doğrulama kodu yalnız HMAC özeti (otp-hmac, amaç `kvkk-request`).
 * Denetim izi (platform_audit_logs) eylem katmanında yazılır; bu dosya iş kuralını ve DB yazımını taşır.
 */

type Db = SupabaseClient;
export type PlatformKvkkSend = (input: {
  key: "kvkk_verify" | "kvkk_reply";
  to: string;
  vars: Record<string, string | number>;
  source: string;
  actorId?: string | null;
}) => Promise<{ ok: boolean; code?: string; error?: string }>;

export const PLATFORM_KVKK_TABLE = "platform_kvkk_requests";
const SOURCE = "kvkk_basvuru";
const MISSING = (e: { code?: string; message?: string } | null | undefined) =>
  Boolean(e && (e.code === "42P01" || e.code === "PGRST205" || /platform_kvkk_requests/.test(e.message ?? "")));

export type PlatformKvkkRow = {
  id: string;
  ref: string;
  request_type: PlatformKvkkType;
  status: string;
  requester_name: string;
  email: string;
  email_hash: string;
  phone: string | null;
  office_hint: string | null;
  details: string;
  verify_code_hash: string | null;
  verify_expires_at: string | null;
  verify_attempts: number;
  verify_sent_count: number;
  email_verified_at: string | null;
  due_at: string | null;
  identity_status: string;
  identity_method: string | null;
  identity_note: string | null;
  identity_checked_at: string | null;
  identity_checked_by: string | null;
  assignee_id: string | null;
  package_prepared_at: string | null;
  package_prepared_by: string | null;
  package_summary: PackageSummary | null;
  erasure_applied_at: string | null;
  erasure_applied_by: string | null;
  erasure_result: ErasureResult | null;
  response_text: string | null;
  response_sent_at: string | null;
  response_delivery: string | null;
  resolved_at: string | null;
  resolved_by: string | null;
  created_at: string;
  updated_at: string;
};

export type Fail = { ok: false; error: string };
const fail = (error: string): Fail => ({ ok: false, error });

export function hashEmail(email: string): string {
  return createHash("sha256").update(normalizeEmail(email), "utf8").digest("hex");
}

export function maskEmailForDisplay(email: string): string {
  const e = normalizeEmail(email);
  const at = e.lastIndexOf("@");
  if (at <= 0) return "***";
  const local = e.slice(0, at);
  return `${local.slice(0, local.length <= 2 ? 1 : 2)}***${e.slice(at)}`;
}

const iso = (ms: number) => new Date(ms).toISOString();
const trDate = (s: string) => new Intl.DateTimeFormat("tr-TR", { dateStyle: "long", timeZone: "Europe/Istanbul" }).format(new Date(s));
const sixDigit = () => String(randomInt(0, 1_000_000)).padStart(6, "0");

// ---------------------------------------------------------------------------------------------------------------------
// 1) Başvuru (herkese açık) + 2) e-posta doğrulaması
// ---------------------------------------------------------------------------------------------------------------------

export type ApplicationInput = {
  type: unknown;
  name: unknown;
  email: unknown;
  phone: unknown;
  officeHint: unknown;
  details: unknown;
  consent: boolean;
};

export type ParsedApplication = {
  type: PlatformKvkkType;
  name: string;
  email: string;
  phone: string | null;
  officeHint: string | null;
  details: string;
};

const str = (v: unknown) => (typeof v === "string" ? v.trim() : "");

/** Form doğrulaması (telefon isteğe bağlı; girildiyse `parsePhoneStrict` saklama biçimi yazılır). */
export function parseApplication(input: ApplicationInput): { ok: true; value: ParsedApplication } | Fail {
  const type = str(input.type);
  if (!isPlatformKvkkType(type)) return fail("Başvuru türünü seçin.");
  const name = str(input.name).replace(/\s+/g, " ");
  if (name.length < 2 || name.length > 120) return fail("Adınızı ve soyadınızı yazın.");
  const email = normalizeEmail(str(input.email));
  if (!isValidEmail(email) || email.length > 254) return fail("Geçerli bir e-posta adresi girin.");
  const phoneRaw = str(input.phone);
  let phone: string | null = null;
  if (phoneRaw) {
    const p = parsePhoneStrict(phoneRaw);
    if (!p.ok) return fail(p.error ?? "Geçerli bir telefon numarası girin.");
    phone = p.stored;
  }
  const details = str(input.details);
  if (details.length < DETAILS_MIN) return fail(`Talebinizi en az ${DETAILS_MIN} karakterle açıklayın.`);
  if (details.length > DETAILS_MAX) return fail(`Açıklama en fazla ${DETAILS_MAX} karakter olabilir.`);
  if (!input.consent) return fail("Devam etmek için beyan kutusunu işaretleyin.");
  const officeHint = str(input.officeHint).slice(0, 160) || null;
  return { ok: true, value: { type, name, email, phone, officeHint, details } };
}

export type SubmitResult = { ok: true; requestId: string; ref: string; maskedEmail: string; resent: boolean } | Fail;

/**
 * Başvuruyu kaydeder (durum `awaiting_email`) ve doğrulama kodunu e-postayla gönderir. Aynı e-posta + tür için son
 * 24 saatte doğrulanmamış başvuru varsa YENİ satır açılmaz: bilgiler güncellenir ve yeni kod gider (en çok 3 gönderim).
 */
export async function submitApplication(
  db: Db,
  parsed: ParsedApplication,
  deps: { nowMs: number; send: PlatformKvkkSend },
): Promise<SubmitResult> {
  const nowMs = deps.nowMs;
  const emailHash = hashEmail(parsed.email);
  const code = sixDigit();
  const expires = iso(nowMs + VERIFY_CODE_TTL_MINUTES * 60_000);

  const { data: existing, error: exErr } = await db
    .from(PLATFORM_KVKK_TABLE)
    .select("id, ref, verify_sent_count")
    .eq("email_hash", emailHash)
    .eq("request_type", parsed.type)
    .eq("status", "awaiting_email")
    .gte("created_at", iso(nowMs - DAY_MS))
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (exErr) return fail(MISSING(exErr) ? "Başvuru formu bu ortamda henüz etkin değil; lütfen destek e-posta adresine yazın." : "Başvuru kaydedilemedi. Lütfen tekrar deneyin.");

  let id: string;
  let ref: string;
  let resent = false;
  if (existing) {
    const prev = existing as { id: string; ref: string; verify_sent_count: number };
    if ((prev.verify_sent_count ?? 0) >= VERIFY_MAX_SENDS) {
      return fail("Bu başvuru için çok fazla kod istendi. 24 saat sonra yeniden deneyin ya da destek e-posta adresine yazın.");
    }
    id = prev.id;
    ref = prev.ref;
    resent = true;
    const { error } = await db
      .from(PLATFORM_KVKK_TABLE)
      .update({
        requester_name: parsed.name,
        phone: parsed.phone,
        office_hint: parsed.officeHint,
        details: parsed.details,
        verify_code_hash: hashOtpForStorage(code, "kvkk-request", id),
        verify_expires_at: expires,
        verify_attempts: 0,
        verify_sent_count: (prev.verify_sent_count ?? 0) + 1,
        updated_at: iso(nowMs),
      })
      .eq("id", id)
      .eq("status", "awaiting_email");
    if (error) return fail("Başvuru kaydedilemedi. Lütfen tekrar deneyin.");
  } else {
    id = randomUUID();
    ref = "";
    let inserted = false;
    for (let attempt = 0; attempt < 3 && !inserted; attempt++) {
      ref = buildKvkkRef(Number(new Intl.DateTimeFormat("en-CA", { year: "numeric", timeZone: "Europe/Istanbul" }).format(new Date(nowMs))), randomBytes(6));
      const { error } = await db.from(PLATFORM_KVKK_TABLE).insert({
        id,
        ref,
        request_type: parsed.type,
        status: "awaiting_email",
        requester_name: parsed.name,
        email: parsed.email,
        email_hash: emailHash,
        phone: parsed.phone,
        office_hint: parsed.officeHint,
        details: parsed.details,
        verify_code_hash: hashOtpForStorage(code, "kvkk-request", id),
        verify_expires_at: expires,
        verify_attempts: 0,
        verify_sent_count: 1,
        created_at: iso(nowMs),
        updated_at: iso(nowMs),
      });
      if (!error) inserted = true;
      else if (error.code !== "23505") {
        return fail(MISSING(error) ? "Başvuru formu bu ortamda henüz etkin değil; lütfen destek e-posta adresine yazın." : "Başvuru kaydedilemedi. Lütfen tekrar deneyin.");
      }
    }
    if (!inserted) return fail("Başvuru kaydedilemedi. Lütfen tekrar deneyin.");
  }

  const sent = await deps.send({
    key: "kvkk_verify",
    to: parsed.email,
    vars: { ad: parsed.name, basvuru_no: ref, kod: code },
    source: SOURCE,
  });
  if (!sent.ok) {
    return fail("Doğrulama e-postası şu an gönderilemedi. Birkaç dakika sonra yeniden deneyin ya da destek e-posta adresine yazın.");
  }
  return { ok: true, requestId: id, ref, maskedEmail: maskEmailForDisplay(parsed.email), resent };
}

export type VerifyResult = { ok: true; ref: string; dueAt: string; already: boolean } | (Fail & { exhausted?: boolean });

/** Doğrulama kodu: 30 dk geçerli, en çok 5 hatalı deneme. Başarılıysa başvuru kuyruğa düşer ve 30 günlük süre başlar. */
export async function verifyApplication(db: Db, input: { requestId: string; code: string }, nowMs: number): Promise<VerifyResult> {
  const code = input.code.replace(/\D/g, "");
  if (!/^\d{6}$/.test(code)) return fail("6 haneli doğrulama kodunu girin.");
  const { data, error } = await db
    .from(PLATFORM_KVKK_TABLE)
    .select("id, ref, status, created_at, due_at, verify_code_hash, verify_expires_at, verify_attempts")
    .eq("id", input.requestId)
    .maybeSingle();
  if (error || !data) return fail("Başvuru bulunamadı. Formu yeniden gönderin.");
  const row = data as Pick<PlatformKvkkRow, "id" | "ref" | "status" | "created_at" | "due_at" | "verify_code_hash" | "verify_expires_at" | "verify_attempts">;
  if (row.status !== "awaiting_email") return { ok: true, ref: row.ref, dueAt: row.due_at ?? platformKvkkDueIso(row.created_at), already: true };
  if ((row.verify_attempts ?? 0) >= VERIFY_MAX_ATTEMPTS) {
    return { ...fail("Çok fazla hatalı deneme. Formu yeniden gönderip yeni kod alın."), exhausted: true };
  }
  if (!row.verify_expires_at || Date.parse(row.verify_expires_at) < nowMs) {
    return { ...fail("Kodun süresi doldu. Formu yeniden gönderip yeni kod alın."), exhausted: true };
  }
  if (!verifyOtpHash(code, row.verify_code_hash, "kvkk-request", row.id)) {
    const attempts = (row.verify_attempts ?? 0) + 1;
    // İyimser eşzamanlılık: aynı anda gelen denemeler sayacı atlatamaz (contracts.ts OTP deseni).
    await db.from(PLATFORM_KVKK_TABLE).update({ verify_attempts: attempts, updated_at: iso(nowMs) }).eq("id", row.id).eq("verify_attempts", row.verify_attempts ?? 0);
    const left = VERIFY_MAX_ATTEMPTS - attempts;
    return left > 0 ? fail(`Kod hatalı. ${left} deneme hakkınız kaldı.`) : { ...fail("Kod hatalı. Deneme hakkınız bitti; formu yeniden gönderin."), exhausted: true };
  }
  const dueAt = platformKvkkDueIso(row.created_at);
  const { data: upd, error: upErr } = await db
    .from(PLATFORM_KVKK_TABLE)
    .update({
      status: "open",
      email_verified_at: iso(nowMs),
      due_at: dueAt,
      verify_code_hash: null,
      verify_expires_at: null,
      updated_at: iso(nowMs),
    })
    .eq("id", row.id)
    .eq("status", "awaiting_email")
    .eq("verify_attempts", row.verify_attempts ?? 0)
    .select("id");
  if (upErr) return fail("Doğrulama kaydedilemedi. Lütfen tekrar deneyin.");
  if ((upd ?? []).length === 0) {
    // Eşzamanlı istek: başka bir istek doğruladıysa başarılı, sayaç değiştiyse yeniden denensin.
    const { data: again } = await db.from(PLATFORM_KVKK_TABLE).select("status, due_at").eq("id", row.id).maybeSingle();
    const st = again as { status: string; due_at: string | null } | null;
    if (st && st.status !== "awaiting_email") return { ok: true, ref: row.ref, dueAt: st.due_at ?? dueAt, already: true };
    return fail("Doğrulama tamamlanamadı. Kodu yeniden girin.");
  }
  return { ok: true, ref: row.ref, dueAt, already: false };
}

// ---------------------------------------------------------------------------------------------------------------------
// 3) Admin kuyruğu (YALNIZ meta: başvuru no, tür, durum, kimlik, tarihler) + SLA sayıları
// ---------------------------------------------------------------------------------------------------------------------

export type PlatformQueueFilters = { tur?: string; durum?: string; sure?: "gecikmis" | "yaklasan"; sayfa: number };

export function parsePlatformQueueFilters(sp: Record<string, string | string[] | undefined>): PlatformQueueFilters {
  const one = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v) ?? "";
  const tur = one(sp.tur);
  const durum = one(sp.durum);
  const sure = one(sp.sure);
  const n = Number(one(sp.sayfa));
  return {
    tur: isPlatformKvkkType(tur) ? tur : undefined,
    durum: durum === "acik" || (PLATFORM_KVKK_QUEUE_STATUSES as readonly string[]).includes(durum) ? durum : undefined,
    sure: sure === "gecikmis" || sure === "yaklasan" ? sure : undefined,
    sayfa: Number.isInteger(n) && n > 1 ? n : 1,
  };
}

export function platformQueueHref(f: Partial<PlatformQueueFilters>): string {
  const sp = new URLSearchParams({ kaynak: "basvuru" });
  if (f.tur) sp.set("tur", f.tur);
  if (f.durum) sp.set("durum", f.durum);
  if (f.sure) sp.set("sure", f.sure);
  if (f.sayfa && f.sayfa > 1) sp.set("sayfa", String(f.sayfa));
  return `/admin/tickets/kvkk?${sp.toString()}`;
}

export type PlatformQueueRow = {
  id: string;
  ref: string;
  type: PlatformKvkkType;
  status: string;
  identity: string;
  createdAt: string;
  dueAt: string | null;
  daysLeft: number | null;
  tone: KvkkTone;
};

export type PlatformQueue = { rows: PlatformQueueRow[]; total: number; open: number; late: number; warn: number; error: string | null; missing: boolean };

/** SLA eşikleri: gecikmiş ⇔ son tarih < bugün(TR); ≤W gün ⇔ bugün(TR) ≤ son tarih < bugün(TR) + W+1 gün. */
export function slaBounds(nowMs: number, warnDays: number = PLATFORM_KVKK_WARN_DAYS) {
  const today = trDayStartMs(nowMs);
  return { lateBefore: iso(today), warnBefore: iso(today + (warnDays + 1) * DAY_MS) };
}

const PAGE = 50;

export async function loadPlatformKvkkQueue(db: Db, f: PlatformQueueFilters, nowMs: number): Promise<PlatformQueue> {
  const { lateBefore, warnBefore } = slaBounds(nowMs);
  let q = db
    .from(PLATFORM_KVKK_TABLE)
    .select("id, ref, request_type, status, identity_status, created_at, due_at", { count: "exact" })
    .in("status", [...PLATFORM_KVKK_QUEUE_STATUSES])
    .order("due_at", { ascending: true })
    .order("id", { ascending: true })
    .range((f.sayfa - 1) * PAGE, f.sayfa * PAGE - 1);
  if (f.tur) q = q.eq("request_type", f.tur);
  if (f.durum === "acik") q = q.in("status", [...PLATFORM_KVKK_OPEN_STATUSES]);
  else if (f.durum) q = q.eq("status", f.durum);
  if (f.sure) {
    q = q.in("status", [...PLATFORM_KVKK_OPEN_STATUSES]);
    q = f.sure === "gecikmis" ? q.lt("due_at", lateBefore) : q.gte("due_at", lateBefore).lt("due_at", warnBefore);
  }
  const openCount = () => db.from(PLATFORM_KVKK_TABLE).select("id", { count: "exact", head: true }).in("status", [...PLATFORM_KVKK_OPEN_STATUSES]);
  const [list, open, late, warn] = await Promise.all([
    q,
    openCount(),
    openCount().lt("due_at", lateBefore),
    openCount().gte("due_at", lateBefore).lt("due_at", warnBefore),
  ]);
  if (list.error) return { rows: [], total: 0, open: 0, late: 0, warn: 0, error: list.error.message, missing: MISSING(list.error) };
  const rows = ((list.data ?? []) as Pick<PlatformKvkkRow, "id" | "ref" | "request_type" | "status" | "identity_status" | "created_at" | "due_at">[]).map((r) => {
    const daysLeft = platformKvkkDaysLeft(r.due_at, r.status, nowMs);
    return {
      id: r.id,
      ref: r.ref,
      type: r.request_type,
      status: r.status,
      identity: r.identity_status,
      createdAt: r.created_at,
      dueAt: r.due_at,
      daysLeft,
      tone: platformKvkkTone(daysLeft),
    };
  });
  return { rows, total: list.count ?? rows.length, open: open.count ?? 0, late: late.count ?? 0, warn: warn.count ?? 0, error: null, missing: false };
}

/** Uyarı motoru (AD10 `kvkk_sla`): açık başvurulardan gecikmiş ve eşik içindeki sayılar; okunamazsa null (değerlendirilmez). */
export async function platformKvkkSlaCounts(db: Db, nowMs: number, warnDays: number): Promise<{ late: number; warn: number; oldestLateRef: string | null } | null> {
  const { lateBefore, warnBefore } = slaBounds(nowMs, warnDays);
  const base = () => db.from(PLATFORM_KVKK_TABLE).select("id", { count: "exact", head: true }).in("status", [...PLATFORM_KVKK_OPEN_STATUSES]);
  const [late, warn, oldest] = await Promise.all([
    base().lt("due_at", lateBefore),
    base().gte("due_at", lateBefore).lt("due_at", warnBefore),
    db.from(PLATFORM_KVKK_TABLE).select("ref").in("status", [...PLATFORM_KVKK_OPEN_STATUSES]).lt("due_at", lateBefore).order("due_at", { ascending: true }).limit(1),
  ]);
  if (late.error || warn.error) return null;
  const first = ((oldest.data ?? []) as { ref: string }[])[0];
  return { late: late.count ?? 0, warn: warn.count ?? 0, oldestLateRef: first?.ref ?? null };
}

export async function loadPlatformKvkkRequest(db: Db, id: string): Promise<PlatformKvkkRow | null> {
  const { data, error } = await db.from(PLATFORM_KVKK_TABLE).select("*").eq("id", id).maybeSingle();
  if (error || !data) return null;
  return data as PlatformKvkkRow;
}

// ---------------------------------------------------------------------------------------------------------------------
// 4) Kişiye ait kayıtların taranması (e-posta + telefon; ad ile eşleştirme YAPILMAZ)
// ---------------------------------------------------------------------------------------------------------------------

/** ilike deseninde joker karakterleri düz metin yapar (e-postadaki `_` joker değildir). */
const likeExact = (v: string) => v.replace(/[\\%_]/g, (c) => `\\${c}`);
const MAX_MATCH = 50;
const CUSTOMER_COLS = "id, tenant_id, full_name, phone, email, created_at, deleted_at, source, notes, birth_date, customer_types";
const RELATED_TABLES = ["deals", "appointments", "calls", "communications", "offers", "tasks", "iys_consents"] as const;

type CustomerRaw = {
  id: string;
  tenant_id: string;
  full_name: string | null;
  phone: string | null;
  email: string | null;
  created_at: string | null;
  deleted_at: string | null;
  source: string | null;
  notes: string | null;
  birth_date: string | null;
  customer_types: string[] | null;
};

/** Kişinin e-posta ve (varsa) telefonuyla eşleşen kayıtlar: ofis müşterileri (+ ilişkili kayıt sayıları), demo talepleri, açık ev ziyaretçileri, saklanan imzacı/cari sayıları. */
export async function findSubjectRecords(db: Db, who: { email: string; phone: string | null }): Promise<SubjectRecords> {
  const email = likeExact(normalizeEmail(who.email));
  const byEmail = db.from("customers").select(CUSTOMER_COLS).ilike("email", email).order("id").limit(MAX_MATCH);
  const byPhone = who.phone ? db.from("customers").select(CUSTOMER_COLS).eq("phone", who.phone).order("id").limit(MAX_MATCH) : null;
  const demoEmail = db.from("demo_requests").select("id, full_name, email, phone, company, city, message, created_at").ilike("email", email).order("id").limit(MAX_MATCH);
  const demoPhone = who.phone ? db.from("demo_requests").select("id, full_name, email, phone, company, city, message, created_at").eq("phone", who.phone).order("id").limit(MAX_MATCH) : null;
  const visitors = db.from("open_house_visitors").select("id, full_name, email, phone, registered_at, created_customer_id").ilike("email", email).order("id").limit(MAX_MATCH);
  const signers = db.from("contract_signers").select("id", { count: "exact", head: true }).ilike("email", email);
  const parties = db.from("finance_parties").select("id", { count: "exact", head: true }).ilike("email", email);
  const empty = Promise.resolve({ data: [] as unknown[], error: null });
  const [ce, cp, de, dp, vi, si, fp] = await Promise.all([byEmail, byPhone ?? empty, demoEmail, demoPhone ?? empty, visitors, signers, parties]);
  if (ce.error) throw new Error(`Müşteri kayıtları taranamadı: ${ce.error.code ?? ""}`);

  const customers = new Map<string, CustomerRaw>();
  for (const r of [...((ce.data ?? []) as CustomerRaw[]), ...((cp.data ?? []) as CustomerRaw[])]) customers.set(r.id, r);
  const list = [...customers.values()].slice(0, MAX_MATCH);

  const tenantIds = [...new Set(list.map((c) => c.tenant_id))];
  const tenantNames = new Map<string, string>();
  if (tenantIds.length) {
    const { data } = await db.from("tenants").select("id, name").in("id", tenantIds);
    for (const t of (data ?? []) as { id: string; name: string | null }[]) tenantNames.set(t.id, t.name ?? "Ofis");
  }

  const subjectCustomers: SubjectCustomer[] = await Promise.all(
    list.map(async (c) => {
      const counts = await Promise.all(
        RELATED_TABLES.map((t) => db.from(t).select("id", { count: "exact", head: true }).eq("tenant_id", c.tenant_id).eq("customer_id", c.id)),
      );
      const related: Record<string, number> = {};
      RELATED_TABLES.forEach((t, i) => {
        const n = counts[i]?.error ? 0 : (counts[i]?.count ?? 0);
        if (n > 0) related[t] = n;
      });
      return {
        id: c.id,
        tenantId: c.tenant_id,
        tenantName: tenantNames.get(c.tenant_id) ?? "Ofis",
        fullName: c.full_name,
        phone: c.phone,
        email: c.email,
        createdAt: c.created_at,
        deletedAt: c.deleted_at,
        source: c.source,
        notes: c.notes,
        birthDate: c.birth_date,
        customerTypes: c.customer_types ?? [],
        related,
      };
    }),
  );

  type DemoRaw = { id: string; full_name: string | null; email: string | null; phone: string | null; company: string | null; city: string | null; message: string | null; created_at: string | null };
  const demos = new Map<string, DemoRaw>();
  for (const d of [...((de.error ? [] : de.data ?? []) as DemoRaw[]), ...((dp.error ? [] : dp.data ?? []) as DemoRaw[])]) demos.set(d.id, d);
  const demoRequests: SubjectSimple[] = [...demos.values()].map((d, i) => ({
    id: d.id,
    label: `Demo talebi ${i + 1}`,
    createdAt: d.created_at,
    fields: { "Ad soyad": d.full_name, "E-posta": d.email, Telefon: d.phone, Firma: d.company, Şehir: d.city, Mesaj: d.message },
  }));

  type VisitorRaw = { id: string; full_name: string | null; email: string | null; phone: string | null; registered_at: string | null; created_customer_id: string | null };
  // Müşteriye bağlı ziyaretçi kaydı müşteri anonimleştirmesiyle birlikte işlenir; burada yalnız bağsızlar listelenir.
  const visitorRows = ((vi.error ? [] : vi.data ?? []) as VisitorRaw[]).filter((v) => !v.created_customer_id || !customers.has(v.created_customer_id));
  const visitorList: SubjectSimple[] = visitorRows.map((v) => ({
    id: v.id,
    label: "Açık ev etkinliği",
    createdAt: v.registered_at,
    fields: { "Ad soyad": v.full_name, "E-posta": v.email, Telefon: v.phone },
  }));

  return {
    customers: subjectCustomers,
    demoRequests,
    visitors: visitorList,
    signers: si.error ? 0 : (si.count ?? 0),
    financeParties: fp.error ? 0 : (fp.count ?? 0),
  };
}

// ---------------------------------------------------------------------------------------------------------------------
// 5) Admin adımları: kimlik → veri paketi → silme → yanıt + sonuç
// ---------------------------------------------------------------------------------------------------------------------

type StepOk<T = object> = { ok: true; row: PlatformKvkkRow } & T;

async function loadOr(db: Db, id: string): Promise<PlatformKvkkRow | Fail> {
  const row = await loadPlatformKvkkRequest(db, id);
  if (!row || row.status === "awaiting_email") return fail("Başvuru bulunamadı.");
  return row;
}

export async function recordIdentityCheck(
  db: Db,
  id: string,
  staffId: string,
  input: { result: "verified" | "failed"; method: IdentityMethod | string; note: string },
  nowMs: number,
): Promise<StepOk | Fail> {
  const row = await loadOr(db, id);
  if ("ok" in row) return row;
  const blocked = identityBlocker(row);
  if (blocked) return fail(blocked);
  if (!isIdentityMethod(input.method)) return fail("Doğrulama yöntemini seçin.");
  const note = input.note.trim().slice(0, 1000);
  if (input.result === "failed" && note.length < 5) return fail("Doğrulanamama nedenini kısaca yazın.");
  const patch = {
    identity_status: input.result,
    identity_method: input.method,
    identity_note: note || null,
    identity_checked_at: iso(nowMs),
    identity_checked_by: staffId,
    assignee_id: row.assignee_id ?? staffId,
    updated_at: iso(nowMs),
  };
  const { error } = await db.from(PLATFORM_KVKK_TABLE).update(patch).eq("id", id);
  if (error) return fail("Kimlik kaydı yazılamadı.");
  return { ok: true, row: { ...row, ...patch } };
}

export async function preparePackage(db: Db, id: string, staffId: string, nowMs: number): Promise<StepOk<{ summary: PackageSummary }> | Fail> {
  const row = await loadOr(db, id);
  if ("ok" in row) return row;
  const blocked = packageBlocker(row);
  if (blocked) return fail(blocked);
  let records: SubjectRecords;
  try {
    records = await findSubjectRecords(db, { email: row.email, phone: row.phone });
  } catch {
    return fail("Kayıtlar taranamadı. Kısa süre sonra tekrar deneyin.");
  }
  const summary = summarizeRecords(records);
  const patch = {
    package_summary: summary,
    package_prepared_at: iso(nowMs),
    package_prepared_by: staffId,
    status: "in_progress",
    assignee_id: row.assignee_id ?? staffId,
    updated_at: iso(nowMs),
  };
  const { error } = await db.from(PLATFORM_KVKK_TABLE).update(patch).eq("id", id);
  if (error) return fail("Veri paketi kaydedilemedi.");
  return { ok: true, row: { ...row, ...patch }, summary };
}

export type ErasureResult = {
  at: string;
  anonymized: number;
  already: number;
  failed: { office: string; reason: string }[];
  demoRequests: number;
  visitors: number;
  retained: string[];
};

/**
 * Silme: MEVCUT anonimleştirme akışı (`anonymize_customer`, /app/uyum ile aynı RPC; yasal saklama gereken anlaşma/çağrı
 * satırları korunur, kişi alanları maskelenir, kvkk_erasure_log'a kanıt yazılır) her eşleşen ofis müşterisine uygulanır.
 * EmlakSoft'un kendi demo talepleri ve bağsız açık ev ziyaretçi kayıtları anonimleşir. İmzacı ve muhasebe cari kayıtları
 * yasal saklama gereği DOKUNULMADAN kalır ve sonuçta gerekçesiyle listelenir. Hata olursa adım tamamlanmış sayılmaz
 * (yeniden denenir; anonimleşmiş kayıt "zaten" sayılır).
 */
export async function applyErasure(db: Db, id: string, staffId: string, nowMs: number): Promise<StepOk<{ result: ErasureResult }> | Fail> {
  const row = await loadOr(db, id);
  if ("ok" in row) return row;
  const blocked = erasureBlocker(row);
  if (blocked) return fail(blocked);
  let records: SubjectRecords;
  try {
    records = await findSubjectRecords(db, { email: row.email, phone: row.phone });
  } catch {
    return fail("Kayıtlar taranamadı. Kısa süre sonra tekrar deneyin.");
  }
  const result: ErasureResult = { at: iso(nowMs), anonymized: 0, already: 0, failed: [], demoRequests: 0, visitors: 0, retained: summarizeRecords(records).legalHolds };
  for (const c of records.customers) {
    const { error } = await db.rpc("anonymize_customer", {
      p_tenant_id: c.tenantId,
      p_customer_id: c.id,
      p_reason: `KVKK başvurusu ${row.ref}`,
      p_actor_id: staffId,
    });
    if (!error) result.anonymized += 1;
    else if (/already anonymized/i.test(error.message ?? "")) result.already += 1;
    else result.failed.push({ office: c.tenantName, reason: (error.message ?? "bilinmeyen hata").slice(0, 160) });
  }
  for (const d of records.demoRequests) {
    const { error } = await db
      .from("demo_requests")
      .update({ full_name: "Anonim", email: null, phone: null, company: null, message: null, notes: null })
      .eq("id", d.id);
    if (error) result.failed.push({ office: "EmlakSoft demo talebi", reason: error.code ?? "yazılamadı" });
    else result.demoRequests += 1;
  }
  for (const v of records.visitors) {
    const { error } = await db.from("open_house_visitors").update({ full_name: "Anonim", email: null, phone: null, notes: null }).eq("id", v.id);
    if (error) result.failed.push({ office: "Açık ev ziyaretçi kaydı", reason: error.code ?? "yazılamadı" });
    else result.visitors += 1;
  }
  const done = result.failed.length === 0;
  const patch = {
    erasure_result: result,
    erasure_applied_at: done ? iso(nowMs) : null,
    erasure_applied_by: done ? staffId : null,
    updated_at: iso(nowMs),
  };
  const { error } = await db.from(PLATFORM_KVKK_TABLE).update(patch).eq("id", id);
  if (error) return fail("Silme sonucu kaydedilemedi; işlem yeniden denendiğinde anonimleşen kayıtlar 'zaten' sayılır.");
  return { ok: true, row: { ...row, ...patch }, result };
}

/**
 * Yanıt + sonuç: AD7 `kvkk_reply` şablonuyla başvuru sahibine gönderilir (e-posta kapalı/başarısızsa başvuru AÇIK kalır;
 * yanıt başka kanalla — KEP/posta — iletildiyse `sendEmail=false` ile yalnız sonuç kaydedilir).
 */
export async function respondAndClose(
  db: Db,
  id: string,
  staffId: string,
  input: { outcome: PlatformKvkkOutcome; text: string; sendEmail: boolean },
  deps: { nowMs: number; send: PlatformKvkkSend },
): Promise<StepOk<{ delivery: string | null }> | Fail> {
  const row = await loadOr(db, id);
  if ("ok" in row) return row;
  const blocked = respondBlocker(row, input.outcome);
  if (blocked) return fail(blocked);
  const text = input.text.trim();
  if (text.length < RESPONSE_MIN) return fail(`Yanıt metni en az ${RESPONSE_MIN} karakter olmalı.`);
  if (text.length > RESPONSE_MAX) return fail(`Yanıt metni en fazla ${RESPONSE_MAX} karakter olabilir.`);

  let delivery: string | null = null;
  if (input.sendEmail) {
    const sent = await deps.send({
      key: "kvkk_reply",
      to: row.email,
      vars: { ad: row.requester_name, basvuru_no: row.ref, yanit: text, tarih: trDate(row.created_at) },
      source: SOURCE,
      actorId: staffId,
    });
    if (!sent.ok) {
      const why = sent.code === "disabled" ? "e-posta kanalı kapalı" : sent.code === "suppressed" ? "adres bastırma listesinde" : "sağlayıcı hatası";
      return fail(`Yanıt e-postası gönderilemedi (${why}); başvuru açık kaldı. Yanıtı başka kanalla ilettiyseniz "e-postayla gönderme" seçeneğiyle sonuçlandırın.`);
    }
    delivery = "sent";
  }
  const patch = {
    status: input.outcome,
    response_text: text,
    response_sent_at: delivery ? iso(deps.nowMs) : null,
    response_delivery: delivery,
    resolved_at: iso(deps.nowMs),
    resolved_by: staffId,
    updated_at: iso(deps.nowMs),
  };
  const { error } = await db.from(PLATFORM_KVKK_TABLE).update(patch).eq("id", id).in("status", [...PLATFORM_KVKK_OPEN_STATUSES]);
  if (error) return fail(delivery ? "Yanıt gönderildi ancak sonuç kaydedilemedi; sayfayı yenileyip yalnız sonucu kaydedin." : "Sonuç kaydedilemedi.");
  return { ok: true, row: { ...row, ...patch }, delivery };
}

export async function assignRequest(db: Db, id: string, staffId: string | null, nowMs: number): Promise<{ ok: true } | Fail> {
  const { error } = await db.from(PLATFORM_KVKK_TABLE).update({ assignee_id: staffId, updated_at: iso(nowMs) }).eq("id", id).in("status", [...PLATFORM_KVKK_OPEN_STATUSES]);
  return error ? fail("Atama kaydedilemedi.") : { ok: true };
}

// ---------------------------------------------------------------------------------------------------------------------
// 6) Rapor merkezi (veri paketi) + saklama
// ---------------------------------------------------------------------------------------------------------------------

/**
 * Veri paketi satırları: YALNIZ kimliği doğrulanmış ve paketi hazırlanmış (kayıtları taranmış) başvuru için; aksi halde
 * boş (rapor açıklaması bunu söyler). Kayıtlar dosya üretimi anında yeniden okunur (güncel veri).
 */
export async function loadPackageRowsByRef(db: Db, ref: string): Promise<PackageRow[]> {
  const r = ref.trim().toUpperCase();
  if (!/^KVKK-\d{4}-[0-9A-Z]{6}$/.test(r)) return [];
  const { data } = await db.from(PLATFORM_KVKK_TABLE).select("id, ref, email, phone, identity_status, package_prepared_at, status, request_type, created_at").eq("ref", r).maybeSingle();
  const row = data as Pick<PlatformKvkkRow, "email" | "phone" | "identity_status" | "package_prepared_at" | "status" | "request_type" | "created_at" | "ref"> | null;
  if (!row || row.identity_status !== "verified" || !row.package_prepared_at) return [];
  const records = await findSubjectRecords(db, { email: row.email, phone: row.phone });
  const head: PackageRow[] = [
    { bolum: "Başvuru", ofis: "EmlakSoft", kayit: row.ref, alan: "Başvuru türü", deger: PLATFORM_KVKK_TYPE_LABELS[row.request_type] ?? row.request_type, tarih: row.created_at },
    { bolum: "Başvuru", ofis: "EmlakSoft", kayit: row.ref, alan: "Durum", deger: PLATFORM_KVKK_STATUS_LABELS[row.status as keyof typeof PLATFORM_KVKK_STATUS_LABELS] ?? row.status, tarih: row.created_at },
  ];
  return [...head, ...buildPackageRows(records)];
}

/** Doğrulanmayan başvurular 7 gün sonra silinir (kişisel veri amaçsız tutulmaz). Tablo yoksa 'skipped'. */
export async function purgeUnverifiedApplications(db: Db, nowMs: number): Promise<{ deleted: number } | { skipped: string }> {
  const { data, error } = await db
    .from(PLATFORM_KVKK_TABLE)
    .delete()
    .eq("status", "awaiting_email")
    .lt("created_at", iso(nowMs - UNVERIFIED_RETENTION_DAYS * DAY_MS))
    .select("id");
  if (error) {
    if (MISSING(error)) return { skipped: "tablo yok" };
    throw new Error(`kvkk unverified purge failed: ${error.code ?? "?"}`);
  }
  return { deleted: (data ?? []).length };
}
