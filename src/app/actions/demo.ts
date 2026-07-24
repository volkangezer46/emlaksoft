"use server";

import { createAdminClient } from "@/lib/supabase/admin";
import { notifyPlatformStaff } from "@/lib/platform-notify";
import { isValidTurkishMobile, normalizeTurkishPhone, TR_MOBILE_ERROR_MESSAGE } from "@/lib/phone";
import { checkRateLimit, clientIp } from "@/lib/rate-limit";

export type DemoResult = { error?: string; ok?: boolean };

export async function requestDemo(
  _prev: DemoResult,
  formData: FormData,
): Promise<DemoResult> {
  const fullName = String(formData.get("full_name") ?? "").trim();
  const rawPhone = String(formData.get("phone") ?? "").trim();
  const company = String(formData.get("company") ?? "").trim();
  const email = String(formData.get("email") ?? "").trim();
  const city = String(formData.get("city") ?? "").trim();
  const teamSize = String(formData.get("team_size") ?? "").trim();
  const message = String(formData.get("message") ?? "").trim();
  // Honeypot — botlar genelde tüm alanları doldurur; gizli alan doluysa sessizce başarı dön
  const honeypot = String(formData.get("website") ?? "").trim();
  if (honeypot) return { ok: true };

  if (!fullName) return { error: "Ad soyad zorunlu." };
  if (!isValidTurkishMobile(rawPhone)) return { error: TR_MOBILE_ERROR_MESSAGE };
  const phone = normalizeTurkishPhone(rawPhone);

  // Hız sınırı — IP başına 10 dk'da en fazla 5 talep
  const ip = await clientIp();
  const { allowed } = await checkRateLimit(`demo:${ip}`, { limit: 5, windowSec: 600 });
  if (!allowed) {
    return { error: "Çok fazla talep gönderildi. Lütfen birkaç dakika sonra tekrar deneyin." };
  }

  try {
    const admin = createAdminClient();

    // Kalıcı satış lead kaydı (EmlakSoft satış hunisi)
    await admin.from("demo_requests").insert({
      full_name: fullName,
      phone,
      company: company || null,
      email: email || null,
      city: city || null,
      team_size: teamSize || null,
      message: message || null,
      source: "demo_form",
      status: "new",
    });

    // Platform personeline bildirim (fan-out) — satış ekranına yönlendirir
    await notifyPlatformStaff({
      title: "Yeni demo talebi",
      body: `${fullName}${company ? ` · ${company}` : ""} · ${phone}`,
      href: "/admin/satis",
      kind: "success",
      meta: { full_name: fullName, phone, company, source: "demo_form" },
    });

    // audit trail (platform-level, tenant yok)
    await admin.from("audit_logs").insert({
      tenant_id: null,
      actor_id: null,
      action: "demo.request",
      entity_type: "demo",
      new_value: { full_name: fullName, phone, company },
    });
  } catch (e) {
    console.error("requestDemo", e);
    // Form yine de başarılı sayılsın — kayıt ops tarafına düşmese bile kullanıcıya onay ver
  }

  return { ok: true };
}
