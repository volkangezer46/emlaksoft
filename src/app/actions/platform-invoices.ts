"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { randomBytes } from "crypto";
import { afterSafe } from "@/lib/after-safe";
import { requirePlatformModule } from "@/lib/platform";
import { logPlatformActivity } from "@/lib/platform-activity";
import { checkRateLimit } from "@/lib/rate-limit";
import { createAdminClient } from "@/lib/supabase/admin";
import { getSetting } from "@/lib/settings/read";
import { getBillingVatRate } from "@/lib/billing/vat-rate";
import { sendEmail } from "@/lib/email/provider";
import { INVOICE_STATUS_LABELS } from "@/lib/accounting/ledger";
import { now as clockNow } from "@/lib/clock";
import {
  MANUAL_INVOICE_CATEGORIES,
  buildInvoiceEmail,
  buildManualLines,
  canIssueManual,
  fromRawLine,
  linesToRpc,
  manualDueIso,
  synthesizeLine,
  type ManualLineInput,
  type RawInvoiceLine,
} from "@/lib/billing/manual-invoice";

/**
 * AD2 — elle fatura / tek seferlik ücret ve fatura e-postası. `platform-billing.ts` (ödeme/iade/iptal) DEĞİŞMEZ:
 * iade kaydı orada kalır; her iade kaydı DB tetikleyicisiyle numaralı alacak dekontu üretir (20261013004100).
 * Kapı: billing modülü (billing rolü dahil); taslak oluşturma/kesme/silme yıkıcı değildir (tahsilat yapmaz).
 */
export type InvoiceOpResult = { ok?: boolean; error?: string; notice?: string; id?: string };

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** RPC/tablo henüz yok (migration uygulanmadı) mı? */
function schemaMissing(error: { code?: string; message?: string } | null | undefined): boolean {
  const code = error?.code ?? "";
  return code === "PGRST202" || code === "PGRST205" || code === "42883" || code === "42P01";
}

function refresh(invoiceId?: string) {
  revalidatePath("/admin/billing");
  revalidatePath("/admin/billing/muhasebe");
  if (invoiceId) revalidatePath(`/admin/billing/faturalar/${invoiceId}`);
}

/** Elle fatura / tek seferlik ücret TASLAĞI: satırlar + güncel KDV oranı (ayar defteri). Abonelik bağı yok → MRR'a girmez. */
export async function createManualInvoice(formData: FormData): Promise<InvoiceOpResult> {
  const staff = await requirePlatformModule("billing");
  const rl = await checkRateLimit(`billing-op:manual-invoice:${staff.id}`, { limit: 30, windowSec: 600, failurePolicy: "deny" });
  if (!rl.allowed) return { error: "Çok sık işlem yaptınız; birkaç dakika sonra tekrar deneyin." };

  const tenantId = String(formData.get("tenant_id") ?? "");
  if (!UUID.test(tenantId)) return { error: "Ofis seçin." };
  const category = String(formData.get("category") ?? "");
  if (!MANUAL_INVOICE_CATEGORIES.some((c) => c.value === category)) return { error: "Fatura türünü seçin." };
  const note = String(formData.get("note") ?? "").trim().slice(0, 500);

  let inputs: ManualLineInput[] = [];
  try {
    const parsed = JSON.parse(String(formData.get("lines") ?? "[]")) as unknown;
    if (!Array.isArray(parsed)) throw new Error("lines");
    inputs = parsed.slice(0, 60).map((l) => {
      const r = (l && typeof l === "object" ? l : {}) as Record<string, unknown>;
      return { description: String(r.description ?? ""), quantity: String(r.quantity ?? ""), unitNet: String(r.unitNet ?? "") };
    });
  } catch {
    return { error: "Kalemler okunamadı; sayfayı yenileyip kalemleri yeniden girin." };
  }

  const nowMs = clockNow();
  const vatRate = await getBillingVatRate(nowMs);
  const built = buildManualLines(inputs, vatRate);
  if ("error" in built) return { error: built.error };

  const invoiceNo = `ES-MAN-${tenantId.replace(/-/g, "").slice(0, 6).toUpperCase()}-${randomBytes(5).toString("hex").toUpperCase()}`;
  const admin = createAdminClient();
  const { data, error } = await admin.rpc("platform_create_manual_invoice", {
    p_tenant_id: tenantId,
    p_invoice_no: invoiceNo,
    p_lines: linesToRpc(built.lines),
    p_meta: {
      manual_invoice: { category, note: note || null, vat_rate: vatRate, created_by: staff.id, created_at: new Date(nowMs).toISOString() },
      source: "admin_manual",
    },
  });
  if (error) {
    if (schemaMissing(error)) return { error: "Elle fatura kurulum bekliyor (veritabanı güncellemesi 20261013004100 uygulanmadı)." };
    console.error("createManualInvoice", error.code, error.message);
    return { error: error.message?.includes("manual_invoice_tenant") ? "Ofis bulunamadı." : "Taslak fatura oluşturulamadı; birkaç dakika sonra tekrar deneyin." };
  }
  const id = String(data ?? "");
  if (!UUID.test(id)) return { error: "Taslak fatura oluşturulamadı; birkaç dakika sonra tekrar deneyin." };
  // SK6/B037: denetim kaydı yanıttan SONRA (after); listeler revalidate edilir ve yönlendirme AYNI yanıtta döner
  // (istemci router.push + ek RSC turları yok).
  const snapshot = { tenantId, invoiceNo, category, lines: built.lines.length, vatRate };
  afterSafe(
    () => logPlatformActivity({ actorId: staff.id, action: "billing.invoice.manual_draft", entityType: "invoice", entityId: id, meta: snapshot }),
    "billing.invoice.manual_draft",
  );
  refresh(id);
  redirect(`/admin/billing/faturalar/${id}`);
}

/**
 * Taslak > kesildi: durum "open", vade = kesim + `billing.manual_invoice_due_days`. Taslağın KDV oranı kesim günündeki
 * orandan farklıysa kesim reddedilir (eski oranla fatura kesilmez; taslak silinip yeniden hazırlanır).
 */
export async function issueManualInvoice(formData: FormData): Promise<InvoiceOpResult> {
  const staff = await requirePlatformModule("billing");
  const invoiceId = String(formData.get("invoice_id") ?? "");
  if (!UUID.test(invoiceId)) return { error: "Geçersiz fatura." };

  const admin = createAdminClient();
  const { data: inv } = await admin
    .from("invoices")
    .select("id, tenant_id, invoice_no, status, checkout_status, total_try, meta")
    .eq("id", invoiceId)
    .maybeSingle();
  if (!inv) return { error: "Fatura bulunamadı." };
  if (inv.status !== "draft") return { ok: true, notice: "Fatura zaten kesilmiş." };
  if (!canIssueManual(inv)) return { error: "Yalnız elle hazırlanmış taslak fatura buradan kesilir." };

  const meta = (inv.meta ?? {}) as Record<string, unknown>;
  const manual = (meta.manual_invoice ?? {}) as Record<string, unknown>;
  const nowMs = clockNow();
  const [rateNow, dueDays] = await Promise.all([getBillingVatRate(nowMs), getSetting<number>("billing.manual_invoice_due_days").catch(() => 14)]);
  const draftRate = Number(manual.vat_rate);
  if (Number.isFinite(draftRate) && Math.abs(draftRate - rateNow) > 0.00001) {
    return {
      error: `Taslak %${Math.round(draftRate * 10000) / 100} KDV ile hazırlandı; bugün geçerli oran %${Math.round(rateNow * 10000) / 100}. Taslağı silip yeniden oluşturun.`,
    };
  }

  const issuedAt = new Date(nowMs).toISOString();
  const { data: updated, error } = await admin
    .from("invoices")
    .update({
      status: "open",
      due_at: manualDueIso(nowMs, Number(dueDays)),
      meta: { ...meta, manual_invoice: { ...manual, issued_at: issuedAt, issued_by: staff.id } },
    })
    .eq("id", invoiceId)
    .eq("status", "draft")
    .is("checkout_status", null)
    .select("id")
    .maybeSingle();
  if (error) {
    console.error("issueManualInvoice", error.code, error.message);
    return { error: "Fatura kesilemedi; sayfayı yenileyip tekrar deneyin." };
  }
  if (!updated) return { ok: true, notice: "Fatura başka bir işlemle zaten güncellenmiş." };
  await logPlatformActivity({
    actorId: staff.id,
    action: "billing.invoice.manual_issued",
    entityType: "invoice",
    entityId: invoiceId,
    meta: { tenantId: inv.tenant_id, invoiceNo: inv.invoice_no, totalTry: Number(inv.total_try), dueDays: Number(dueDays) },
  });
  refresh(invoiceId);
  return { ok: true, notice: "Fatura kesildi; ofisin Abonelik ekranında ve tahsilat listelerinde görünür." };
}

/** Kesilmemiş elle taslağı siler (satırlar birlikte silinir). Kesilmiş fatura silinmez: iptal/iade kullanılır. */
export async function deleteManualDraft(formData: FormData): Promise<InvoiceOpResult> {
  const staff = await requirePlatformModule("billing");
  const invoiceId = String(formData.get("invoice_id") ?? "");
  if (!UUID.test(invoiceId)) return { error: "Geçersiz fatura." };

  const admin = createAdminClient();
  const { data: deleted, error } = await admin
    .from("invoices")
    .delete()
    .eq("id", invoiceId)
    .eq("status", "draft")
    .is("checkout_status", null)
    .eq("meta->>kind", "one_time")
    .not("meta->manual_invoice", "is", null)
    .select("id, tenant_id, invoice_no")
    .maybeSingle();
  if (error) {
    console.error("deleteManualDraft", error.code, error.message);
    return { error: "Taslak silinemedi; sayfayı yenileyip tekrar deneyin." };
  }
  if (!deleted) return { error: "Yalnız kesilmemiş elle taslak silinebilir." };
  await logPlatformActivity({
    actorId: staff.id,
    action: "billing.invoice.manual_draft_deleted",
    entityType: "invoice",
    entityId: invoiceId,
    meta: { tenantId: deleted.tenant_id, invoiceNo: deleted.invoice_no },
  });
  refresh();
  return { ok: true, notice: "Taslak silindi." };
}

/**
 * Faturayı ofis sahibine e-postayla (yeniden) gönderir. E-posta kanalı kapalıysa (Resend anahtarı/gönderen yok) hiçbir
 * istek atılmaz; deneme denetim kaydına "kanal kapalı" olarak düşer ve ekran bunu söyler (sahte gönderim yok).
 */
export async function sendInvoiceEmail(formData: FormData): Promise<InvoiceOpResult> {
  const staff = await requirePlatformModule("billing");
  const rl = await checkRateLimit(`billing-op:invoice-email:${staff.id}`, { limit: 20, windowSec: 600, failurePolicy: "deny" });
  if (!rl.allowed) return { error: "Çok sık gönderim; birkaç dakika sonra tekrar deneyin." };
  const invoiceId = String(formData.get("invoice_id") ?? "");
  if (!UUID.test(invoiceId)) return { error: "Geçersiz fatura." };

  const admin = createAdminClient();
  const { data: inv } = await admin
    .from("invoices")
    .select("id, tenant_id, invoice_no, status, amount_try, tax_try, total_try, due_at, meta, tenant:tenants(name)")
    .eq("id", invoiceId)
    .maybeSingle();
  if (!inv) return { error: "Fatura bulunamadı." };
  if (inv.status === "draft") return { error: "Taslak fatura gönderilmez; önce kesin." };

  const [{ data: owner }, { data: lineRows, error: lineError }] = await Promise.all([
    admin
      .from("profiles")
      .select("email")
      .eq("tenant_id", inv.tenant_id)
      .eq("role", "owner")
      .eq("is_active", true)
      .not("email", "is", null)
      .order("created_at", { ascending: true })
      .limit(1)
      .maybeSingle(),
    admin
      .from("invoice_lines")
      .select("position, description, quantity, unit_net_try, vat_rate, net_try, tax_try, total_try")
      .eq("invoice_id", invoiceId)
      .eq("tenant_id", inv.tenant_id)
      .order("position", { ascending: true }),
  ]);
  const to = typeof owner?.email === "string" ? owner.email : "";
  if (!to) return { error: "Ofisin etkin sahip (owner) e-posta adresi yok." };

  const tenant = Array.isArray(inv.tenant) ? inv.tenant[0] : inv.tenant;
  const lines = !lineError && lineRows && lineRows.length > 0 ? (lineRows as unknown as RawInvoiceLine[]).map(fromRawLine) : [synthesizeLine(inv)];
  const mail = buildInvoiceEmail({
    invoiceNo: inv.invoice_no,
    tenantName: (tenant as { name?: string } | null)?.name ?? "",
    lines,
    amountTry: Number(inv.amount_try),
    taxTry: Number(inv.tax_try),
    totalTry: Number(inv.total_try),
    dueLabel: inv.due_at ? new Intl.DateTimeFormat("tr-TR", { dateStyle: "long", timeZone: "Europe/Istanbul" }).format(new Date(inv.due_at)) : null,
    statusLabel: INVOICE_STATUS_LABELS[inv.status] ?? inv.status,
  });
  const res = await sendEmail({ to, subject: mail.subject, text: mail.text });
  await logPlatformActivity({
    actorId: staff.id,
    action: res.ok ? "billing.invoice.email_sent" : "billing.invoice.email_skipped",
    entityType: "invoice",
    entityId: invoiceId,
    meta: { tenantId: inv.tenant_id, invoiceNo: inv.invoice_no, result: res.ok ? "gönderildi" : res.code === "disabled" ? "kanal kapalı" : res.code, error: res.ok ? null : res.error },
  });
  if (!res.ok) {
    if (res.code === "disabled") return { error: `E-posta kanalı kapalı: ${res.error}. Gönderim yapılmadı (denetim kaydına düştü).` };
    return { error: `E-posta gönderilemedi (${res.error}).` };
  }
  refresh(invoiceId);
  return { ok: true, notice: "Fatura e-postayla gönderildi." };
}
