"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { requirePermission } from "@/lib/require-permission";
import { now } from "@/lib/clock";
import { normalizeReminderSettings } from "@/lib/rent-reminders/logic";
import { logActivity } from "@/lib/activity";

/**
 * Kiracı hatırlatma ayarları ve kiracı opt-out (H3). Tümü oturumlu istemciyle (RLS) çalışır; service_role YOK.
 * Ayar KAPALI doğar: kayıt yoksa ya da `enabled=false` ise cron hiçbir hatırlatma üretmez.
 */

export type RentReminderResult = { ok?: boolean; error?: string };

function isMissingSchema(e: { code?: string | null; message?: string | null } | null): boolean {
  if (!e) return false;
  const code = String(e.code ?? "");
  return code === "42P01" || code === "42703" || code === "PGRST205" || code === "PGRST204" || /does not exist|schema cache/i.test(String(e.message ?? ""));
}

const MISSING_MSG = "Hatırlatma özelliği için veritabanı güncellemesi henüz uygulanmamış.";

export async function saveRentReminderSettings(input: {
  enabled: boolean;
  smsEnabled: boolean;
  daysBefore: number;
  lateAfterDays: number;
  quietStartHour: number;
  quietEndHour: number;
}): Promise<RentReminderResult> {
  const gate = await requirePermission("rentals", "edit");
  if (!gate.ok) return { error: gate.error };
  // Ofis ayarı: RLS de yalnız bu roller içindir (migration 20260826002960).
  if (!["owner", "gm", "branch_manager"].includes(gate.role)) {
    return { error: "Hatırlatma ayarlarını yalnız ofis sahibi, genel müdür veya şube müdürü değiştirebilir." };
  }

  const s = normalizeReminderSettings(input as unknown as Record<string, unknown>);
  // Alan doğrulaması: normalize bozuk değeri sessizce varsayılana çevirir; kullanıcıya açık hata verilir.
  const intIn = (v: unknown, min: number, max: number) => Number.isInteger(v) && (v as number) >= min && (v as number) <= max;
  if (!intIn(input.daysBefore, 0, 10)) return { error: "Vade öncesi gün 0 ile 10 arasında olmalı." };
  if (!intIn(input.lateAfterDays, 1, 30)) return { error: "Gecikme günü 1 ile 30 arasında olmalı." };
  if (!intIn(input.quietStartHour, 0, 23) || !intIn(input.quietEndHour, 0, 23)) return { error: "Sessiz saatler 0-23 arasında olmalı." };

  const supabase = await createClient();
  const { error } = await supabase.from("rent_reminder_settings").upsert(
    {
      tenant_id: gate.tenantId,
      enabled: input.enabled === true,
      sms_enabled: input.enabled === true && input.smsEnabled === true,
      days_before: s.daysBefore,
      late_after_days: s.lateAfterDays,
      quiet_start_hour: s.quietStartHour,
      quiet_end_hour: s.quietEndHour,
      updated_by: gate.userId,
      updated_at: new Date(now()).toISOString(),
    },
    { onConflict: "tenant_id" },
  );
  if (error) {
    if (isMissingSchema(error)) return { error: MISSING_MSG };
    console.error("saveRentReminderSettings", { code: error.code });
    return { error: "Hatırlatma ayarları kaydedilemedi." };
  }
  revalidatePath("/app/kiralama");
  return { ok: true };
}

/** Kiracının hatırlatma almak istememesi (opt-out). Kiralama kaydından kiracı bulunur; tenant doğrulanır. */
export async function setRenterReminderOptOut(rentalId: string, optOut: boolean): Promise<RentReminderResult> {
  const gate = await requirePermission("rentals", "edit");
  if (!gate.ok) return { error: gate.error };
  const supabase = await createClient();
  const { data: rental } = await supabase
    .from("rentals")
    .select("renter_customer_id")
    .eq("id", rentalId)
    .eq("tenant_id", gate.tenantId)
    .maybeSingle();
  const renterId = (rental as { renter_customer_id?: string } | null)?.renter_customer_id;
  if (!renterId) return { error: "Kira kaydı bulunamadı." };
  const { error } = await supabase
    .from("customers")
    .update({ rent_reminder_opt_out: optOut === true, rent_reminder_opt_out_at: optOut ? new Date(now()).toISOString() : null })
    .eq("id", renterId)
    .eq("tenant_id", gate.tenantId);
  if (error) {
    if (isMissingSchema(error)) return { error: MISSING_MSG };
    console.error("setRenterReminderOptOut", { code: error.code });
    return { error: "Tercih kaydedilemedi." };
  }
  revalidatePath(`/app/kiralama/${rentalId}`);
  return { ok: true };
}

/**
 * Müşteri kartından kira hatırlatması tercihi (KVKK: kişinin "istemiyorum" talebi kayda alınır, zaman damgalı).
 * Kiralama ekranındaki `setRenterReminderOptOut` ile aynı sütunlar; burada kapı müşteri düzenleme iznidir.
 */
export async function setCustomerRentReminderOptOut(customerId: string, optOut: boolean): Promise<RentReminderResult> {
  const gate = await requirePermission("customers", "edit");
  if (!gate.ok) return { error: gate.error };
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(String(customerId ?? ""))) return { error: "Müşteri bulunamadı." };
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("customers")
    .update({ rent_reminder_opt_out: optOut === true, rent_reminder_opt_out_at: optOut ? new Date(now()).toISOString() : null })
    .eq("id", customerId)
    .eq("tenant_id", gate.tenantId)
    .select("id")
    .maybeSingle();
  if (error) {
    if (isMissingSchema(error)) return { error: MISSING_MSG };
    console.error("setCustomerRentReminderOptOut", { code: error.code });
    return { error: "Tercih kaydedilemedi." };
  }
  if (!data) return { error: "Müşteri bulunamadı." };
  await logActivity({
    tenantId: gate.tenantId,
    actorId: gate.userId,
    action: "customer.rent_reminder_opt_out",
    entityType: "customer",
    entityId: customerId,
    newValue: { opt_out: optOut === true },
  });
  revalidatePath(`/app/musteriler/${customerId}`);
  return { ok: true };
}

/** Ofis wa.me ile mesajı gönderdi: kuyruktaki ofis kanalı kaydı "gönderildi" olur. */
export async function markReminderSent(reminderId: string, rentalId: string): Promise<RentReminderResult> {
  const gate = await requirePermission("rentals", "edit");
  if (!gate.ok) return { error: gate.error };
  const supabase = await createClient();
  const { error } = await supabase
    .from("rent_reminders")
    .update({ status: "sent", sent_at: new Date(now()).toISOString() })
    .eq("id", reminderId)
    .eq("rental_id", rentalId)
    .eq("tenant_id", gate.tenantId)
    .eq("channel", "office");
  if (error) {
    if (isMissingSchema(error)) return { error: MISSING_MSG };
    return { error: "Kayıt güncellenemedi." };
  }
  revalidatePath(`/app/kiralama/${rentalId}`);
  return { ok: true };
}
