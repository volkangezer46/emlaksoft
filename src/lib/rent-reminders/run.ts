/**
 * Kiracı kira hatırlatma çalıştırıcısı — `kira-tahakkuk` cron'u çağırır (yeni cron AÇILMAZ).
 *
 * Güvenlik/uyum kapıları (hepsi sunucuda):
 *  1. Ofis ayarı KAPALI doğar: `rent_reminder_settings.enabled=true` olmayan ofiste hiçbir şey üretilmez.
 *  2. Kiracı opt-out (`customers.rent_reminder_opt_out`): hiçbir kanalda üretilmez; kayıt `skipped` düşer (dedupe).
 *  3. Dedupe: `rent_reminders` unique(rental_id, period, kind, channel) — önce satır "kapılır" (insert), sonra iş yapılır.
 *  4. Kanal 1 (her zaman, ayar açıksa): ofise bildirim; mesaj kiralama sayfasındaki Hatırlatma sekmesinde wa.me ile TEK TIKLA gönderilir.
 *  5. Kanal 2 (yalnız `sms_enabled` + ofisin kendi SMS entegrasyonu hazırsa): kiracıya SMS. Yalnız TR cep numarası
 *     (`parsePhoneStrict` → saklama biçimi), sessiz saatte gönderilmez (satır oluşturulmaz, ertesi çalışmada tolerans penceresinde yeniden denenir),
 *     aynı kiracıya 20 saatte en çok 1 SMS, bir çalıştırmada ofis başına en çok 100 SMS.
 *  6. Tablolar/sütunlar yoksa (migration uygulanmamış) sessizce atlanır; cron'un asıl işi etkilenmez.
 * `createAdminClient` BURADA çağrılmaz: cron'un mevcut (kabul listesindeki) istemcisi parametre olarak gelir.
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import { isTenantSmsAvailable, sendTenantSms } from "@/lib/messaging/tenant-providers";
import { parsePhoneStrict } from "@/lib/phone-rules";
import {
  KIND_LABELS,
  buildReminderMessage,
  isQuietHour,
  isSmsEligibleStoredPhone,
  normalizeReminderSettings,
  pickReminder,
  type ReminderKind,
  type ReminderSettings,
} from "./logic";

export const SMS_PER_TENANT_PER_RUN = 100;
const SMS_RECENT_MS = 20 * 3_600_000;

export type RentalForReminder = {
  id: string;
  tenant_id: string;
  monthly_rent: number;
  due_day: number;
  start_date: string;
  end_date: string | null;
  property: { property_code?: string; title?: string | null } | { property_code?: string; title?: string | null }[] | null;
};

export type ReminderRunSummary = {
  enabledTenants: number;
  office: number;
  sms: number;
  skippedOptOut: number;
  smsFailed: number;
  schemaMissing: boolean;
};

const EMPTY: ReminderRunSummary = { enabledTenants: 0, office: 0, sms: 0, skippedOptOut: 0, smsFailed: 0, schemaMissing: false };

type RenterRow = { id: string; full_name: string | null; phone: string | null; rent_reminder_opt_out: boolean | null };
type DbError = { code?: string | null; message?: string | null } | null;

function isMissingSchema(e: DbError): boolean {
  if (!e) return false;
  const code = String(e.code ?? "");
  return code === "42P01" || code === "42703" || code === "PGRST205" || code === "PGRST204" || /does not exist|schema cache/i.test(String(e.message ?? ""));
}
const one = <T,>(v: T | T[] | null | undefined): T | null => (Array.isArray(v) ? (v[0] ?? null) : (v ?? null));
const chunk = <T,>(arr: T[], n: number): T[][] => {
  const out: T[][] = [];
  for (let i = 0; i < arr.length; i += n) out.push(arr.slice(i, i + n));
  return out;
};

export async function runRentReminders(input: {
  admin: SupabaseClient;
  rentals: readonly RentalForReminder[];
  /** Türkiye günü `YYYY-MM-DD`. */
  today: string;
  nowMs: number;
}): Promise<ReminderRunSummary> {
  const out: ReminderRunSummary = { ...EMPTY };
  const { admin, today, nowMs } = input;
  if (input.rentals.length === 0) return out;

  // 1) Ayarı AÇIK ofisler (KAPALI doğar; satırı olmayan = kapalı).
  const tenantIds = [...new Set(input.rentals.map((r) => r.tenant_id))];
  const settingsByTenant = new Map<string, ReminderSettings>();
  for (const part of chunk(tenantIds, 200)) {
    const { data, error } = await admin.from("rent_reminder_settings").select("*").eq("enabled", true).in("tenant_id", part);
    if (error) return { ...out, schemaMissing: isMissingSchema(error) };
    for (const row of (data ?? []) as Record<string, unknown>[]) {
      settingsByTenant.set(String(row.tenant_id), normalizeReminderSettings(row));
    }
  }
  out.enabledTenants = settingsByTenant.size;
  if (settingsByTenant.size === 0) return out;

  const rentals = input.rentals.filter((r) => settingsByTenant.has(r.tenant_id));
  const rentalIds = rentals.map((r) => r.id);

  // 2) Kiracılar (opt-out dahil), tahsil edilmiş dönemler, mevcut hatırlatma kayıtları.
  const renterByRental = new Map<string, RenterRow>();
  const paid = new Map<string, Set<string>>();
  const done = new Set<string>();
  const recentSmsRenters = new Set<string>();
  const sinceIso = new Date(nowMs - 120 * 86_400_000).toISOString();
  const recentIso = new Date(nowMs - SMS_RECENT_MS).toISOString();
  for (const part of chunk(rentalIds, 200)) {
    const [renters, charges, logs] = await Promise.all([
      admin
        .from("rentals")
        .select("id, renter:customers!rentals_renter_customer_id_fkey(id, full_name, phone, rent_reminder_opt_out)")
        .in("id", part),
      admin.from("rent_charges").select("rental_id, period").eq("status", "paid").gte("period", sinceIso.slice(0, 10)).in("rental_id", part),
      admin.from("rent_reminders").select("rental_id, period, kind, channel, status, sent_at").gte("created_at", sinceIso).in("rental_id", part),
    ]);
    if (renters.error) return { ...out, schemaMissing: isMissingSchema(renters.error) };
    if (charges.error || logs.error) return { ...out, schemaMissing: isMissingSchema(charges.error) || isMissingSchema(logs.error) };
    for (const r of (renters.data ?? []) as { id: string; renter: RenterRow | RenterRow[] | null }[]) {
      const renter = one(r.renter);
      if (renter) renterByRental.set(r.id, renter);
    }
    for (const c of (charges.data ?? []) as { rental_id: string; period: string }[]) {
      const set = paid.get(c.rental_id) ?? new Set<string>();
      set.add(String(c.period).slice(0, 10));
      paid.set(c.rental_id, set);
    }
    for (const l of (logs.data ?? []) as { rental_id: string; period: string; kind: string; channel: string; status: string; sent_at: string | null }[]) {
      done.add(`${l.rental_id}|${String(l.period).slice(0, 10)}|${l.kind}|${l.channel}`);
      if (l.channel === "sms" && l.status === "sent" && l.sent_at && l.sent_at >= recentIso) {
        const renter = renterByRental.get(l.rental_id);
        if (renter) recentSmsRenters.add(renter.id);
      }
    }
  }

  // Ofis adı (mesaj imzası) + SMS hazırlığı (ofis başına bir kez).
  const officeName = new Map<string, string | null>();
  const smsReady = new Map<string, boolean>();
  const smsSent = new Map<string, number>();
  {
    const { data } = await admin.from("tenants").select("id, name").in("id", [...settingsByTenant.keys()]);
    for (const t of (data ?? []) as { id: string; name: string | null }[]) officeName.set(t.id, t.name);
  }
  const quiet = (s: ReminderSettings) => isQuietHour(nowMs, s.quietStartHour, s.quietEndHour);

  for (const rental of rentals) {
    const settings = settingsByTenant.get(rental.tenant_id)!;
    const pick = pickReminder({
      today,
      dueDay: rental.due_day,
      startDate: rental.start_date,
      endDate: rental.end_date,
      paidPeriods: paid.get(rental.id) ?? new Set<string>(),
      settings,
    });
    if (!pick) continue;
    const renter = renterByRental.get(rental.id);
    const prop = one(rental.property);
    const propName = prop?.title ?? prop?.property_code ?? "Portföy";
    const key = (channel: string) => `${rental.id}|${pick.period}|${pick.kind}|${channel}`;

    // Kiracı opt-out: iki kanal da `skipped` olarak kapatılır (tekrar tekrar değerlendirilmesin).
    if (!renter || renter.rent_reminder_opt_out === true) {
      const rows = (["office", "sms"] as const)
        .filter((c) => !done.has(key(c)))
        .map((channel) => ({ tenant_id: rental.tenant_id, rental_id: rental.id, period: pick.period, kind: pick.kind, channel, status: "skipped", reason: renter ? "opt_out" : "kiraci_yok" }));
      if (rows.length > 0) {
        const { error } = await admin.from("rent_reminders").upsert(rows, { onConflict: "rental_id,period,kind,channel", ignoreDuplicates: true });
        if (!error) out.skippedOptOut += 1;
      }
      continue;
    }

    // Kanal 1: ofis bildirimi (wa.me ile tek tıkla gönderim kiralama sayfasında).
    if (!done.has(key("office"))) {
      const { data: claimed, error } = await admin
        .from("rent_reminders")
        .upsert(
          [{ tenant_id: rental.tenant_id, rental_id: rental.id, period: pick.period, kind: pick.kind, channel: "office", status: "queued" }],
          { onConflict: "rental_id,period,kind,channel", ignoreDuplicates: true },
        )
        .select("id");
      if (error) {
        if (isMissingSchema(error)) return { ...out, schemaMissing: true };
        console.error("rent-reminders office claim", { code: error.code });
      } else if ((claimed ?? []).length > 0) {
        const { error: nErr } = await admin.from("notifications").insert({
          tenant_id: rental.tenant_id,
          title: `Kira hatırlatması hazır: ${KIND_LABELS[pick.kind]}`,
          body: `${propName} · ${renter.full_name ?? "Kiracı"} — WhatsApp mesajı hazır; tek tıkla gönderin.`,
          href: `/app/kiralama/${rental.id}?sekme=hatirlatma`,
          kind: pick.kind === "late" ? "warning" : "info",
        });
        if (nErr) console.error("rent-reminders notification", { code: nErr.code });
        else out.office += 1;
      }
    }

    // Kanal 2: SMS (ofis ayarı + kendi entegrasyonu + TR cep + sessiz saat dışı + oran sınırı).
    if (settings.smsEnabled && !done.has(key("sms"))) {
      if (quiet(settings)) continue; // satır açılmaz: tolerans penceresinde sonraki çalışmada yeniden denenir
      if ((smsSent.get(rental.tenant_id) ?? 0) >= SMS_PER_TENANT_PER_RUN) continue;
      if (recentSmsRenters.has(renter.id)) continue;
      const phone = parsePhoneStrict(renter.phone);
      if (!phone.ok || !isSmsEligibleStoredPhone(phone.stored)) continue;
      if (!smsReady.has(rental.tenant_id)) smsReady.set(rental.tenant_id, await isTenantSmsAvailable(rental.tenant_id));
      if (!smsReady.get(rental.tenant_id)) continue;

      const { data: claimed, error } = await admin
        .from("rent_reminders")
        .upsert(
          [{ tenant_id: rental.tenant_id, rental_id: rental.id, period: pick.period, kind: pick.kind, channel: "sms", status: "queued" }],
          { onConflict: "rental_id,period,kind,channel", ignoreDuplicates: true },
        )
        .select("id");
      if (error || (claimed ?? []).length === 0) continue;
      const logId = (claimed as { id: string }[])[0]!.id;

      const text = buildReminderMessage({
        kind: pick.kind as ReminderKind,
        renterName: renter.full_name,
        officeName: officeName.get(rental.tenant_id) ?? null,
        amount: Number(rental.monthly_rent),
        due: pick.due,
      });
      let ok = false;
      let reason: string | null = null;
      try {
        const res = await sendTenantSms(rental.tenant_id, phone.stored, text);
        ok = res.ok === true;
        if (!ok) reason = String((res as { code?: string }).code ?? "gonderilemedi").slice(0, 200);
      } catch {
        reason = "istisna";
      }
      await admin
        .from("rent_reminders")
        .update({ status: ok ? "sent" : "failed", sent_at: ok ? new Date(nowMs).toISOString() : null, reason })
        .eq("id", logId);
      if (ok) {
        out.sms += 1;
        smsSent.set(rental.tenant_id, (smsSent.get(rental.tenant_id) ?? 0) + 1);
        recentSmsRenters.add(renter.id);
      } else out.smsFailed += 1;
    }
  }
  return out;
}
