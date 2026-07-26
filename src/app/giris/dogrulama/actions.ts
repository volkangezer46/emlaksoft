"use server";

import { redirect } from "next/navigation";
import { cookies, headers } from "next/headers";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { checkRateLimit, clientIp } from "@/lib/rate-limit";
import {
  generateLoginCode,
  LOGIN_CODE_MAX_ATTEMPTS,
  LOGIN_CODE_TTL_MS,
  sha256Hex,
  TWO_FACTOR_COOKIE,
  twoFactorCookieOptions,
  twoFactorCookieValue,
} from "@/lib/two-factor";
import { sendSignerSms } from "@/app/imza/_lib/sms";
import { sendSms } from "@/lib/messaging/netgsm";
import { logLoginEvent } from "../_lib/login-events";

export type VerifyResult = { error?: string; ok?: true; resent?: true };

/**
 * SMS ile gönderilen 6 haneli giriş kodunu doğrular. Doğruysa es_2fa_ok
 * çerezi set edilir ve middleware panel erişimini açar. 5 hatalı denemede
 * kod geçersiz sayılır (yeni kod istenmeli).
 */
export async function verifyLoginCode(
  _prev: VerifyResult,
  fd: FormData,
): Promise<VerifyResult> {
  const code = String(fd.get("code") ?? "").replace(/\D/g, "");
  const rawNext = String(fd.get("next") ?? "/app");
  // Açık yönlendirme koruması: yalnız site-içi mutlak yol ("//host" ve "/\host" dışlanır)
  const next = /^\/(?![/\\])/.test(rawNext) ? rawNext : "/app";
  if (!/^\d{6}$/.test(code)) return { error: "6 haneli doğrulama kodunu girin." };

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/giris");

  const ip = await clientIp();
  const userAgent = (await headers()).get("user-agent");
  const tenantId = (user.app_metadata?.tenant_id as string | undefined) ?? null;

  const { allowed } = await checkRateLimit(`2fa-verify:${user.id}`, { limit: 15, windowSec: 60 });
  if (!allowed) return { error: "Çok fazla deneme. Lütfen biraz sonra tekrar deneyin." };

  const admin = createAdminClient();
  const { data: challenge } = await admin
    .from("login_challenges")
    .select("id, code_hash, expires_at, attempts")
    .eq("user_id", user.id)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (!challenge) return { error: "Bekleyen doğrulama kodu yok. Yeni kod isteyin." };
  if (new Date(challenge.expires_at).getTime() < Date.now()) {
    return { error: "Kodun süresi doldu. Lütfen yeni kod isteyin." };
  }
  if (challenge.attempts >= LOGIN_CODE_MAX_ATTEMPTS) {
    return { error: "Çok fazla hatalı deneme. Lütfen yeni kod isteyin." };
  }

  // Deneme hakkı HASH kontrolünden ÖNCE atomik tüketilir (optimistic lock):
  // paralel isteklerle sayaç yarışı 5 deneme sınırını aşamaz.
  const { data: consumed } = await admin
    .from("login_challenges")
    .update({ attempts: challenge.attempts + 1 })
    .eq("id", challenge.id)
    .eq("attempts", challenge.attempts)
    .select("id")
    .maybeSingle();
  if (!consumed) {
    return { error: "Eşzamanlı deneme algılandı. Lütfen tekrar deneyin." };
  }

  if ((await sha256Hex(code)) !== challenge.code_hash) {
    await logLoginEvent({ userId: user.id, tenantId, ip, userAgent, result: "2fa_failed" });
    const remaining = LOGIN_CODE_MAX_ATTEMPTS - challenge.attempts - 1;
    return {
      error:
        remaining > 0
          ? `Kod hatalı. Kalan deneme hakkı: ${remaining}`
          : "Kod hatalı. Deneme hakkı bitti — yeni kod isteyin.",
    };
  }

  // Doğru kod: challenge temizlenir, çerez set edilir, giriş tamamlanır
  await admin.from("login_challenges").delete().eq("user_id", user.id);
  (await cookies()).set(TWO_FACTOR_COOKIE, await twoFactorCookieValue(user.id), twoFactorCookieOptions());
  await logLoginEvent({ userId: user.id, tenantId, ip, userAgent, result: "success" });

  redirect(next);
}

/** Yeni 6 haneli kod üretir ve kayıtlı telefona SMS ile gönderir. */
export async function resendLoginCode(
  _prev: VerifyResult,
  _fd: FormData,
): Promise<VerifyResult> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/giris");

  const { allowed } = await checkRateLimit(`2fa-send:${user.id}`, { limit: 5, windowSec: 300 });
  if (!allowed) return { error: "Çok sık kod istendi. Lütfen birkaç dakika sonra tekrar deneyin." };

  const admin = createAdminClient();
  const { data: profile } = await admin
    .from("profiles")
    .select("two_factor_sms, phone, tenant_id")
    .eq("id", user.id)
    .maybeSingle();
  if (!profile?.two_factor_sms || !profile.phone) {
    return { error: "Bu hesap için SMS doğrulaması gerekli değil." };
  }

  const code = generateLoginCode();
  await admin.from("login_challenges").delete().eq("user_id", user.id);
  const { error: chError } = await admin.from("login_challenges").insert({
    user_id: user.id,
    code_hash: await sha256Hex(code),
    expires_at: new Date(Date.now() + LOGIN_CODE_TTL_MS).toISOString(),
  });
  if (chError) {
    console.error("resendLoginCode challenge", chError);
    return { error: "Kod oluşturulamadı. Lütfen tekrar deneyin." };
  }

  const tenantId = (profile.tenant_id as string | null) ?? null;
  const text = `EmlakSoft giriş kodunuz: ${code}`;
  const sms = tenantId ? await sendSignerSms(tenantId, profile.phone, text) : await sendSms(profile.phone, text);
  if (!sms.ok) {
    console.error("resendLoginCode sms", sms.error);
    return { error: "SMS gönderilemedi. Lütfen tekrar deneyin." };
  }

  await logLoginEvent({
    userId: user.id,
    tenantId,
    ip: await clientIp(),
    userAgent: (await headers()).get("user-agent"),
    result: "2fa_pending",
  });
  return { ok: true, resent: true };
}

/** Doğrulamadan vazgeç — oturumu kapatır ve giriş sayfasına döner. */
export async function cancelLoginVerification(): Promise<void> {
  const supabase = await createClient();
  await supabase.auth.signOut();
  (await cookies()).delete(TWO_FACTOR_COOKIE);
  redirect("/giris");
}
