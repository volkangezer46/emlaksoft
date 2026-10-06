import type { SupabaseClient } from "@supabase/supabase-js";
import { getSettings } from "@/lib/settings/read";
import { emailChannelStatus, sendEmail } from "@/lib/email/provider";
import { renderTemplate, templateDef, templateSettingKey } from "@/lib/email/templates";

/**
 * Deneme bitimi e-postası (abonelik-kontrol cron'u, zil bildirimi yazıldığı anda — aynı kademe tekrar yazılmadığından
 * e-posta da tekrarlanmaz). Kanal kapalıysa hiçbir şey yapmaz. Alıcı: ofis sahibi (auth e-postası, çağıranın
 * service_role istemcisiyle okunur; bu dosya istemci OLUŞTURMAZ). Çalıştırma başına en çok 50 e-posta.
 */
export async function sendTrialEndingEmails(admin: SupabaseClient, items: { tenantId: string; days: number }[], billingUrl: string): Promise<number> {
  if (!emailChannelStatus().enabled || items.length === 0) return 0;
  const def = templateDef("trial_ending");
  const settings = await getSettings([templateSettingKey("trial_ending", "subject"), templateSettingKey("trial_ending", "body")]);
  const subjectTpl = String(settings[templateSettingKey("trial_ending", "subject")] ?? def.defaultSubject);
  const bodyTpl = String(settings[templateSettingKey("trial_ending", "body")] ?? def.defaultBody);
  const tenantIds = [...new Set(items.map((i) => i.tenantId))].slice(0, 50);
  const [{ data: owners }, { data: tenants }] = await Promise.all([
    admin.from("profiles").select("id, tenant_id").in("tenant_id", tenantIds).eq("role", "owner").eq("is_active", true),
    admin.from("tenants").select("id, name").in("id", tenantIds),
  ]);
  const nameOf = new Map(((tenants ?? []) as { id: string; name: string }[]).map((t) => [t.id, t.name]));
  let sent = 0;
  for (const o of (owners ?? []) as { id: string; tenant_id: string }[]) {
    const item = items.find((i) => i.tenantId === o.tenant_id);
    if (!item) continue;
    const { data } = await admin.auth.admin.getUserById(o.id).catch(() => ({ data: null }));
    const email = data?.user?.email;
    if (!email) continue;
    const vars = { ofis: nameOf.get(o.tenant_id) ?? "Ofisiniz", gun: item.days, baglanti: billingUrl };
    const res = await sendEmail({ to: email, subject: renderTemplate(subjectTpl, vars, { singleLine: true }), text: renderTemplate(bodyTpl, vars) });
    if (res.ok) sent += 1;
  }
  return sent;
}
