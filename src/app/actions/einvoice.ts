"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { requirePermission } from "@/lib/require-permission";
import { actionErrorMessage } from "@/lib/action-errors";
import { logActivity } from "@/lib/activity";
import { now } from "@/lib/clock";
import { checkRateLimit } from "@/lib/rate-limit";
import { platformSecretsEnabled } from "@/lib/platform-secrets";
import {
  credentialFingerprint,
  parseNilveraInput,
  parseParasutInput,
  sealEInvoiceCredentials,
  type EInvoiceCredentials,
} from "@/lib/integrations/einvoice/credentials";
import { decideDocType, computeTotals, idempotencyKey, validateDraftInput } from "@/lib/integrations/einvoice/invoice-math";
import { isProviderId, EINVOICE_PROVIDER_META } from "@/lib/integrations/einvoice/providers";
import { createEInvoiceAdapter } from "@/lib/integrations/einvoice/registry";
import { parasutAuthorizeWithPassword } from "@/lib/integrations/einvoice/parasut";
import {
  EINVOICE_ROW_COLUMNS,
  isMissingEInvoiceTable,
  isAmbiguousIssueError,
  issueLockExpired,
  loadAdapterForUser,
  resolveIssueOutcome,
  rowToDraft,
  rowToRef,
  type EInvoiceRow,
} from "@/lib/integrations/einvoice/service";
import { loadSourcePrefill } from "@/lib/integrations/einvoice/source-prefill";
import { applyRemoteStatus } from "@/lib/integrations/einvoice/status-sync";
import {
  EINVOICE_SOURCE_TYPES,
  type EInvoiceLine,
  type EInvoiceMode,
  type EInvoiceSourceType,
} from "@/lib/integrations/einvoice/types";

export type EInvoiceActionResult = { ok?: boolean; error?: string; message?: string; id?: string };

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const NOT_READY = "e-Fatura henüz etkin değil (veritabanı güncellemesi bekleniyor).";

function text(formData: FormData, key: string, max = 500): string {
  return String(formData.get(key) ?? "").trim().slice(0, max);
}

/** Adaptör hataları Türkçe ve gövdesiz yazılmıştır (anahtar/sağlayıcı ham metni içermez); doğrudan gösterilebilir. */
function adapterMessage(e: { message: string }): string {
  const { message } = e;
  return message;
}

function nowIso(): string {
  return new Date(now()).toISOString();
}

const BUSY = "İşlem sürüyor, birazdan Durumu yenile ile bakın.";
const UNCERTAIN =
  "Sağlayıcıdan yanıt alınamadı; fatura gönderilmiş olabilir. Sonuç sağlayıcıda doğrulanıyor, tekrar gönderilmeyecek. Birkaç dakika sonra Durumu yenile ile bakın.";
const RATE_MSG = "Çok sık deneme yapıldı. Birkaç saniye bekleyip yeniden deneyin.";

type RpcErr = { code?: string; message?: string };

/** RPC hatasını Türkçe mesaja çevirir (tablo/RPC yok, kilit, izin). */
function rpcFailure(error: RpcErr, fallback: string): string {
  if (error.code === "PGRST202" || isMissingEInvoiceTable(error)) return NOT_READY;
  if (error.code === "55P03") return BUSY;
  if (error.code === "42501") return "Bu işlem için yetkiniz yok.";
  return actionErrorMessage(error, fallback);
}

function refresh(): void {
  revalidatePath("/app/giderler");
  revalidatePath("/app/ayarlar/entegrasyonlar");
}

// ---------------------------------------------------------------------------
// Bağlantı (Ayarlar > Entegrasyonlar)
// ---------------------------------------------------------------------------

/** Sağlayıcıyı bağlar: kimlik bilgisi doğrulanır, SONRA şifreli kaydedilir. Başarısız testte kayıt yapılmaz. */
export async function saveEInvoiceConnection(_prev: EInvoiceActionResult, formData: FormData): Promise<EInvoiceActionResult> {
  const gate = await requirePermission("settings", "edit");
  if (!gate.ok) return { error: gate.error };

  const providerRaw = text(formData, "provider", 20);
  if (!isProviderId(providerRaw)) return { error: "Sağlayıcı seçin." };
  const provider = providerRaw;
  const meta = EINVOICE_PROVIDER_META[provider];
  const modeRaw = text(formData, "mode", 10);
  const mode: EInvoiceMode = modeRaw === "sandbox" && meta.modes.includes("sandbox") ? "sandbox" : "live";
  if (!platformSecretsEnabled()) {
    return { error: "Anahtarlar güvenle saklanamıyor (şifreleme anahtarı tanımlı değil). Yöneticiyle görüşün." };
  }

  let creds: EInvoiceCredentials;
  if (provider === "nilvera") {
    const parsed = parseNilveraInput(String(formData.get("apiKey") ?? ""));
    if (!parsed.ok) return { error: parsed.error };
    creds = parsed.value;
  } else {
    const input = {
      clientId: text(formData, "clientId", 200),
      clientSecret: text(formData, "clientSecret", 400),
      companyId: text(formData, "companyId", 20),
      email: text(formData, "email", 200),
      password: String(formData.get("password") ?? "").slice(0, 400),
    };
    const parsed = parseParasutInput(input);
    if (!parsed.ok) return { error: parsed.error };
    const auth = await parasutAuthorizeWithPassword(input);
    if (!auth.ok) return { error: adapterMessage(auth.error) };
    creds = { provider: "parasut", clientId: input.clientId, clientSecret: input.clientSecret, companyId: input.companyId, refreshToken: auth.value.refreshToken };
  }

  const test = await createEInvoiceAdapter(creds, mode).testConnection();
  if (!test.ok) return { error: `Bağlantı kurulamadı. ${adapterMessage(test.error)}` };

  const sealed = sealEInvoiceCredentials(gate.tenantId, creds);
  if (!sealed) return { error: "Anahtarlar güvenle saklanamıyor (şifreleme anahtarı tanımlı değil)." };

  const supabase = await createClient();
  const stamp = nowIso();
  const { error } = await supabase.from("einvoice_connections").upsert(
    {
      tenant_id: gate.tenantId,
      provider,
      mode,
      status: "active",
      credentials_sealed: sealed,
      fingerprint: credentialFingerprint(creds),
      company_name: test.value.company.slice(0, 200),
      last_test_at: stamp,
      last_test_ok: true,
      last_error: null,
      created_by: gate.userId,
      updated_at: stamp,
    },
    { onConflict: "tenant_id" },
  );
  if (error) {
    if (isMissingEInvoiceTable(error)) return { error: NOT_READY };
    return { error: actionErrorMessage(error, "Bağlantı kaydedilemedi.") };
  }
  await logActivity({
    tenantId: gate.tenantId,
    actorId: gate.userId,
    action: "einvoice.connect",
    entityType: "einvoice_connection",
    newValue: { provider, mode, fingerprint: credentialFingerprint(creds) },
  });
  refresh();
  return { ok: true, message: `${meta.name} bağlandı: ${test.value.company}` };
}

/** Kayıtlı bağlantıyı yeniden sınar ("Bağlantıyı test et"). */
export async function testEInvoiceConnection(): Promise<EInvoiceActionResult> {
  const gate = await requirePermission("settings", "edit");
  if (!gate.ok) return { error: gate.error };
  const supabase = await createClient();
  const loaded = await loadAdapterForUser(supabase, gate.tenantId);
  if (!loaded.ok) return { error: adapterMessage(loaded.error) };
  const test = await loaded.value.adapter.testConnection();
  const stamp = nowIso();
  await supabase
    .from("einvoice_connections")
    .update(
      test.ok
        ? { status: "active", last_test_at: stamp, last_test_ok: true, last_error: null, company_name: test.value.company.slice(0, 200), updated_at: stamp }
        : { status: "error", last_test_at: stamp, last_test_ok: false, last_error: adapterMessage(test.error).slice(0, 500), updated_at: stamp },
    )
    .eq("tenant_id", gate.tenantId);
  refresh();
  if (!test.ok) return { error: adapterMessage(test.error) };
  return { ok: true, message: `Bağlantı çalışıyor: ${test.value.company}` };
}

/** Bağlantıyı kaldırır; kesilmiş faturalar sağlayıcıda ve burada kalır. */
export async function removeEInvoiceConnection(): Promise<EInvoiceActionResult> {
  const gate = await requirePermission("settings", "edit");
  if (!gate.ok) return { error: gate.error };
  const supabase = await createClient();
  const { error } = await supabase.from("einvoice_connections").delete().eq("tenant_id", gate.tenantId);
  if (error) {
    if (isMissingEInvoiceTable(error)) return { error: NOT_READY };
    return { error: actionErrorMessage(error, "Bağlantı kaldırılamadı.") };
  }
  await logActivity({ tenantId: gate.tenantId, actorId: gate.userId, action: "einvoice.disconnect", entityType: "einvoice_connection" });
  refresh();
  return { ok: true, message: "Bağlantı kaldırıldı." };
}

// ---------------------------------------------------------------------------
// Alıcı sorgusu
// ---------------------------------------------------------------------------

export type BuyerLookupResult = {
  ok?: boolean;
  error?: string;
  isEInvoiceUser?: boolean;
  docType?: "e-fatura" | "e-arsiv";
};

/** Alıcı e-Fatura mükellefi mi? (bilgi amaçlı; taslak kaydında da aynı sorgu yapılır). */
export async function lookupInvoiceBuyer(taxId: string): Promise<BuyerLookupResult> {
  const gate = await requirePermission("commissions", "create");
  if (!gate.ok) return { error: gate.error };
  const id = String(taxId ?? "").trim();
  const rlLookup = await checkRateLimit(`einvoice-lookup:${gate.tenantId}`, { limit: 60, windowSec: 60, failurePolicy: "deny" });
  if (!rlLookup.allowed) return { error: RATE_MSG };
  if (!/^\d{10,11}$/.test(id)) return { error: "Vergi kimlik no (10 hane) ya da TC kimlik no (11 hane) girin." };
  const supabase = await createClient();
  const loaded = await loadAdapterForUser(supabase, gate.tenantId);
  if (!loaded.ok) return { error: adapterMessage(loaded.error) };
  const res = await loaded.value.adapter.lookupTaxpayer(id);
  if (!res.ok) return { error: adapterMessage(res.error) };
  return { ok: true, isEInvoiceUser: res.value.isEInvoiceUser, docType: res.value.isEInvoiceUser ? "e-fatura" : "e-arsiv" };
}

// ---------------------------------------------------------------------------
// Taslak
// ---------------------------------------------------------------------------

function parseLines(raw: string): EInvoiceLine[] | null {
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) return null;
    return parsed.map((l) => {
      const o = (l ?? {}) as Record<string, unknown>;
      return {
        description: String(o.description ?? "").trim().slice(0, 300),
        quantity: Number(o.quantity),
        unitPrice: Number(o.unitPrice),
        vatRate: Number(o.vatRate),
      };
    });
  } catch {
    return null;
  }
}

/** Taslağı kaydeder (yeni ya da düzenleme). Aynı kaynak+tür için ikinci taslak/fatura açılmaz. */
export async function saveInvoiceDraft(_prev: EInvoiceActionResult, formData: FormData): Promise<EInvoiceActionResult> {
  const gate = await requirePermission("commissions", "create");
  if (!gate.ok) return { error: gate.error };
  const rlDraft = await checkRateLimit(`einvoice-draft:${gate.tenantId}`, { limit: 30, windowSec: 60, failurePolicy: "deny" });
  if (!rlDraft.allowed) return { error: RATE_MSG };

  const sourceTypeRaw = text(formData, "source_type", 30);
  if (!(EINVOICE_SOURCE_TYPES as readonly string[]).includes(sourceTypeRaw)) return { error: "Fatura kaynağı geçerli değil." };
  const sourceType = sourceTypeRaw as EInvoiceSourceType;
  const sourceIdRaw = text(formData, "source_id", 60);
  if (sourceType !== "free" && !UUID_RE.test(sourceIdRaw)) return { error: "Fatura kaynağı bulunamadı." };
  const existingId = text(formData, "id", 60);
  if (existingId && !UUID_RE.test(existingId)) return { error: "Taslak bulunamadı." };

  const lines = parseLines(String(formData.get("lines") ?? "[]"));
  if (!lines) return { error: "Fatura kalemleri okunamadı; sayfayı yenileyip kalemleri yeniden girin." };
  const buyer = {
    name: text(formData, "buyer_name", 300),
    taxId: text(formData, "buyer_tax_id", 11).replace(/\s+/g, ""),
    taxOffice: text(formData, "buyer_tax_office", 120) || null,
    address: text(formData, "buyer_address", 500) || null,
    city: text(formData, "buyer_city", 100) || null,
    district: text(formData, "buyer_district", 100) || null,
  };
  const issueDate = text(formData, "issue_date", 10);
  const note = text(formData, "note", 500) || null;
  const valid = validateDraftInput({ buyer, lines, issueDate });
  if (!valid.ok) return { error: valid.error };

  const supabase = await createClient();
  const loaded = await loadAdapterForUser(supabase, gate.tenantId);
  if (!loaded.ok) return { error: adapterMessage(loaded.error) };
  const { adapter, connection } = loaded.value;

  // Kaynak doğrulaması (RLS): göremediği kayıttan fatura kesilemez; etiket kayıttan gelir.
  let sourceLabel: string | null = null;
  const sourceId = sourceType === "free" ? null : sourceIdRaw;
  if (sourceId) {
    const prefill = await loadSourcePrefill(supabase, sourceType, sourceId);
    if (!prefill) return { error: "Fatura kaynağı bulunamadı ya da erişiminiz yok." };
    sourceLabel = prefill.label.slice(0, 200);
  } else {
    sourceLabel = "Serbest fatura";
  }

  let existing: EInvoiceRow | null = null;
  if (existingId) {
    const { data } = await supabase.from("einvoices").select(EINVOICE_ROW_COLUMNS).eq("id", existingId).maybeSingle();
    existing = (data as unknown as EInvoiceRow | null) ?? null;
    if (!existing) return { error: "Taslak bulunamadı." };
    if (existing.status !== "draft") return { error: "Yalnız taslak fatura düzenlenebilir." };
  }

  const taxpayer = await adapter.lookupTaxpayer(buyer.taxId);
  if (!taxpayer.ok) return { error: `Alıcı sorgulanamadı. ${adapterMessage(taxpayer.error)}` };
  const docType = decideDocType(taxpayer.value.isEInvoiceUser);
  const totals = computeTotals(lines);
  const key = existing ? existing.idempotency_key : idempotencyKey(sourceType, sourceId, crypto.randomUUID());

  const payload = {
    connection_id: connection.id,
    provider: connection.provider,
    mode: connection.mode,
    source_type: sourceType,
    source_id: sourceId,
    source_label: sourceLabel,
    doc_type: docType,
    buyer_name: buyer.name,
    buyer_tax_id: buyer.taxId,
    buyer_tax_office: buyer.taxOffice,
    buyer_address: buyer.address,
    buyer_city: buyer.city,
    buyer_district: buyer.district,
    buyer_alias: taxpayer.value.alias ?? null,
    lines,
    net_total: totals.net,
    vat_total: totals.vat,
    gross_total: totals.gross,
    issue_date: issueDate,
    note,
    idempotency_key: key,
  };

  // Yazma yalnız DEFINER RPC (durum makinesi + kilit + audit): taslak değişince sağlayıcı kimliği sıfırlanır.
  const { data, error } = await supabase.rpc("einvoice_save_draft", { p_id: existing ? existing.id : null, p: payload });
  if (error) {
    if (error.code === "23505") return { error: "Bu kaynak için zaten bir fatura var. Faturalar sekmesinden açın." };
    return { error: rpcFailure(error, "Taslak kaydedilemedi.") };
  }
  const savedId = typeof data === "string" ? data : (existing?.id ?? "");
  refresh();
  if (existing) return { ok: true, id: savedId, message: "Taslak güncellendi." };
  return { ok: true, id: savedId, message: "Taslak kaydedildi. Kontrol edip resmileştirebilirsiniz." };
}

export async function deleteInvoiceDraft(id: string): Promise<EInvoiceActionResult> {
  const gate = await requirePermission("commissions", "create");
  if (!gate.ok) return { error: gate.error };
  if (!UUID_RE.test(id)) return { error: "Taslak bulunamadı." };
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("einvoice_delete_draft", { p_id: id });
  if (error) return { error: rpcFailure(error, "Taslak silinemedi.") };
  if (data !== true) return { error: "Yalnız sağlayıcıya hiç gönderilmemiş taslak silinebilir." };
  refresh();
  return { ok: true, message: "Taslak silindi." };
}

// ---------------------------------------------------------------------------
// Resmileştirme (GERİ ALINAMAZ), durum, iptal
// ---------------------------------------------------------------------------

async function loadRow(id: string, tenantId: string): Promise<EInvoiceRow | null> {
  const supabase = await createClient();
  const { data } = await supabase.from("einvoices").select(EINVOICE_ROW_COLUMNS).eq("id", id).eq("tenant_id", tenantId).maybeSingle();
  return (data as unknown as EInvoiceRow | null) ?? null;
}

/** Taslağı sağlayıcıda oluşturup resmileştirir. `confirmed` olmadan çalışmaz (geri alınamaz uyarısı onayı). */
export async function issueInvoice(id: string, confirmed: boolean): Promise<EInvoiceActionResult> {
  const gate = await requirePermission("commissions", "create");
  if (!gate.ok) return { error: gate.error };
  if (!UUID_RE.test(id)) return { error: "Fatura bulunamadı." };
  if (confirmed !== true) return { error: "Resmileştirmek için onay gerekli." };

  const supabase = await createClient();

  // 0) ATOMİK TALEP: sağlayıcı çağrısından ÖNCE. Satır dönmezse taslak değil ya da başka bir istek sürdürmektedir.
  const claim = await supabase.rpc("einvoice_claim_issue", { p_id: id });
  if (claim.error) return { error: rpcFailure(claim.error, "Resmileştirme başlatılamadı.") };
  const claimed = (Array.isArray(claim.data) ? claim.data[0] : claim.data) as EInvoiceRow | null | undefined;
  if (!claimed) {
    const existing = await loadRow(id, gate.tenantId);
    if (!existing) return { error: "Fatura bulunamadı." };
    if (existing.status !== "draft") return { error: "Yalnız taslak fatura resmileştirilebilir." };
    if (existing.issue_stage) return { error: UNCERTAIN };
    return { error: BUSY };
  }
  const row = claimed;

  const release = async (message: string) => {
    const { error: e } = await supabase.rpc("einvoice_record_progress", { p_id: row.id, p_error: message.slice(0, 500), p_release: true });
    if (e) console.error("issueInvoice release", e.code);
  };

  const loaded = await loadAdapterForUser(supabase, gate.tenantId);
  if (!loaded.ok) {
    await release(adapterMessage(loaded.error));
    return { error: adapterMessage(loaded.error) };
  }
  const { adapter, connection } = loaded.value;
  if (connection.provider !== row.provider) {
    const msg = "Bağlantı sağlayıcısı değişmiş. Taslağı yeniden kaydedin.";
    await release(msg);
    return { error: msg };
  }

  // 1) Sağlayıcıda taslak (daha önce oluşturulduysa atlanır; aynı UUID ile güvenli yeniden deneme)
  let ref = rowToRef(row);
  let number = row.number;
  if (!ref) {
    const created = await adapter.createDraft(rowToDraft(row));
    if (!created.ok) {
      await release(adapterMessage(created.error));
      return { error: adapterMessage(created.error) };
    }
    ref = created.value.ref;
    number = created.value.number ?? number;
    const saved = await supabase.rpc("einvoice_record_progress", { p_id: row.id, p_ref: ref, p_number: number });
    if (saved.error || saved.data !== true) {
      console.error("issueInvoice provider_ref", saved.error?.code);
      await release("Sağlayıcı kimliği kaydedilemedi, birazdan yeniden deneyin.");
      return { error: "Sağlayıcıda taslak oluştu ancak kayıt güncellenemedi. Birazdan yeniden deneyin." };
    }
  }
  // 2) Resmileştir. İSTEKTEN ÖNCE işaret: yanıt kaybolursa satır "sonucu doğrulanıyor" durumunda kalır, ikinci kez GÖNDERİLMEZ.
  const sent = await supabase.rpc("einvoice_mark_issue_sent", { p_id: row.id });
  if (sent.error || sent.data !== true) {
    console.error("issueInvoice mark_issue_sent", sent.error?.code);
    await release("Resmileştirme başlatılamadı, birazdan yeniden deneyin.");
    return { error: "Resmileştirme başlatılamadı, birazdan yeniden deneyin." };
  }
  const issued = await adapter.issue(ref);
  if (!issued.ok) {
    if (isAmbiguousIssueError(issued.error.code)) {
      // İstek işlenmiş olabilir: kilit/işaret KORUNUR; otomasyon (ve Durumu yenile) sağlayıcıda UUID ile arar.
      return { error: UNCERTAIN };
    }
    await release(adapterMessage(issued.error));
    return { error: adapterMessage(issued.error) };
  }
  const marked = await supabase.rpc("einvoice_mark_issued", { p_id: row.id, p_ref: issued.value.ref, p_number: issued.value.number ?? number });
  if (marked.error || marked.data !== true) {
    console.error("issueInvoice mark_issued", marked.error?.code);
    return { error: "Fatura sağlayıcıya gönderildi ancak kayıt güncellenemedi. Sayfayı yenileyip Durumu yenile ile sorgulayın." };
  }
  await logActivity({
    tenantId: gate.tenantId,
    actorId: gate.userId,
    action: "einvoice.issue",
    entityType: "einvoice",
    entityId: row.id,
    newValue: { provider: row.provider, mode: row.mode, doc_type: row.doc_type, gross_total: Number(row.gross_total), source_type: row.source_type },
  });
  refresh();
  return { ok: true, id: row.id, message: "Fatura resmileştirme için sağlayıcıya gönderildi. Sonucu Durumu yenile ile sorgulayın." };
}

/** Belirsiz resmileştirmeyi sağlayıcıdan kanıtla çözer (yalnız sorgu; ASLA yeniden göndermez). */
async function recoverUncertainIssue(row: EInvoiceRow, tenantId: string): Promise<EInvoiceActionResult> {
  if (!issueLockExpired(row)) return { error: UNCERTAIN };
  const supabase = await createClient();
  const loaded = await loadAdapterForUser(supabase, tenantId);
  if (!loaded.ok) return { error: adapterMessage(loaded.error) };
  if (loaded.value.connection.provider !== row.provider) return { error: "Bu fatura başka bir sağlayıcıyla kesilmiş; durum sorgulanamaz." };
  const res = await resolveIssueOutcome(loaded.value.adapter, row);
  if (res.outcome === "unknown") return { error: UNCERTAIN };
  const applied = await supabase.rpc("einvoice_recover_issue_mine", {
    p_id: row.id,
    p_outcome: res.outcome,
    p_ref: res.outcome === "sent" ? res.ref : null,
    p_number: res.outcome === "sent" ? res.number : null,
  });
  if (applied.error || applied.data !== true) return { error: rpcFailure(applied.error ?? {}, "Sonuç kaydedilemedi.") };
  refresh();
  return {
    ok: true,
    id: row.id,
    message:
      res.outcome === "sent"
        ? "Fatura sağlayıcıda bulundu ve resmileşme listesine alındı."
        : "Sağlayıcıda bu fatura için gönderim bulunmadı. İsterseniz yeniden resmileştirebilirsiniz.",
  };
}

/** Tek faturanın durumunu sağlayıcıdan sorar. */
export async function refreshInvoiceStatus(id: string): Promise<EInvoiceActionResult> {
  const gate = await requirePermission("commissions", "create");
  if (!gate.ok) return { error: gate.error };
  if (!UUID_RE.test(id)) return { error: "Fatura bulunamadı." };
  const row = await loadRow(id, gate.tenantId);
  if (!row) return { error: "Fatura bulunamadı." };
  const ref = rowToRef(row);
  if (row.status === "draft" && row.issue_stage === "issue_sent" && ref) return recoverUncertainIssue(row, gate.tenantId);
  if (row.status === "draft" || !ref) return { error: "Bu fatura henüz resmileştirilmedi." };
  if (row.status !== "issued") return { error: "Bu fatura için durum sorgulanamaz. Hatalıysa Taslağa çevirip yeniden deneyin." };
  const supabase = await createClient();
  const loaded = await loadAdapterForUser(supabase, gate.tenantId);
  if (!loaded.ok) return { error: adapterMessage(loaded.error) };
  if (loaded.value.connection.provider !== row.provider) return { error: "Bu fatura başka bir sağlayıcıyla kesilmiş; durum sorgulanamaz." };
  const res = await loaded.value.adapter.getStatus(ref);
  if (!res.ok) return { error: adapterMessage(res.error) };
  const patch = applyRemoteStatus(
    { status: row.status, provider_state: row.provider_state, number: row.number, error: row.error },
    res.value,
  );
  const saved = await supabase.rpc("einvoice_record_status", {
    p_id: row.id,
    p_status: patch.status,
    p_provider_state: patch.provider_state,
    p_number: patch.number,
    p_error: patch.error,
    p_ref: patch.provider_ref,
  });
  if (saved.error) return { error: rpcFailure(saved.error, "Durum kaydedilemedi.") };
  refresh();
  return { ok: true, message: "Durum güncellendi." };
}

/** Sağlayıcı reddetmiş (hata) faturayı düzeltip yeniden denemek üzere taslağa çevirir (yeni sağlayıcı kimliğiyle). */
export async function reopenInvoice(id: string): Promise<EInvoiceActionResult> {
  const gate = await requirePermission("commissions", "create");
  if (!gate.ok) return { error: gate.error };
  if (!UUID_RE.test(id)) return { error: "Fatura bulunamadı." };
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("einvoice_reopen", { p_id: id });
  if (error) return { error: rpcFailure(error, "Fatura taslağa çevrilemedi.") };
  if (data !== true) return { error: "Fatura taslağa çevrilemedi." };
  refresh();
  return { ok: true, id, message: "Taslağa çevrildi. Düzeltip yeniden resmileştirebilirsiniz." };
}

/** İptal (yalnız sağlayıcı destekliyorsa; Nilvera e-Arşiv). Desteklenmiyorsa açık hata döner. */
export async function cancelInvoice(id: string, reason: string): Promise<EInvoiceActionResult> {
  const gate = await requirePermission("commissions", "create");
  if (!gate.ok) return { error: gate.error };
  if (!UUID_RE.test(id)) return { error: "Fatura bulunamadı." };
  const cleanReason = String(reason ?? "").trim().slice(0, 300);
  if (!cleanReason) return { error: "İptal nedenini yazın." };
  const row = await loadRow(id, gate.tenantId);
  if (!row) return { error: "Fatura bulunamadı." };
  const ref = rowToRef(row);
  if (row.status !== "issued" || !ref) return { error: "Yalnız resmileşmiş fatura iptal edilebilir." };
  const supabase = await createClient();
  const loaded = await loadAdapterForUser(supabase, gate.tenantId);
  if (!loaded.ok) return { error: adapterMessage(loaded.error) };
  const { adapter } = loaded.value;
  if (!adapter.cancel || !adapter.capabilities.cancelDocTypes.includes(row.doc_type)) {
    return { error: "Bu sağlayıcıda bu belge türü API ile iptal edilemiyor. İptal/iade işlemini sağlayıcı panelinden yapın." };
  }
  const res = await adapter.cancel(ref, cleanReason);
  if (!res.ok) return { error: adapterMessage(res.error) };
  const marked = await supabase.rpc("einvoice_mark_cancelled", { p_id: row.id, p_reason: cleanReason });
  if (marked.error || marked.data !== true) {
    console.error("cancelInvoice mark_cancelled", marked.error?.code);
    return { error: "İptal sağlayıcıda yapıldı ancak kayıt güncellenemedi. Durumu yenile ile sorgulayın." };
  }
  await logActivity({
    tenantId: gate.tenantId,
    actorId: gate.userId,
    action: "einvoice.cancel",
    entityType: "einvoice",
    entityId: row.id,
    newValue: { provider: row.provider, reason: cleanReason },
  });
  refresh();
  return { ok: true, message: "Fatura iptal edildi." };
}
