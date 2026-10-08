import type { SupabaseClient } from "@supabase/supabase-js";
import { formatPhoneDisplay, toWhatsAppLink } from "@/lib/phone";
import { parsePhoneStrict } from "@/lib/phone-rules";
import {
  KIND_LABELS,
  buildReminderMessage,
  daysToDue,
  dueDateOfPeriod,
  type ReminderKind,
} from "@/lib/rent-reminders/logic";
import type { ReminderLogRow } from "./reminders-panel";

/**
 * Kiralama detayı "Hatırlatma" sekmesi için sunucu verisi. Tüm okumalar oturumlu istemciyle (RLS) ve HATAYA DAYANIKLIDIR:
 * hatırlatma tabloları/sütunu yoksa (migration uygulanmamış) alanlar "bilinmiyor" döner, sayfa düşmez.
 */
export type ReminderTabData = {
  optOut: boolean;
  automationEnabled: boolean | null;
  phoneDisplay: string | null;
  suggestion: { kind: ReminderKind; label: string; waHref: string | null; message: string } | null;
  logs: ReminderLogRow[];
};

export async function loadReminderTab(input: {
  supabase: SupabaseClient;
  today: string;
  rental: { id: string; due_day: number; monthly_rent: number };
  renter: { id: string; full_name: string | null; phone: string | null } | null;
  charges: { id: string; period: string; amount: number; status: string }[];
  tenantId: string | null;
}): Promise<ReminderTabData> {
  const { supabase, rental, renter, charges, today } = input;

  const [optRes, setRes, logRes, tenantRes] = await Promise.all([
    renter
      ? supabase.from("customers").select("rent_reminder_opt_out").eq("id", renter.id).maybeSingle()
      : Promise.resolve({ data: null, error: null }),
    supabase.from("rent_reminder_settings").select("enabled").maybeSingle(),
    supabase
      .from("rent_reminders")
      .select("id, period, kind, channel, status, reason, sent_at")
      .eq("rental_id", rental.id)
      .neq("kind", "owner_payout")
      .order("created_at", { ascending: false })
      .limit(30),
    input.tenantId ? supabase.from("tenants").select("name").eq("id", input.tenantId).maybeSingle() : Promise.resolve({ data: null, error: null }),
  ]);

  const optOut = !optRes.error && (optRes.data as { rent_reminder_opt_out?: boolean } | null)?.rent_reminder_opt_out === true;
  const automationEnabled = setRes.error ? null : (setRes.data as { enabled?: boolean } | null)?.enabled === true;
  const officeName = (tenantRes.data as { name?: string | null } | null)?.name ?? null;

  const phone = renter?.phone ? parsePhoneStrict(renter.phone) : null;
  const msisdnOk = Boolean(phone?.ok);
  const phoneDisplay = renter?.phone ? formatPhoneDisplay(renter.phone) : null;

  // Şimdi hatırlatılacak: tahsil edilmemiş en eski tahakkuk (pending/overdue).
  const unpaid = charges
    .filter((c) => c.status !== "paid")
    .sort((a, b) => (a.period < b.period ? -1 : 1))[0];
  let suggestion: ReminderTabData["suggestion"] = null;
  if (unpaid) {
    const due = dueDateOfPeriod(unpaid.period, rental.due_day);
    const d = daysToDue(today, due);
    const kind: ReminderKind = d > 0 ? "before" : d >= -2 ? "due" : "late";
    const message = buildReminderMessage({
      kind,
      renterName: renter?.full_name ?? null,
      officeName,
      amount: Number(unpaid.amount),
      due,
    });
    suggestion = { kind, label: KIND_LABELS[kind], message, waHref: msisdnOk ? toWhatsAppLink(renter?.phone, message) : null };
  }

  const logs: ReminderLogRow[] = ((logRes.error ? [] : logRes.data) ?? []).map((l) => {
    const row = l as { id: string; period: string; kind: ReminderKind; channel: "office" | "sms"; status: ReminderLogRow["status"]; reason: string | null; sent_at: string | null };
    const period = String(row.period).slice(0, 10);
    let waHref: string | null = null;
    if (row.channel === "office" && msisdnOk) {
      const due = dueDateOfPeriod(period, rental.due_day);
      const charge = charges.find((c) => String(c.period).slice(0, 10) === period);
      waHref = toWhatsAppLink(
        renter?.phone,
        buildReminderMessage({
          kind: row.kind,
          renterName: renter?.full_name ?? null,
          officeName,
          amount: Number(charge?.amount ?? rental.monthly_rent),
          due,
        }),
      );
    }
    return { id: row.id, period, kind: row.kind, channel: row.channel, status: row.status, reason: row.reason, sentAt: row.sent_at, waHref };
  });

  return { optOut, automationEnabled, phoneDisplay, suggestion, logs };
}
