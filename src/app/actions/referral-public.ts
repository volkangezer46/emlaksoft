"use server";

import { revalidatePath } from "next/cache";
import { createAdminClient } from "@/lib/supabase/admin";
import { checkRateLimit, clientIp } from "@/lib/rate-limit";
import { notifyTenant } from "@/lib/notify";
import { parsePhone, PHONE_ERROR_MESSAGE } from "@/lib/phone";
import { isPublicTenantActive } from "@/lib/public-tenant";

export type PublicReferralResult = {
  ok?: boolean;
  error?: string;
  /** Aynı kişi bu linkten daha önce iletilmişse true — teşekkür ekranı yine gösterilir. */
  alreadySent?: boolean;
};

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Tavsiye formu (/tavsiye/[token] public sayfası).
 *
 * Auth YOK — public_token yeterli (registerOpenHouseVisitorByToken deseni).
 * RLS anon'a açılmadığı için service role ile yazılır.
 *
 * KVKK: burada işlenen veri FORMU DOLDURANIN değil, TAVSİYE EDİLEN üçüncü
 * kişinin verisidir. Bu yüzden onay kutusu metni "tanıdığımın bilgisini
 * paylaşıyorum ve haberi var" beyanıdır; onay anı `kvkk_at`'e yazılır ki
 * ihtilafta kanıt olsun. Onay olmadan kayıt açılmaz.
 */
export async function submitReferralByToken(fd: FormData): Promise<PublicReferralResult> {
  const token = String(fd.get("token") ?? "").trim();
  const name = String(fd.get("referred_name") ?? "").trim().slice(0, 120);
  const phoneRaw = String(fd.get("referred_phone") ?? "").trim();
  const note = String(fd.get("referred_note") ?? "").trim().slice(0, 1000);
  const kvkk = String(fd.get("kvkk") ?? "") === "on";
  // Honeypot — botlar gizli alanı doldurur; sessizce "başarılı" davran (lead formu deseni).
  if (String(fd.get("website") ?? "").trim()) return { ok: true };

  if (!UUID_RE.test(token)) return { error: "Geçersiz bağlantı." };
  if (!name) return { error: "Tanıdığınızın adı zorunludur." };
  const phoneParsed = parsePhone(phoneRaw);
  if (!phoneParsed.ok) return { error: phoneParsed.error ?? PHONE_ERROR_MESSAGE };
  if (!kvkk) return { error: "Devam etmek için onay kutusunu işaretlemeniz gerekir." };

  // Token tahmini / spam koruması — IP başına dakikada 8 tavsiye denemesi.
  const ip = await clientIp();
  const { allowed } = await checkRateLimit(`tavsiye:${ip}`, {
    limit: 8,
    windowSec: 60,
    failurePolicy: "deny",
  });
  if (!allowed) return { error: "Çok fazla istek. Lütfen biraz sonra tekrar deneyin." };

  const admin = createAdminClient();
  const { data: link } = await admin
    .from("referral_links")
    .select("id, tenant_id, customer_id, staff_id, created_by, is_active")
    .eq("public_token", token)
    .maybeSingle();

  if (!link) return { error: "Bağlantı geçersiz veya kaldırılmış." };
  const { data: tenant } = await admin
    .from("tenants")
    .select("status")
    .eq("id", link.tenant_id)
    .maybeSingle();
  if (!tenant || !isPublicTenantActive(tenant.status)) {
    return { error: "Bağlantı geçersiz veya kaldırılmış." };
  }
  if (link.is_active === false) return { error: "Bu tavsiye bağlantısı kapatılmış." };

  const { data: referrer } = await admin
    .from("customers")
    .select("full_name")
    .eq("id", link.customer_id)
    .eq("tenant_id", link.tenant_id)
    .is("deleted_at", null)
    .maybeSingle();
  if (!referrer) return { error: "Bağlantı geçersiz veya kaldırılmış." };

  const phone = phoneParsed.stored;

  // Mükerrer freni (link + telefon): aynı kişiyi ikinci kez ilettiyse yeni satır
  // ve yeni bildirim üretme — teşekkür ekranını yine göster.
  const { data: existing } = await admin
    .from("referrals")
    .select("id")
    .eq("tenant_id", link.tenant_id)
    .eq("link_id", link.id)
    .eq("referred_phone", phone)
    .limit(1)
    .maybeSingle();
  if (existing) return { ok: true, alreadySent: true };

  const { error } = await admin.from("referrals").insert({
    tenant_id: link.tenant_id,
    link_id: link.id,
    referrer_customer_id: link.customer_id,
    referred_name: name,
    referred_phone: phone,
    referred_note: note || null,
    kvkk_at: new Date().toISOString(),
    status: "yeni",
  });
  if (error) {
    // Yarışta ikinci yazımı DB unique index keser (idx_referrals_link_phone_unique).
    if (error.code === "23505") return { ok: true, alreadySent: true };
    console.error("submitReferralByToken", error);
    return { error: "Tavsiyeniz kaydedilemedi. Lütfen tekrar deneyin." };
  }

  // Danışmana bildirim — hata teşekkür ekranını düşürmesin.
  try {
    const referrerName = referrer.full_name ?? "Bir müşteriniz";
    const targetId = (link.staff_id as string | null) ?? (link.created_by as string | null) ?? null;
    const { data: target } = targetId
      ? await admin
          .from("profiles")
          .select("id")
          .eq("id", targetId)
          .eq("tenant_id", link.tenant_id)
          .eq("is_active", true)
          .maybeSingle()
      : { data: null };
    await notifyTenant({
      tenantId: String(link.tenant_id),
      userId: target?.id ?? null,
      title: `🤝 Yeni tavsiye: ${name} — ${referrerName} yönlendirdi`,
      body: note ? note.slice(0, 160) : "Tavsiye edilen kişiyi bugün arayın; sıcak temas hızlı kapanır.",
      href: "/app/tavsiyeler?durum=yeni",
      kind: "success",
    });
  } catch (e) {
    console.error("referral notify", e);
  }

  revalidatePath("/app/tavsiyeler");
  return { ok: true };
}
