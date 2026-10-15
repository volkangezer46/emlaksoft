"use server";

import { createClient } from "@/lib/supabase/server";
import { checkRateLimit, clientIp } from "@/lib/rate-limit";
import { PHONE_ERROR_MESSAGE } from "@/lib/phone";
import { parsePhoneStrict } from "@/lib/phone-rules";
import { EMAIL_ERROR_MESSAGE, isValidEmail, normalizeEmail } from "@/lib/email";
import { isPublicTenantActive } from "@/lib/public-tenant";
import { parseExperience } from "@/lib/recruiting/logic";

export type CareerApplyResult = { ok?: boolean; error?: string; duplicate?: boolean };

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const RPC_ERRORS: Record<string, string> = {
  consent: "Devam etmek için KVKK aydınlatma metnini onaylayın.",
  name: "Geçerli bir ad soyad girin.",
  phone: PHONE_ERROR_MESSAGE,
  email: EMAIL_ERROR_MESSAGE,
  not_found: "Bu başvuru bağlantısı geçersiz.",
  closed: "Ofis şu an başvuru kabul etmiyor.",
  rate: "Şu an çok fazla başvuru var. Lütfen biraz sonra tekrar deneyin.",
};

/**
 * Herkese açık danışman adayı başvurusu (/kariyer/[token]). Oturum yok: token + açık rıza + IP hız sınırı.
 * Telefon sunucuda `parsePhoneStrict` ile doğrulanır; yazma yalnız DEFINER RPC `recruit_public_apply` ile olur
 * (kiracı yayında mı (isPublicTenantActive ile aynı küme), form açık mı, ofis başına saatlik tavan, tekrar başvuru).
 */
export async function submitCareerApplication(fd: FormData): Promise<CareerApplyResult> {
  // Honeypot: botlar gizli alanı doldurur; sessizce "başarılı" davran.
  if (String(fd.get("website") ?? "").trim()) return { ok: true };
  const token = String(fd.get("token") ?? "").trim();
  if (!UUID_RE.test(token)) return { error: RPC_ERRORS.not_found };
  const fullName = String(fd.get("full_name") ?? "").trim().replace(/\s+/g, " ");
  if (fullName.length < 2 || fullName.length > 160) return { error: RPC_ERRORS.name };
  const phone = parsePhoneStrict(String(fd.get("phone") ?? ""));
  if (!phone.ok) return { error: phone.error ?? PHONE_ERROR_MESSAGE };
  const emailRaw = String(fd.get("email") ?? "").trim();
  if (emailRaw && !isValidEmail(emailRaw)) return { error: EMAIL_ERROR_MESSAGE };
  if (String(fd.get("kvkk") ?? "") !== "on") return { error: RPC_ERRORS.consent };

  const ip = await clientIp();
  const { allowed } = await checkRateLimit(`kariyer-basvuru:${ip}`, { limit: 5, windowSec: 3600, failurePolicy: "deny" });
  if (!allowed) return { error: "Çok fazla deneme yapıldı. Lütfen daha sonra tekrar deneyin." };

  const supabase = await createClient();
  const { data: form } = await supabase.rpc("recruit_public_form", { p_token: token }).maybeSingle();
  // RPC yalnız yayındaki kiracıyı döndürür; aynı kural kodda da (tek tanım isPublicTenantActive) korunur.
  const status = (form as { tenant_status?: string | null; accepting?: boolean } | null)?.tenant_status;
  if (!form || !isPublicTenantActive(status)) return { error: RPC_ERRORS.not_found };
  if (!(form as { accepting?: boolean }).accepting) return { error: RPC_ERRORS.closed };

  const { data, error } = await supabase.rpc("recruit_public_apply", {
    p_token: token,
    p_full_name: fullName,
    p_phone: phone.stored,
    p_email: emailRaw ? normalizeEmail(emailRaw) : null,
    p_experience: parseExperience(fd.get("experience_years")),
    p_current_office: String(fd.get("current_office") ?? "").trim().slice(0, 160) || null,
    p_message: String(fd.get("message") ?? "").trim().slice(0, 2000) || null,
    p_consent: true,
  });
  if (error) {
    console.error("submitCareerApplication", error.code);
    return { error: "Başvurunuz şu an alınamadı. Lütfen biraz sonra tekrar deneyin." };
  }
  const res = (data ?? {}) as { ok?: boolean; error?: string; duplicate?: boolean };
  if (!res.ok) return { error: RPC_ERRORS[res.error ?? ""] ?? "Başvurunuz şu an alınamadı; bilgilerinizi kontrol edip biraz sonra tekrar deneyin ya da ofisi arayın." };
  return { ok: true, duplicate: res.duplicate === true };
}
