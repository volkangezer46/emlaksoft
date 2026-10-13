"use server";

import { guardPlatformAction } from "@/lib/platform-guards";
import { logPlatformActivity } from "@/lib/platform-activity";
import { loadTemplateText } from "@/lib/email/send";
import { isEmailTemplateKey, type EmailTemplateKey } from "@/lib/email/templates";
import { sendSelfEmail, testResendConnection, type ConnectionTestResult } from "@/lib/email/test-send";

/**
 * E-posta kanalı eylemleri (yalnız süper admin). Hız sınırı: personel başına dakikada 3 test (bağlantı + gönderimler ortak).
 * Gönderimler YALNIZ oturumdaki personelin kendi adresine gider; eylemler alıcı parametresi KABUL ETMEZ.
 * Anahtar kaydı ayar defterinden (`email.resend_api_key`, SettingField → writeSetting) yapılır; denetime değer değil parmak izi yazılır.
 */

function gate() {
  return guardPlatformAction({
    module: "sistem",
    roles: ["super_admin"],
    rate: { key: "platform-email-test", limit: 3, windowSec: 60 },
  });
}

export type EmailActionResult = { ok?: boolean; error?: string; sentTo?: string };

export async function testEmailConnectionAction(): Promise<ConnectionTestResult> {
  const g = await gate();
  if ("error" in g) return { ok: false, error: g.error };
  const res = await testResendConnection();
  await logPlatformActivity({
    actorId: g.staff.id,
    action: "integration.email.test_connection",
    entityType: "integration",
    meta: { ok: res.ok, domains: res.ok ? res.domains.length : null, fromDomainVerified: res.ok ? res.fromDomainVerified : null },
  });
  return res;
}

export async function sendSelfTestEmailAction(): Promise<EmailActionResult> {
  const g = await gate();
  if ("error" in g) return { error: g.error };
  const res = await sendSelfEmail(g.staff, { type: "test" });
  await logPlatformActivity({ actorId: g.staff.id, action: "integration.email.self_test", entityType: "integration", meta: { ok: res.ok } });
  return res.ok ? { ok: true, sentTo: g.staff.email } : { error: res.error };
}

export async function sendTemplateSampleAction(templateKey: string): Promise<EmailActionResult> {
  const g = await gate();
  if ("error" in g) return { error: g.error };
  if (!isEmailTemplateKey(templateKey)) return { error: "Bilinmeyen şablon." };
  const key: EmailTemplateKey = templateKey;
  const text = await loadTemplateText(key);
  const res = await sendSelfEmail(g.staff, { type: "template", key, subject: text.subject, body: text.body, footer: text.footer });
  await logPlatformActivity({ actorId: g.staff.id, action: "integration.email.template_sample", entityType: "integration", meta: { template: key, ok: res.ok } });
  return res.ok ? { ok: true, sentTo: g.staff.email } : { error: res.error };
}
