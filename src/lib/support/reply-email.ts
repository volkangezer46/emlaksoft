import "server-only";

import { createAdminClient } from "@/lib/supabase/admin";
import { sendEmail } from "@/lib/email/provider";
import { getSetting } from "@/lib/settings/read";
import { getBaseUrl } from "@/lib/base-url";

/**
 * Destek yanıtını müşteriye e-postayla iletir (AD9). İki kapı: ayar `support.reply_email_enabled` ve e-posta kanalı
 * (Resend anahtarı + gönderen). Kapalıysa gönderim YAPILMAZ ve "kanal kapalı" olarak günlüğe düşer (sahte gönderim
 * yok). Hata asla yanıt akışını bozmaz: uygulama içi bildirim her durumda gider.
 */
export type ReplyEmailOutcome = "sent" | "setting_off" | "channel_closed" | "no_recipient" | "failed";

export async function sendTicketReplyEmail(input: {
  ticketId: string;
  ticketNo?: string | null;
  subject: string;
  createdBy?: string | null;
  body: string;
}): Promise<ReplyEmailOutcome> {
  try {
    const enabled = await getSetting<boolean>("support.reply_email_enabled");
    if (!enabled) return "setting_off";
    if (!input.createdBy) return "no_recipient";
    const admin = createAdminClient();
    const { data } = await admin.auth.admin.getUserById(input.createdBy).catch(() => ({ data: null }));
    const email = data?.user?.email;
    if (!email) return "no_recipient";

    const base = getBaseUrl();
    const ref = input.ticketNo ?? "Destek talebi";
    const result = await sendEmail({
      to: email,
      subject: `${ref} · ${input.subject}`,
      text: [
        "EmlakSoft destek ekibinden yeni yanıt:",
        "",
        input.body.trim(),
        "",
        `Talebi görüntülemek ve yanıtlamak için: ${base}/app/destek/${input.ticketId}`,
        "",
        "Bu e-postayı yanıtlamak yerine panel üzerinden yazmanız, yanıtınızın talebe eklenmesini sağlar.",
      ].join("\n"),
    });
    if (result.ok) return "sent";
    if (result.code === "disabled") {
      console.info("support reply email", { ticketId: input.ticketId, outcome: "kanal kapalı", reason: result.error });
      return "channel_closed";
    }
    console.error("support reply email", { ticketId: input.ticketId, code: result.code });
    return "failed";
  } catch (error) {
    console.error("support reply email", { ticketId: input.ticketId, message: error instanceof Error ? error.message : "unknown" });
    return "failed";
  }
}
