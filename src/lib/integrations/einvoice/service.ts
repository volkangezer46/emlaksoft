/**
 * e-Fatura sunucu servisi: bağlantı yükleme (şifre çözme), satır<->taslak eşleme ve cron durum senkronu.
 * Kimlik bilgisi yalnız burada ve action'larda, bellekte kısa süre açılır; loga/sonuca girmez.
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import { now } from "@/lib/clock";
import { createClient } from "@/lib/supabase/server";
import {
  openEInvoiceCredentials,
  sealEInvoiceCredentials,
  type EInvoiceCredentials,
} from "./credentials";
import { isProviderId } from "./providers";
import { createEInvoiceAdapter } from "./registry";
import { applyRemoteStatus, STATUS_RECHECK_MS, STATUS_SYNC_BATCH } from "./status-sync";
import {
  fail,
  ok,
  type EInvoiceAdapter,
  type EInvoiceDocType,
  type EInvoiceLine,
  type EInvoiceMode,
  type EInvoiceProviderId,
  type EInvoiceProviderState,
  type EInvoiceRef,
  type EInvoiceStatus,
  type InvoiceDraft,
  type Result,
} from "./types";

export type EInvoiceRow = {
  id: string;
  tenant_id: string;
  connection_id: string | null;
  provider: EInvoiceProviderId;
  mode: EInvoiceMode;
  source_type: string;
  source_id: string | null;
  source_label: string | null;
  doc_type: EInvoiceDocType;
  status: EInvoiceStatus;
  provider_state: EInvoiceProviderState;
  buyer_name: string;
  buyer_tax_id: string;
  buyer_tax_office: string | null;
  buyer_address: string | null;
  buyer_city: string | null;
  buyer_district: string | null;
  buyer_alias: string | null;
  lines: EInvoiceLine[];
  net_total: number | string;
  vat_total: number | string;
  gross_total: number | string;
  issue_date: string;
  note: string | null;
  external_id: string;
  provider_ref: Partial<EInvoiceRef> | null;
  number: string | null;
  error: string | null;
  idempotency_key: string;
  issued_at: string | null;
  last_checked_at: string | null;
  created_at: string;
};

export const EINVOICE_ROW_COLUMNS =
  "id, tenant_id, connection_id, provider, mode, source_type, source_id, source_label, doc_type, status, provider_state, buyer_name, buyer_tax_id, buyer_tax_office, buyer_address, buyer_city, buyer_district, buyer_alias, lines, net_total, vat_total, gross_total, issue_date, note, external_id, provider_ref, number, error, idempotency_key, issued_at, last_checked_at, created_at";

export const CONNECTION_COLUMNS =
  "id, provider, mode, status, fingerprint, company_name, last_test_at, last_test_ok, last_error, created_at";

export type ConnectionInfo = {
  id: string;
  provider: EInvoiceProviderId;
  mode: EInvoiceMode;
  status: "active" | "error";
  fingerprint: string | null;
  company_name: string | null;
  last_test_at: string | null;
  last_test_ok: boolean | null;
  last_error: string | null;
};

/** Tablo henüz yok (migration uygulanmadı) hatası. */
export function isMissingEInvoiceTable(error: { code?: string; message?: string } | null | undefined): boolean {
  if (!error) return false;
  if (error.code === "42P01" || error.code === "PGRST205") return true;
  const msg = error.message ?? "";
  return /einvoice/i.test(msg) && /does not exist|schema cache/i.test(msg);
}

export function rowToDraft(row: EInvoiceRow): InvoiceDraft {
  return {
    uuid: row.external_id,
    docType: row.doc_type,
    issueDate: row.issue_date,
    buyer: {
      name: row.buyer_name,
      taxId: row.buyer_tax_id,
      taxOffice: row.buyer_tax_office,
      address: row.buyer_address,
      city: row.buyer_city,
      district: row.buyer_district,
    },
    lines: (row.lines ?? []).map((l) => ({
      description: String(l.description),
      quantity: Number(l.quantity),
      unitPrice: Number(l.unitPrice),
      vatRate: Number(l.vatRate),
    })),
    note: row.note,
    alias: row.buyer_alias,
  };
}

export function rowToRef(row: EInvoiceRow): EInvoiceRef | null {
  const ref = row.provider_ref ?? {};
  if (!ref.externalId) return null;
  return { ...ref, externalId: ref.externalId, docType: row.doc_type, alias: ref.alias ?? row.buyer_alias } as EInvoiceRef;
}

export async function getConnectionInfo(supabase: SupabaseClient): Promise<{ info: ConnectionInfo | null; available: boolean }> {
  const { data, error } = await supabase.from("einvoice_connections").select(CONNECTION_COLUMNS).maybeSingle();
  if (error) {
    if (!isMissingEInvoiceTable(error)) console.error("einvoice getConnectionInfo", error.code);
    return { info: null, available: false };
  }
  return { info: (data as ConnectionInfo | null) ?? null, available: true };
}

/** Entegrasyon kayıt defteri için: ofis bağlı mı (tablo yoksa false). */
export async function isTenantEInvoiceConnected(): Promise<boolean> {
  try {
    const supabase = await createClient();
    const { info } = await getConnectionInfo(supabase);
    return info !== null;
  } catch {
    return false;
  }
}

export type LoadedAdapter = { adapter: EInvoiceAdapter; connection: { id: string; provider: EInvoiceProviderId; mode: EInvoiceMode } };

type SecretRow = { id: string; provider: string; mode: string; credentials_sealed: string };

function openRow(tenantId: string, row: SecretRow): { creds: EInvoiceCredentials; provider: EInvoiceProviderId; mode: EInvoiceMode } | null {
  if (!isProviderId(row.provider)) return null;
  const creds = openEInvoiceCredentials(tenantId, row.provider, row.credentials_sealed);
  if (!creds) return null;
  return { creds, provider: row.provider, mode: row.mode === "sandbox" ? "sandbox" : "live" };
}

/** Kullanıcı oturumuyla (izin kapılı RPC) bağlantıyı yükler. */
export async function loadAdapterForUser(supabase: SupabaseClient, tenantId: string): Promise<Result<LoadedAdapter>> {
  const { data, error } = await supabase.rpc("einvoice_connection_secret");
  if (error) {
    if (isMissingEInvoiceTable(error) || error.code === "PGRST202") return fail("not_supported", "e-Fatura henüz etkin değil (veritabanı güncellemesi bekleniyor).");
    return fail("unavailable", "e-Fatura bağlantısı okunamadı.");
  }
  const row = (Array.isArray(data) ? data[0] : data) as SecretRow | undefined;
  if (!row) return fail("not_found", "e-Fatura bağlı değil. Ayarlar > Entegrasyonlar'dan bağlayın.");
  const opened = openRow(tenantId, row);
  if (!opened) return fail("unauthorized", "Kayıtlı e-Fatura anahtarı çözülemedi. Bağlantıyı yeniden kurun.");
  const adapter = createEInvoiceAdapter(opened.creds, opened.mode, {
    onRefreshTokenRotated: async (refreshToken) => {
      if (opened.creds.provider !== "parasut") return;
      const sealed = sealEInvoiceCredentials(tenantId, { ...opened.creds, refreshToken });
      if (sealed) await supabase.rpc("einvoice_store_rotated_credentials", { p_sealed: sealed });
    },
  });
  return ok({ adapter, connection: { id: row.id, provider: opened.provider, mode: opened.mode } });
}

/** Cron: servis anahtarıyla (çağıran admin istemcisini verir; bu modül yeni admin istemcisi AÇMAZ). */
async function loadAdapterForTenantAdmin(admin: SupabaseClient, tenantId: string): Promise<Result<LoadedAdapter>> {
  const { data, error } = await admin
    .from("einvoice_connections")
    .select("id, provider, mode, credentials_sealed")
    .eq("tenant_id", tenantId)
    .maybeSingle();
  if (error || !data) return fail("not_found", "e-Fatura bağlı değil.");
  const row = data as SecretRow;
  const opened = openRow(tenantId, row);
  if (!opened) return fail("unauthorized", "Kayıtlı e-Fatura anahtarı çözülemedi.");
  const adapter = createEInvoiceAdapter(opened.creds, opened.mode, {
    onRefreshTokenRotated: async (refreshToken) => {
      if (opened.creds.provider !== "parasut") return;
      const sealed = sealEInvoiceCredentials(tenantId, { ...opened.creds, refreshToken });
      if (sealed) await admin.from("einvoice_connections").update({ credentials_sealed: sealed }).eq("id", row.id);
    },
  });
  return ok({ adapter, connection: { id: row.id, provider: opened.provider, mode: opened.mode } });
}

export type EInvoiceSyncSummary = { checked: number; updated: number; failed: number };

/**
 * `otomasyon` cron adımı: resmileştirilmiş ama sağlayıcıca henüz sonuçlanmamış belgelerin durumunu sorar.
 * Çağıran admin istemcisini verir (otomasyon motorunun mevcut istemcisi). Sağlayıcı hatası belge durumunu
 * DEĞİŞTİRMEZ (yalnız last_checked_at ilerler); her çalıştırma sınırlı sayıda belge işler.
 */
export async function syncPendingEInvoices(admin: SupabaseClient, options: { deadlineMs?: number } = {}): Promise<EInvoiceSyncSummary> {
  const summary: EInvoiceSyncSummary = { checked: 0, updated: 0, failed: 0 };
  const cutoff = new Date(now() - STATUS_RECHECK_MS).toISOString();
  const { data, error } = await admin
    .from("einvoices")
    .select(EINVOICE_ROW_COLUMNS)
    .eq("status", "issued")
    .in("provider_state", ["none", "waiting"])
    .or(`last_checked_at.is.null,last_checked_at.lt.${cutoff}`)
    .order("last_checked_at", { ascending: true, nullsFirst: true })
    .limit(STATUS_SYNC_BATCH);
  if (error) {
    if (!isMissingEInvoiceTable(error)) console.error("syncPendingEInvoices", error.code);
    return summary;
  }
  const rows = (data ?? []) as unknown as EInvoiceRow[];
  const adapters = new Map<string, Result<LoadedAdapter>>();
  for (const row of rows) {
    if (options.deadlineMs !== undefined && now() >= options.deadlineMs) break;
    let loaded = adapters.get(row.tenant_id);
    if (!loaded) {
      loaded = await loadAdapterForTenantAdmin(admin, row.tenant_id);
      adapters.set(row.tenant_id, loaded);
    }
    const checkedAt = new Date(now()).toISOString();
    const ref = rowToRef(row);
    if (!loaded.ok || !ref || loaded.value.connection.provider !== row.provider) {
      summary.failed += 1;
      await admin.from("einvoices").update({ last_checked_at: checkedAt }).eq("id", row.id);
      continue;
    }
    summary.checked += 1;
    const res = await loaded.value.adapter.getStatus(ref);
    if (!res.ok) {
      summary.failed += 1;
      await admin.from("einvoices").update({ last_checked_at: checkedAt }).eq("id", row.id);
      continue;
    }
    const patch = applyRemoteStatus(
      { status: row.status, provider_state: row.provider_state, number: row.number, error: row.error },
      res.value,
    );
    const { error: upErr } = await admin
      .from("einvoices")
      .update({ ...patch, last_checked_at: checkedAt })
      .eq("id", row.id);
    if (upErr) summary.failed += 1;
    else summary.updated += 1;
  }
  return summary;
}

export type InvoiceButtonContext = {
  /** Kullanıcı fatura kesebilir mi (commissions.create). false ise düğme hiç gösterilmez. */
  canInvoice: boolean;
  /** Ofis bir sağlayıcıya bağlı mı. */
  connected: boolean;
  /** Kaynak kimliği -> o kaynağın (iptal edilmemiş) faturası. */
  existing: Record<string, { id: string; status: EInvoiceStatus }>;
};

/** "Fatura kes" düğmesi bağlamı: sayfa başına TEK tur (bağlantı + kaynakların mevcut faturaları). */
export async function loadInvoiceButtonContext(
  supabase: SupabaseClient,
  canInvoice: boolean,
  sourceType: "commission" | "rent_management_fee",
  sourceIds: readonly string[],
): Promise<InvoiceButtonContext> {
  const none: InvoiceButtonContext = { canInvoice: false, connected: false, existing: {} };
  if (!canInvoice) return none;
  const { info, available } = await getConnectionInfo(supabase);
  if (!available) return none; // tablo yok: düğme gösterilmez (sahte vaat yok)
  const existing: InvoiceButtonContext["existing"] = {};
  if (info && sourceIds.length > 0) {
    const { data } = await supabase
      .from("einvoices")
      .select("id, status, source_id")
      .eq("source_type", sourceType)
      .in("source_id", [...sourceIds])
      .neq("status", "cancelled");
    for (const r of (data ?? []) as Array<{ id: string; status: EInvoiceStatus; source_id: string }>) {
      existing[r.source_id] = { id: r.id, status: r.status };
    }
  }
  return { canInvoice: true, connected: info !== null, existing };
}
