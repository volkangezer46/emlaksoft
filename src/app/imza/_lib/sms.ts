/**
 * İmza akışı SMS yardımcıları — tenant_integrations'taki Netgsm kaydı öncelikli,
 * kayıt yoksa platform varsayılanı (kampanya gönderiminin kullandığı sendSms).
 *
 * Not: src/lib/messaging/netgsm.ts yalnızca platform kimlik bilgileriyle çalışır
 * ve tenant kimlik bilgisi kabul etmez; tenant yolu bu yüzden aynı Netgsm XML
 * API'sine burada minimal olarak bağlanır. Tenant kaydı yoksa davranış değişmez.
 */

import { createAdminClient } from "@/lib/supabase/admin";
import {
  getNetgsmConfig,
  sendSms,
  type NetgsmConfig,
  type SmsSendResult,
} from "@/lib/messaging/netgsm";

/** Ofisin (tenant) aktif Netgsm kaydını okur; alanları eksikse yok sayılır. */
export async function getTenantNetgsmConfig(tenantId: string): Promise<NetgsmConfig | null> {
  try {
    const admin = createAdminClient();
    const { data } = await admin
      .from("tenant_integrations")
      .select("credentials")
      .eq("tenant_id", tenantId)
      .eq("provider", "netgsm")
      .eq("is_active", true)
      .maybeSingle();
    const c = (data?.credentials ?? {}) as Partial<NetgsmConfig>;
    if (c.usercode && c.password && c.msgheader) {
      return { usercode: c.usercode, password: c.password, msgheader: c.msgheader };
    }
    return null;
  } catch (e) {
    console.error("getTenantNetgsmConfig", e);
    return null;
  }
}

/**
 * İmzalayana SMS gönderilebilir mi?
 * Geçerli TR cep numarası + (tenant Netgsm kaydı VEYA platform varsayılanı) gerekir.
 */
export async function isSignerSmsAvailable(
  tenantId: string,
  phone: string | null | undefined,
): Promise<boolean> {
  if (!phone || !normalizeTrMobile(phone)) return false;
  if (await getTenantNetgsmConfig(tenantId)) return true;
  return (await getNetgsmConfig()) !== null;
}

/** Tenant Netgsm kaydı öncelikli tek SMS gönderimi; kayıt yoksa platform yardımcısına düşer. */
export async function sendSignerSms(
  tenantId: string,
  to: string,
  text: string,
): Promise<SmsSendResult> {
  const cfg = await getTenantNetgsmConfig(tenantId);
  if (!cfg) return sendSms(to, text); // platform varsayılanı — kampanyayla aynı yardımcı

  const phone = normalizeTrMobile(to);
  if (!phone) return { ok: false, error: "Geçersiz telefon numarası." };

  // netgsm.ts'teki 1:n XML şemasının tenant kimlik bilgileriyle karşılığı
  const xml = `<?xml version="1.0" encoding="UTF-8"?>
<mainbody>
  <header>
    <usercode>${xmlEscape(cfg.usercode)}</usercode>
    <password>${xmlEscape(cfg.password)}</password>
    <msgheader>${xmlEscape(cfg.msgheader)}</msgheader>
    <type>1:n</type>
  </header>
  <body>
    <msg><![CDATA[${text.replace(/]]>/g, "]] >")}]]></msg>
    <no>${phone}</no>
  </body>
</mainbody>`;

  try {
    const res = await fetch("https://api.netgsm.com.tr/sms/send/xml", {
      method: "POST",
      headers: { "Content-Type": "text/xml; charset=UTF-8" },
      body: xml,
    });
    const parts = (await res.text()).trim().split(" ");
    const code = parts[0];
    if (code === "00") return { ok: true, jobid: parts[1] };
    return { ok: false, code, error: `Netgsm hata kodu: ${code}` };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "Bağlantı hatası." };
  }
}

/** Telefonun yalnızca son iki hanesini gösterir (ör. "05** *** ** 42"). */
export function maskPhone(raw: string): string {
  const p = normalizeTrMobile(raw);
  if (!p) return "***";
  return `0${p.slice(0, 1)}** *** ** ${p.slice(-2)}`;
}

/** TR cep numarasını 10 haneli formata normalize eder (netgsm.ts ile aynı kural). */
function normalizeTrMobile(raw: string): string | null {
  const digits = raw.replace(/\D/g, "");
  if (digits.startsWith("90") && digits.length === 12) return digits.slice(2);
  if (digits.startsWith("0") && digits.length === 11) return digits.slice(1);
  if (digits.startsWith("5") && digits.length === 10) return digits;
  return null;
}

/** XML özel karakterlerini kaçırır. */
function xmlEscape(v: string): string {
  return v
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}
