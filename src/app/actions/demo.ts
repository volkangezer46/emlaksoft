"use server";

import { createHash, randomUUID } from "node:crypto";
import { createAdminClient } from "@/lib/supabase/admin";
import { notifyPlatformStaff } from "@/lib/platform-notify";
import { EMAIL_ERROR_MESSAGE, isValidEmail, normalizeEmail } from "@/lib/email";
import { parsePhone, PHONE_ERROR_MESSAGE } from "@/lib/phone";
import { checkRateLimit, clientIp } from "@/lib/rate-limit";

export type DemoResult = {
  error?: string;
  ok?: boolean;
  referenceCode?: string;
};

const DEMO_CONSENT_VERSION = "2026-08-02";
const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function idempotencyHash(requestId: string, phone: string) {
  return createHash("sha256")
    .update(`${requestId.toLowerCase()}:${phone}`)
    .digest("hex");
}

export async function requestDemo(
  _prev: DemoResult,
  formData: FormData,
): Promise<DemoResult> {
  const fullName = String(formData.get("full_name") ?? "").trim();
  const rawPhone = String(formData.get("phone") ?? "").trim();
  const company = String(formData.get("company") ?? "").trim();
  const email = normalizeEmail(String(formData.get("email") ?? ""));
  const city = String(formData.get("city") ?? "").trim();
  const teamSize = String(formData.get("team_size") ?? "").trim();
  const message = String(formData.get("message") ?? "").trim();
  const consent = String(formData.get("consent") ?? "").trim();
  const rawRequestId = String(formData.get("request_id") ?? "").trim();

  // Honeypot: bots usually fill every field; silently accept without storing.
  if (String(formData.get("website") ?? "").trim()) return { ok: true };

  if (!fullName) return { error: "Ad soyad zorunlu." };
  if (fullName.length > 120) return { error: "Ad soyad en fazla 120 karakter olabilir." };
  const phoneParsed = parsePhone(rawPhone);
  if (!phoneParsed.ok) return { error: phoneParsed.error ?? PHONE_ERROR_MESSAGE };
  if (email && !isValidEmail(email)) {
    return { error: EMAIL_ERROR_MESSAGE };
  }
  if (
    company.length > 160 ||
    city.length > 100 ||
    teamSize.length > 40 ||
    message.length > 2000
  ) {
    return { error: "Form alanlarından biri izin verilen uzunluğu aşıyor." };
  }
  if (consent !== "1") {
    return { error: "Demo talebi için iletişim izni zorunludur." };
  }

  const phone = phoneParsed.stored;
  const requestId = UUID_RE.test(rawRequestId) ? rawRequestId : randomUUID();
  const requestHash = idempotencyHash(requestId, phone);

  const ip = await clientIp();
  const { allowed } = await checkRateLimit(`demo:${ip}`, {
    limit: 5,
    windowSec: 600,
    failurePolicy: "deny",
  });
  if (!allowed) {
    return {
      error: "Çok fazla talep gönderildi. Lütfen birkaç dakika sonra tekrar deneyin.",
    };
  }

  try {
    const admin = createAdminClient();
    const { data: request, error: requestError } = await admin
      .from("demo_requests")
      .insert({
        full_name: fullName,
        phone,
        company: company || null,
        email: email || null,
        city: city || null,
        team_size: teamSize || null,
        message: message || null,
        source: "demo_callback_form",
        status: "new",
        idempotency_key_hash: requestHash,
        consent_at: new Date().toISOString(),
        consent_scope: "demo_callback",
        consent_version: DEMO_CONSENT_VERSION,
      })
      .select("id, reference_code")
      .single();

    if (requestError || !request) {
      if (requestError?.code === "23505") {
        const { data: existing } = await admin
          .from("demo_requests")
          .select("reference_code")
          .eq("idempotency_key_hash", requestHash)
          .maybeSingle();
        if (existing?.reference_code) {
          return { ok: true, referenceCode: existing.reference_code };
        }
      }
      console.error("requestDemo insert", { code: requestError?.code ?? "empty" });
      return { error: "Talebiniz kaydedilemedi. Lütfen tekrar deneyin." };
    }

    await notifyPlatformStaff({
      title: "Yeni demo talebi",
      body: `${fullName}${company ? ` · ${company}` : ""} · ${phone}`,
      href: "/admin/satis",
      kind: "success",
      meta: {
        full_name: fullName,
        phone,
        company,
        source: "demo_callback_form",
        reference_code: request.reference_code,
      },
    });

    const { error: auditError } = await admin.from("audit_logs").insert({
      tenant_id: null,
      actor_id: null,
      action: "demo.request",
      entity_type: "demo",
      entity_id: request.id,
      new_value: {
        full_name: fullName,
        phone,
        company,
        reference_code: request.reference_code,
      },
    });
    if (auditError) console.error("requestDemo audit", { code: auditError.code });

    return { ok: true, referenceCode: request.reference_code };
  } catch (error) {
    console.error("requestDemo", error);
    return { error: "Talebiniz kaydedilemedi. Lütfen tekrar deneyin." };
  }
}
