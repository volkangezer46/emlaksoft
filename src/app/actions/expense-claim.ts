"use server";

import { revalidatePath } from "next/cache";
import { afterSafe } from "@/lib/after-safe";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { requirePermission } from "@/lib/require-permission";
import { notifyTenant } from "@/lib/notify";
import { checkRateLimit } from "@/lib/rate-limit";
import { parseMoneyInput } from "@/lib/money-input";
import { formatTryDecimal } from "@/lib/format";
import {
  EXPENSE_CLAIM_BUCKET,
  EXPENSE_CLAIM_HREF,
  expenseClaimOutcomeMessage,
  isExpenseClaimCategory,
  isOwnReceiptPath,
  receiptExtension,
  validateReceiptFile,
} from "@/lib/finance/expense-claim";

/**
 * "Masraf bildir" (WP2, sahip kararı) — danışman iş masrafını fişiyle bildirir; talep Onaylar'a düşer, onaylanınca
 * danışmana ödenecek açık kalem olarak ofis defterine işlenir (DB tetiği). Kapı: oturum + yazma (salt okunur ve destek
 * oturumu reddedilir); ofis defterine doğrudan yazma (expenses:create) GEREKMEZ, çünkü kayıt bir talep olarak açılır.
 * Fiş baytı sunucudan geçmez: tek nesnelik imzalı yükleme jetonu (prepare) → tarayıcı yükler → bildirimde bayt imzası
 * sunucuda doğrulanır, uyuşmayan dosya silinir.
 */

export type ExpenseClaimUpload = { ok: true; path: string; token: string; bucket: string; contentType: string } | { ok: false; error: string };
export type ExpenseClaimResult = { ok?: boolean; error?: string; id?: string };

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const NOT_READY = "Masraf bildirimi bu ofiste henüz etkin değil (veritabanı güncellemesi bekleniyor).";

function isMissingSchema(error: { code?: string | null; message?: string | null } | null | undefined): boolean {
  if (!error) return false;
  return error.code === "PGRST202" || error.code === "42883" || error.code === "42P01" || /expense_claim/i.test(error.message ?? "");
}

/** Fiş için tek nesnelik imzalı yükleme jetonu. */
export async function prepareExpenseClaimReceipt(input: { fileSize: number; fileType: string }): Promise<ExpenseClaimUpload> {
  const gate = await requirePermission("dashboard", "view", { write: true });
  if (!gate.ok) return { ok: false, error: gate.error };
  const check = validateReceiptFile({ size: Number(input?.fileSize) || 0, type: String(input?.fileType ?? "") });
  if (!check.ok) return { ok: false, error: check.error };
  const rl = await checkRateLimit(`expense-claim-upload:${gate.userId}`, { limit: 20, windowSec: 600, failurePolicy: "deny" });
  if (!rl.allowed) return { ok: false, error: "Çok sık fiş yüklendi; birkaç dakika sonra tekrar deneyin." };
  const path = `${gate.tenantId}/${gate.userId}/${crypto.randomUUID()}.${check.ext}`;
  const admin = createAdminClient();
  const { data, error } = await admin.storage.from(EXPENSE_CLAIM_BUCKET).createSignedUploadUrl(path, { upsert: false });
  if (error || !data?.token || data.path !== path) {
    return { ok: false, error: "Güvenli yükleme bağlantısı oluşturulamadı; birkaç saniye sonra fişi yeniden seçin." };
  }
  return { ok: true, path, token: data.token, bucket: EXPENSE_CLAIM_BUCKET, contentType: check.mime };
}

/** Dosyanın ilk baytları bildirilen türle uyuşuyor mu (uzantı/MIME taklidine karşı). */
function signatureMatches(bytes: Uint8Array, ext: string): boolean {
  const at = (i: number, ...v: number[]) => v.every((b, k) => bytes[i + k] === b);
  const ascii = (i: number, s: string) => at(i, ...[...s].map((c) => c.charCodeAt(0)));
  switch (ext) {
    case "jpg":
      return at(0, 0xff, 0xd8, 0xff);
    case "png":
      return at(0, 0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a);
    case "webp":
      return ascii(0, "RIFF") && ascii(8, "WEBP");
    case "pdf":
      return ascii(0, "%PDF-");
    case "heic":
      return ascii(4, "ftyp") && ["heic", "heix", "hevc", "mif1", "msf1"].some((b) => ascii(8, b));
    default:
      return false;
  }
}

/** Masraf bildirimi: fiş doğrulanır, talep + onay satırı TEK RPC ile açılır, karar yetkilileri bilgilendirilir. */
export async function submitExpenseClaim(_prev: ExpenseClaimResult, fd: FormData): Promise<ExpenseClaimResult> {
  const gate = await requirePermission("dashboard", "view", { write: true });
  if (!gate.ok) return { error: gate.error };

  const amount = parseMoneyInput(fd.get("amount"), { max: 9_999_999_999 });
  if (!amount.ok || amount.value == null || amount.value <= 0) return { error: "Geçerli bir masraf tutarı girin." };
  const spentOn = String(fd.get("spent_on") ?? "").trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(spentOn)) return { error: "Harcama gününü seçin." };
  const category = String(fd.get("category") ?? "").trim();
  if (!isExpenseClaimCategory(category)) return { error: "Masraf türünü seçin." };
  const description = String(fd.get("description") ?? "").replace(/\s+/g, " ").trim();
  if (description.length < 3) return { error: "Masrafı kısaca açıklayın (en az 3 harf)." };
  if (description.length > 300) return { error: "Açıklama en fazla 300 karakter olabilir." };
  const receiptPath = String(fd.get("receipt_path") ?? "").trim();
  if (!receiptPath) return { error: "Fişin fotoğrafını ekleyin." };
  if (!isOwnReceiptPath(receiptPath, gate.tenantId, gate.userId)) return { error: expenseClaimOutcomeMessage("invalid_receipt") };
  const ext = receiptPath.split(".").pop()!.toLowerCase();
  const mime = Object.entries({ jpg: "image/jpeg", png: "image/png", webp: "image/webp", heic: "image/heic", pdf: "application/pdf" }).find(([e]) => e === ext)?.[1];
  if (!mime || receiptExtension(mime) !== ext) return { error: expenseClaimOutcomeMessage("invalid_receipt") };
  const propertyId = String(fd.get("property_id") ?? "").trim();
  const dealId = String(fd.get("deal_id") ?? "").trim();
  if ((propertyId && !UUID_RE.test(propertyId)) || (dealId && !UUID_RE.test(dealId))) return { error: expenseClaimOutcomeMessage("invalid_input") };

  const rl = await checkRateLimit(`expense-claim-submit:${gate.userId}`, { limit: 30, windowSec: 3600, failurePolicy: "deny" });
  if (!rl.allowed) return { error: "Çok sık masraf bildirildi; bir süre sonra tekrar deneyin." };

  // Bayt imzası: yalnız ilk baytlar okunur; uyuşmayan dosya silinir (kovada sahte "fiş" kalmaz).
  const admin = createAdminClient();
  const { data: blob, error: dlError } = await admin.storage.from(EXPENSE_CLAIM_BUCKET).download(receiptPath);
  if (dlError || !blob) return { error: expenseClaimOutcomeMessage("receipt_missing") };
  const head = new Uint8Array(await blob.slice(0, 16).arrayBuffer());
  if (!signatureMatches(head, ext)) {
    await admin.storage.from(EXPENSE_CLAIM_BUCKET).remove([receiptPath]);
    return { error: "Fiş dosyası okunamadı (fotoğraf ya da PDF değil). Fişin fotoğrafını yeniden çekin." };
  }

  const supabase = await createClient();
  const { data, error } = await supabase.rpc("expense_claim_submit", {
    p: {
      amount: amount.value,
      spent_on: spentOn,
      category,
      description,
      receipt_path: receiptPath,
      receipt_mime: mime,
      property_id: propertyId || null,
      deal_id: dealId || null,
    },
  });
  if (error) {
    console.error("submitExpenseClaim", { code: error.code });
    return { error: isMissingSchema(error) ? NOT_READY : expenseClaimOutcomeMessage("error") };
  }
  const result = (data ?? {}) as { outcome?: string; claim_id?: string; approval_id?: string };
  if (result.outcome !== "created" || !result.claim_id) return { error: expenseClaimOutcomeMessage(String(result.outcome ?? "error")) };

  const tenantId = gate.tenantId;
  const actorId = gate.userId;
  const claimId = result.claim_id;
  const tl = formatTryDecimal(amount.value);
  afterSafe(async () => {
    // Karar yetkilisi varsayılan olarak ofis sahibi ve genel müdür; iş akışını bloklayan karar isteği (tercih anahtarı yok).
    const { data: managers } = await supabase
      .from("profiles")
      .select("id")
      .eq("tenant_id", tenantId)
      .eq("is_active", true)
      .in("role", ["owner", "gm"]);
    await Promise.all(
      (managers ?? [])
        .filter((m) => m.id !== actorId)
        .map((m) =>
          notifyTenant({
            tenantId,
            userId: m.id as string,
            title: `Onay bekliyor: masraf ${tl}`,
            body: description,
            href: "/app/onaylar?durum=bekliyor",
            kind: "warning",
          }),
        ),
    );
  }, "expense_claim.notify_deciders");

  revalidatePath(EXPENSE_CLAIM_HREF);
  revalidatePath("/app/onaylar");
  return { ok: true, id: claimId };
}

/** Fiş önizlemesi: talebi GÖREBİLEN (RLS: talep sahibi, muhasebe, karar yetkilisi) için 5 dakikalık imzalı bağlantı. */
export async function expenseClaimReceiptUrl(claimId: string): Promise<{ ok: true; url: string } | { ok: false; error: string }> {
  const gate = await requirePermission("dashboard", "view");
  if (!gate.ok) return { ok: false, error: gate.error };
  if (!UUID_RE.test(String(claimId ?? ""))) return { ok: false, error: "Masraf bildirimi bulunamadı." };
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("expense_claims")
    .select("id, receipt_path")
    .eq("id", claimId)
    .eq("tenant_id", gate.tenantId)
    .maybeSingle();
  if (error && isMissingSchema(error)) return { ok: false, error: NOT_READY };
  if (!data || !String(data.receipt_path).startsWith(`${gate.tenantId}/`)) return { ok: false, error: "Masraf bildirimi bulunamadı." };
  const admin = createAdminClient();
  const { data: signed, error: signError } = await admin.storage.from(EXPENSE_CLAIM_BUCKET).createSignedUrl(String(data.receipt_path), 300);
  if (signError || !signed?.signedUrl) return { ok: false, error: "Fiş bağlantısı oluşturulamadı; sayfayı yenileyip tekrar deneyin." };
  return { ok: true, url: signed.signedUrl };
}
