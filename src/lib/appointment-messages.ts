/**
 * YD3 randevu iletişimi — SAF katman (istemci + sunucu + cron ortak; DB/ağ yok).
 *
 *  - Danışman hatırlatması YALNIZ randevunun sahibine gider: `assigned_to`, yoksa randevuyu açan (`created_by`).
 *    İkisi de yoksa bildirim YAZILMAZ (ofis geneline sahipsiz bildirim yok; sayılır, heartbeat'te görünür).
 *  - Müşteri iletisi (teyit / hatırlatma) İŞLEM AMAÇLIDIR (İYS `appointment_reminder`, muaf): kısa, tek bağlantılı, tutar ve
 *    kişisel veri içermez. Kanal (SMS) yoksa danışmana aynı metinle wa.me bağlantısı verilir; mesajı danışman gönderir.
 *  - Saat: bütün tarih/saat metinleri Türkiye saatiyle (`formatDateTimeTr`).
 */
import { appointmentTypeLabel } from "@/lib/appointment-labels";
import { trParts } from "@/lib/clock";
import { formatDateTimeTr } from "@/lib/format";
import { buildDedupeKey } from "@/lib/notify-dedupe";
import { toWhatsAppLink } from "@/lib/phone";

/** Teyit sayfası yolu (token'lı; sitemap'e girmez). */
export function appointmentConfirmPath(token: string): string {
  return `/randevu-teyit/${token}`;
}

export function appointmentConfirmUrl(appUrl: string, token: string | null | undefined): string | null {
  if (!token) return null;
  return `${appUrl.replace(/\/+$/, "")}${appointmentConfirmPath(token)}`;
}

/** "15 Ekim 14:30" (Türkiye saati). */
export function appointmentWhenLabel(scheduledAt: string | Date): string {
  return formatDateTimeTr(scheduledAt, { day: "numeric", month: "long", hour: "2-digit", minute: "2-digit" });
}

function firstName(name: string | null | undefined): string | null {
  const first = (name ?? "").trim().split(/\s+/)[0];
  return first ? first : null;
}

export type AppointmentMessageKind = "confirm" | "reminder" | "reschedule";

/**
 * Müşteriye giden teyit/hatırlatma metni (SMS ve WhatsApp taslağı AYNI metin). Bağlantı yoksa (token yok) yalnız bilgi verir.
 */
export function appointmentCustomerText(input: {
  kind: AppointmentMessageKind;
  customerName: string | null | undefined;
  officeName: string | null | undefined;
  appointmentType: string | null | undefined;
  scheduledAt: string | Date;
  confirmUrl: string | null;
  /** Yalnız `reschedule`: eski saat ("15 Ekim 14:30 yerine …"). */
  previousAt?: string | Date | null;
}): string {
  const greet = firstName(input.customerName) ? `Merhaba ${firstName(input.customerName)},` : "Merhaba,";
  const office = input.officeName?.trim() ? `${input.officeName.trim()} ile ` : "";
  const type = appointmentTypeLabel(input.appointmentType ?? "").toLocaleLowerCase("tr");
  const when = appointmentWhenLabel(input.scheduledAt);
  const subject = `${office}${when}${type ? ` ${type}` : ""} randevunuz`;
  const head =
    input.kind === "confirm"
      ? `${greet} ${subject} planlandı.`
      : input.kind === "reschedule"
        ? `${greet} ${office}${type ? `${type} ` : ""}randevunuz${input.previousAt ? ` ${appointmentWhenLabel(input.previousAt)} yerine` : ""} ${when} olarak güncellendi.`
        : `${greet} hatırlatma: ${subject} yaklaşıyor.`;
  return input.confirmUrl ? `${head} Teyit veya iptal için: ${input.confirmUrl}` : head;
}

/** Danışmanın kendi WhatsApp'ından müşteriye göndereceği hazır taslak (numara geçersizse null). */
export function appointmentWhatsAppHref(phone: string | null | undefined, text: string): string | null {
  return toWhatsAppLink(phone, text);
}

// ---------------------------------------------------------------------------
// Danışman hatırlatması (randevu-hatirlat cron'u)
// ---------------------------------------------------------------------------

export type ReminderAppointment = {
  id: string;
  tenant_id: string;
  scheduled_at: string;
  confirm_token: string | null;
  assigned_to: string | null;
  created_by: string | null;
  customerName: string | null;
};

export type ReminderNotification = {
  tenant_id: string;
  user_id: string;
  title: string;
  body: string;
  href: string;
  kind: "info";
  dedupe_key: string;
};

/** Hatırlatmanın alıcısı: atanan danışman, yoksa randevuyu açan; ikisi de yoksa null (bildirim yazılmaz). */
export function appointmentReminderRecipient(a: Pick<ReminderAppointment, "assigned_to" | "created_by">): string | null {
  return a.assigned_to || a.created_by || null;
}

/** Tekrar önleme anahtarı: randevu + saat (saat değişirse yeni hatırlatma hakkı doğar). */
export function appointmentReminderKey(a: Pick<ReminderAppointment, "id" | "scheduled_at">): string {
  return buildDedupeKey("appt-hatirlat", a.id, new Date(a.scheduled_at).getTime());
}

/**
 * Hatırlatma bildirimlerini planlar (SAF). Her satır KİŞİYE yazılır (`user_id` dolu); sahipsiz randevu atlanır ve sayılır.
 * Bağlantı tek randevuyu açar (`/app/randevular?randevu=<id>`).
 */
export function planAdvisorReminders(
  list: readonly ReminderAppointment[],
  opts: { appUrl: string; isAlreadyNotified: (a: ReminderAppointment) => boolean },
): { rows: ReminderNotification[]; skipped: number; unowned: number } {
  const rows: ReminderNotification[] = [];
  let skipped = 0;
  let unowned = 0;
  for (const a of list) {
    if (opts.isAlreadyNotified(a)) {
      skipped += 1;
      continue;
    }
    const userId = appointmentReminderRecipient(a);
    if (!userId) {
      unowned += 1;
      continue;
    }
    // Teyit linki gövdede: danışman müşteriye kopyalarken hazır olsun (satırdaki "WhatsApp'ta teyit gönder" ile aynı adres).
    const confirmUrl = appointmentConfirmUrl(opts.appUrl, a.confirm_token);
    rows.push({
      tenant_id: String(a.tenant_id),
      user_id: userId,
      title: "Yaklaşan randevu",
      body: `${a.customerName?.trim() || "Müşteri"} · ${appointmentWhenLabel(a.scheduled_at)}${confirmUrl ? ` · Teyit: ${confirmUrl}` : ""}`,
      href: `/app/randevular?randevu=${a.id}`,
      kind: "info",
      dedupe_key: appointmentReminderKey(a),
    });
  }
  return { rows, skipped, unowned };
}

// ---------------------------------------------------------------------------
// Müşteri hatırlatması (ofis ayarı açıkken; cron'un ayrık adımı)
// ---------------------------------------------------------------------------

/** Müşteriye SMS gönderilebilecek saat aralığı (Türkiye saati, [başlangıç, bitiş)). Gece mesaj atılmaz. */
export const CUSTOMER_MESSAGE_HOURS = { from: 9, to: 21 } as const;

export function isCustomerMessageHour(atMs: number): boolean {
  const h = trParts(atMs).hour;
  return h >= CUSTOMER_MESSAGE_HOURS.from && h < CUSTOMER_MESSAGE_HOURS.to;
}

/** Teyit SMS'i bu kadar yakın zamanda gittiyse ayrıca hatırlatma gönderilmez (aynı gün iki SMS olmasın). */
export const REMINDER_AFTER_CONFIRM_GAP_MS = 12 * 3_600_000;

export type CustomerReminderCandidate = {
  status: string | null;
  customer_response: string | null;
  customer_reminded_at: string | null;
  customer_confirm_sent_at: string | null;
  scheduled_at: string;
  hasMobile: boolean;
};

/** Müşteriye hatırlatma gönderilsin mi (SAF karar; kapma yine DB'de atomik). */
export function shouldRemindCustomer(c: CustomerReminderCandidate, nowMs: number): boolean {
  if (!c.hasMobile) return false;
  if (c.customer_reminded_at) return false;
  if (c.status !== "pending" && c.status !== "confirmed") return false;
  if (c.customer_response === "cancelled") return false;
  const at = new Date(c.scheduled_at).getTime();
  if (!Number.isFinite(at) || at <= nowMs) return false;
  if (c.customer_confirm_sent_at && nowMs - new Date(c.customer_confirm_sent_at).getTime() < REMINDER_AFTER_CONFIRM_GAP_MS) {
    return false;
  }
  return isCustomerMessageHour(nowMs);
}

// ---------------------------------------------------------------------------
// Yeniden planlama (GA-01)
// ---------------------------------------------------------------------------

/**
 * Saat değişince müşteri teyidi ve hatırlatma izleri sıfırlanır (eski saate verilen teyit yeni saat için geçerli değil;
 * yeni saate hatırlatma gidebilsin). Danışmanın "teyitli" işareti beklemeye döner. Saat aynıysa (not/konum düzenleme)
 * ya da randevu kapanmışsa null: hiçbir iz değişmez.
 */
export function rescheduleResetPatch(
  current: { scheduled_at: string; status: string | null },
  nextIso: string,
): Record<string, unknown> | null {
  if (new Date(current.scheduled_at).getTime() === new Date(nextIso).getTime()) return null;
  if (current.status !== "pending" && current.status !== "confirmed" && current.status !== "signature") return null;
  return {
    customer_response: null,
    responded_at: null,
    customer_reminded_at: null,
    customer_confirm_sent_at: null,
    ...(current.status === "confirmed" ? { status: "pending" } : {}),
  };
}

/** GA-14: gelmeyen müşteriye nazik "yeniden planlayalım mı" taslağı (danışman kendi WhatsApp'ından gönderir). */
export function appointmentNoShowText(input: {
  customerName: string | null | undefined;
  officeName: string | null | undefined;
  scheduledAt: string | Date;
}): string {
  const greet = firstName(input.customerName) ? `Merhaba ${firstName(input.customerName)},` : "Merhaba,";
  const office = input.officeName?.trim() ? ` ${input.officeName.trim()} olarak` : "";
  return `${greet} ${appointmentWhenLabel(input.scheduledAt)} randevumuzda sizi göremedik.${office} size uygun yeni bir gün ve saat planlamak isteriz. Ne zaman müsait olursunuz?`;
}
