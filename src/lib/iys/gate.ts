import type { SupabaseClient } from "@supabase/supabase-js";

/**
 * MERKEZİ İYS GÖNDERİM KAPISI (TEK FONKSİYON AİLESİ).
 *
 * Ticari elektronik ileti (kampanya, toplu SMS/WhatsApp/e-posta, otomasyon, anket, pazarlama amaçlı tekil mesaj) göndermeden
 * ÖNCE alıcının KANAL BAZLI İYS/izin durumu buradan geçer: `iys_consents` kaydı `granted` ve `revoked_at` boş değilse gönderilmez.
 * İzinsiz alıcı ATLANIR; sayısı ve nedenleri sonuçta raporlanır (sessiz düşürme yok).
 *
 * İŞLEM AMAÇLI iletiler (randevu hatırlatma, sözleşme imzası, kira/aidat hatırlatması, malik raporu, doğrulama kodu) İYS kapsamı
 * dışındadır: açıkça etiketli (`TRANSACTIONAL_LABEL`) ve `exempt: true` döner; ayrıca kanıt amacıyla kayıt altına alınır.
 *
 * Sunucu dışında kullanılmaz ama `server-only` içermez: SAF çekirdek (`evaluateIysGate`) birim testlerinde doğrudan çalışır.
 * Yeni bir gönderim yolu eklenirse `src/lib/iys/iys-gate-contract.test.ts` kaydına (ticari ya da işlem amaçlı) girmek zorundadır.
 */

export const IYS_CHANNELS = ["sms", "whatsapp", "email", "call"] as const;
export type IysChannel = (typeof IYS_CHANNELS)[number];

/** Ticari ileti türleri: İYS kapısından GEÇMEK ZORUNDA. */
export const COMMERCIAL_KINDS = ["campaign", "bulk_message", "automation", "survey", "marketing_single", "authority_reminder"] as const;
/** İşlem amaçlı ileti türleri: İYS'den muaf, etiketli. */
export const TRANSACTIONAL_KINDS = ["appointment_reminder", "contract_signature", "rent_reminder", "owner_report", "auth_code", "system_notice"] as const;

export type CommercialKind = (typeof COMMERCIAL_KINDS)[number];
export type TransactionalKind = (typeof TRANSACTIONAL_KINDS)[number];
export type MessageKind = CommercialKind | TransactionalKind;
export type MessagePurpose = "commercial" | "transactional";

export const TRANSACTIONAL_LABEL = "İşlem amaçlı ileti: İYS kapsamı dışında";

export function messagePurpose(kind: MessageKind): MessagePurpose {
  return (TRANSACTIONAL_KINDS as readonly string[]).includes(kind) ? "transactional" : "commercial";
}

export type IysConsentRow = {
  customer_id: string | null;
  channel: string;
  status: string;
  revoked_at: string | null;
};

export type IysSkipReason = "no_record" | "not_granted" | "denied" | "revoked" | "lookup_failed";

export const IYS_SKIP_LABELS: Record<IysSkipReason, string> = {
  no_record: "İYS kaydı yok",
  not_granted: "İzin onaylı değil (bilinmiyor/beklemede)",
  denied: "İzin reddedilmiş",
  revoked: "İzin geri alınmış",
  lookup_failed: "İzin durumu okunamadı (güvenli tarafta atlandı)",
};

export type IysGateResult = {
  kind: MessageKind;
  purpose: MessagePurpose;
  channel: IysChannel;
  /** İşlem amaçlı muafiyet: hiçbir alıcı elenmedi. */
  exempt: boolean;
  /** Muafiyet etiketi (işlem amaçlı iletide dolu, ticaride null). */
  label: string | null;
  total: number;
  allowed: string[];
  skipped: { customerId: string; reason: IysSkipReason }[];
  skippedCount: number;
  reasons: Partial<Record<IysSkipReason, number>>;
};

/** Tek alıcı için izin kararı (SAF). */
export function evaluateConsent(row: Pick<IysConsentRow, "status" | "revoked_at"> | undefined | null): { allowed: true } | { allowed: false; reason: IysSkipReason } {
  if (!row) return { allowed: false, reason: "no_record" };
  if (row.revoked_at) return { allowed: false, reason: "revoked" };
  if (row.status === "granted") return { allowed: true };
  if (row.status === "denied") return { allowed: false, reason: "denied" };
  return { allowed: false, reason: "not_granted" };
}

/**
 * SAF çekirdek: alıcı kimlikleri + (zaten okunmuş) izin satırları → karar.
 * `lookupFailed` doğruysa ticari ileti HİÇ gönderilmez (fail-closed); işlem amaçlı ileti etkilenmez.
 */
export function evaluateIysGate(input: {
  kind: MessageKind;
  channel: IysChannel;
  customerIds: readonly string[];
  rows: readonly IysConsentRow[];
  lookupFailed?: boolean;
}): IysGateResult {
  const purpose = messagePurpose(input.kind);
  const ids = [...new Set(input.customerIds.filter(Boolean))];
  const base = { kind: input.kind, purpose, channel: input.channel, total: ids.length };
  if (purpose === "transactional") {
    return { ...base, exempt: true, label: TRANSACTIONAL_LABEL, allowed: ids, skipped: [], skippedCount: 0, reasons: {} };
  }
  const byCustomer = new Map<string, IysConsentRow>();
  for (const r of input.rows) {
    if (r.customer_id && r.channel === input.channel) byCustomer.set(r.customer_id, r);
  }
  const allowed: string[] = [];
  const skipped: IysGateResult["skipped"] = [];
  const reasons: IysGateResult["reasons"] = {};
  for (const id of ids) {
    const verdict = input.lookupFailed ? ({ allowed: false, reason: "lookup_failed" } as const) : evaluateConsent(byCustomer.get(id));
    if (verdict.allowed) {
      allowed.push(id);
    } else {
      skipped.push({ customerId: id, reason: verdict.reason });
      reasons[verdict.reason] = (reasons[verdict.reason] ?? 0) + 1;
    }
  }
  return { ...base, exempt: false, label: null, allowed, skipped, skippedCount: skipped.length, reasons };
}

const IN_CHUNK = 200;
/** Bu sayıdan fazla alıcıda tek tek `in (...)` yerine kanalın tüm izin satırları sayfalanarak okunur. */
const BULK_THRESHOLD = 400;
const PAGE = 1000;
const MAX_PAGES = 50;

async function loadConsentRows(
  db: SupabaseClient,
  tenantId: string,
  channel: IysChannel,
  customerIds: readonly string[],
): Promise<{ rows: IysConsentRow[]; failed: boolean }> {
  const rows: IysConsentRow[] = [];
  if (customerIds.length === 0) return { rows, failed: false };
  if (customerIds.length > BULK_THRESHOLD) {
    for (let page = 0; page < MAX_PAGES; page += 1) {
      const { data, error } = await db
        .from("iys_consents")
        .select("customer_id, channel, status, revoked_at")
        .eq("tenant_id", tenantId)
        .eq("channel", channel)
        .order("customer_id", { ascending: true })
        .range(page * PAGE, page * PAGE + PAGE - 1);
      if (error) return { rows, failed: true };
      const got = (data ?? []) as IysConsentRow[];
      rows.push(...got);
      if (got.length < PAGE) return { rows, failed: false };
    }
    return { rows, failed: true };
  }
  for (let i = 0; i < customerIds.length; i += IN_CHUNK) {
    const { data, error } = await db
      .from("iys_consents")
      .select("customer_id, channel, status, revoked_at")
      .eq("tenant_id", tenantId)
      .eq("channel", channel)
      .in("customer_id", customerIds.slice(i, i + IN_CHUNK));
    if (error) return { rows, failed: true };
    rows.push(...((data ?? []) as IysConsentRow[]));
  }
  return { rows, failed: false };
}

/**
 * Ticari ileti göndermeden önce çağrılır. `allowed` listesindekilere gönderilir; `skipped` raporlanır.
 * İşlem amaçlı türlerde veritabanına hiç gidilmez (muaf, etiketli).
 * `db`: çağıranın kendi (tenant kapsamlı) istemcisi; bu dosya yeni istemci OLUŞTURMAZ. Sorgu her zaman `tenant_id` ile sınırlanır.
 */
export async function gateIysRecipients(
  db: SupabaseClient,
  input: { tenantId: string; kind: MessageKind; channel: IysChannel; customerIds: readonly string[] },
): Promise<IysGateResult> {
  const ids = [...new Set(input.customerIds.filter(Boolean))];
  if (messagePurpose(input.kind) === "transactional") {
    return evaluateIysGate({ kind: input.kind, channel: input.channel, customerIds: ids, rows: [] });
  }
  const { rows, failed } = await loadConsentRows(db, input.tenantId, input.channel, ids);
  return evaluateIysGate({ kind: input.kind, channel: input.channel, customerIds: ids, rows, lookupFailed: failed });
}

/** Tek alıcı kısayolu (tekil mesaj / otomasyon). */
export async function gateIysRecipient(
  db: SupabaseClient,
  input: { tenantId: string; kind: MessageKind; channel: IysChannel; customerId: string },
): Promise<{ allowed: boolean; reason: IysSkipReason | null; result: IysGateResult }> {
  const result = await gateIysRecipients(db, { ...input, customerIds: [input.customerId] });
  const skip = result.skipped[0];
  return { allowed: result.allowed.length === 1, reason: skip?.reason ?? null, result };
}

/** Kullanıcıya gösterilecek tek cümlelik özet ("Toplam 120 alıcı: 84 izinli, 36 atlanacak"). */
export function describeIysGate(r: Pick<IysGateResult, "exempt" | "label" | "total" | "allowed" | "skippedCount">): string {
  if (r.exempt) return `${r.label ?? TRANSACTIONAL_LABEL} (${r.total} alıcı).`;
  if (r.total === 0) return "Alıcı yok.";
  return `Toplam ${r.total} alıcı: ${r.allowed.length} izinli, ${r.skippedCount} İYS izni olmadığı için atlanacak.`;
}

/** Atlanan alıcıların neden dökümü (rapor/denetim satırı). */
export function describeSkipReasons(reasons: IysGateResult["reasons"]): string {
  return (Object.keys(reasons) as IysSkipReason[])
    .filter((k) => (reasons[k] ?? 0) > 0)
    .map((k) => `${IYS_SKIP_LABELS[k]}: ${reasons[k]}`)
    .join(" · ");
}
