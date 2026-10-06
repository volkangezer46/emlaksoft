"use server";

import { revalidatePath } from "next/cache";
import { requirePlatformModule, type PlatformStaff } from "@/lib/platform";
import { logPlatformActivity } from "@/lib/platform-activity";
import { checkRateLimit } from "@/lib/rate-limit";
import { createAdminClient } from "@/lib/supabase/admin";
import { now } from "@/lib/clock";
import { TRY_WALLET_LINKS } from "@/lib/try-credits/config";
import { tryGrant, tryReverse } from "@/lib/try-credits/wallet";
import { parseAdminGrantInput, parseAdminReverseInput } from "@/lib/try-credits/admin-credit-input";

/**
 * Platform yöneticisi: ofise TL hesap kredisi yükle / geri al (ekran başka ajanın /admin alanında bağlanır).
 *
 * Kapı: platform personeli + "billing" modülü + YALNIZ süper admin. TL kredi RPC'leri service_role ister; bu yüzden
 * service_role istemcisi YALNIZ bu iki action'da, gerekçeli kabul listesi satırıyla kullanılır.
 * Denetim ÖNCE yazılır (fail-closed): platform_audit_logs satırı yazılamazsa kredi işlemi YAPILMAZ. Sonuç ayrıca kaydedilir.
 * Çift gönderim: form `request_id` (uuid) -> defter idem anahtarı; aynı istek ikinci kez yeni kayıt yazmaz.
 * Kişisel veri yazılmaz: defter meta'sına yalnız personel kimliği ve kaynak; serbest metin neden yalnız platform denetiminde.
 */

export type AdminCreditResult = { ok?: boolean; error?: string; message?: string; already?: boolean };

const DENIED = "Hesap kredisi işlemlerini yalnız süper admin yapabilir.";

/** Süper admin + hız sınırı (platform kapısı her action gövdesinde ayrıca çağrılır). */
async function superAdminOnly(staff: PlatformStaff) {
  if (staff.role !== "super_admin") return { error: DENIED } as const;
  const { allowed } = await checkRateLimit(`admin-try-credit:${staff.id}`, { limit: 30, windowSec: 3600, failurePolicy: "deny" });
  if (!allowed) return { error: "Çok fazla kredi işlemi yapıldı. Bir saat sonra tekrar deneyin." } as const;
  return { staff } as const;
}

function money(n: number): string {
  return `${n.toLocaleString("tr-TR", { minimumFractionDigits: 0, maximumFractionDigits: 2 })} TL`;
}

/** Ofise TL hesap kredisi yükler. Alanlar: tenant_id, amount, reason, request_id, kind?, expires_on? (YYYY-MM-DD). */
export async function grantAccountCredit(formData: FormData): Promise<AdminCreditResult> {
  const g = await superAdminOnly(await requirePlatformModule("billing"));
  if ("error" in g) return { error: g.error };
  const parsed = parseAdminGrantInput(formData, now());
  if (!parsed.ok) return { error: parsed.error };
  const input = parsed.value;

  const admin = createAdminClient();
  const { data: tenant } = await admin.from("tenants").select("id").eq("id", input.tenantId).maybeSingle();
  if (!tenant) return { error: "Ofis bulunamadı." };

  const { error: auditError } = await admin.from("platform_audit_logs").insert({
    actor_id: g.staff.id,
    action: "tenant.try_credit_grant",
    entity_type: "tenant",
    entity_id: input.tenantId,
    meta: { amount_try: input.amountTry, kind: input.kind, idem: input.idem, expires_at: input.expiresAt, reason: input.reason },
  });
  if (auditError) {
    console.error("grantAccountCredit audit", auditError.code);
    return { error: "Denetim kaydı yazılamadığı için kredi yüklenmedi. Tekrar deneyin." };
  }

  const res = await tryGrant(admin, {
    tenantId: input.tenantId,
    amountTry: input.amountTry,
    kind: input.kind,
    idem: input.idem,
    expiresAt: input.expiresAt,
    meta: { source: "admin", staff_id: g.staff.id },
  });
  await logPlatformActivity({
    actorId: g.staff.id,
    action: res ? "tenant.try_credit_grant.done" : "tenant.try_credit_grant.failed",
    entityType: "tenant",
    entityId: input.tenantId,
    meta: { idem: input.idem, already: res?.already ?? null, balance: res?.balance ?? null },
  });
  if (!res) return { error: "Kredi yüklenemedi: cüzdan hazır değil ya da işlem reddedildi." };

  revalidatePath("/admin/billing");
  revalidatePath(TRY_WALLET_LINKS.wallet.split("?")[0]!);
  if (res.already) return { ok: true, already: true, message: "Bu istek daha önce işlenmiş; yeni kredi yazılmadı." };
  return { ok: true, message: `${money(input.amountTry)} hesap kredisi yüklendi. Ofisin kullanılabilir bakiyesi: ${money(res.available)}.` };
}

/** Ofisin TL hesap kredisini geri alır (clawback; bakiye eksiye düşebilir, eksi bakiye harcanamaz). */
export async function reverseAccountCredit(formData: FormData): Promise<AdminCreditResult> {
  const g = await superAdminOnly(await requirePlatformModule("billing"));
  if ("error" in g) return { error: g.error };
  const parsed = parseAdminReverseInput(formData);
  if (!parsed.ok) return { error: parsed.error };
  const input = parsed.value;

  const admin = createAdminClient();
  const { data: tenant } = await admin.from("tenants").select("id").eq("id", input.tenantId).maybeSingle();
  if (!tenant) return { error: "Ofis bulunamadı." };

  const { error: auditError } = await admin.from("platform_audit_logs").insert({
    actor_id: g.staff.id,
    action: "tenant.try_credit_reverse",
    entity_type: "tenant",
    entity_id: input.tenantId,
    meta: { amount_try: input.amountTry, idem: input.idem, original_idem: input.originalIdem, reason: input.reason },
  });
  if (auditError) {
    console.error("reverseAccountCredit audit", auditError.code);
    return { error: "Denetim kaydı yazılamadığı için geri alma yapılmadı. Tekrar deneyin." };
  }

  const res = await tryReverse(admin, {
    tenantId: input.tenantId,
    amountTry: input.amountTry,
    reason: "admin_reverse",
    idem: input.idem,
    originalIdem: input.originalIdem,
    meta: { source: "admin", staff_id: g.staff.id },
  });
  await logPlatformActivity({
    actorId: g.staff.id,
    action: res?.ok ? "tenant.try_credit_reverse.done" : "tenant.try_credit_reverse.failed",
    entityType: "tenant",
    entityId: input.tenantId,
    meta: { idem: input.idem, code: res && !res.ok ? res.code : null },
  });
  if (!res) return { error: "Kredi geri alınamadı: cüzdan hazır değil ya da işlem reddedildi." };
  if (!res.ok) {
    return {
      error:
        res.code === "original_not_found"
          ? "Geri alınacak yükleme bulunamadı (anahtarı kontrol edin)."
          : `Geri alma tutarı yüklemenin kalanını aşıyor${res.remaining != null ? ` (kalan ${money(res.remaining)})` : ""}.`,
    };
  }

  revalidatePath("/admin/billing");
  revalidatePath(TRY_WALLET_LINKS.wallet.split("?")[0]!);
  if (res.already) return { ok: true, already: true, message: "Bu istek daha önce işlenmiş; yeni geri alma yazılmadı." };
  return { ok: true, message: `${money(input.amountTry)} hesap kredisi geri alındı. Güncel bakiye: ${money(res.balance)}.` };
}
