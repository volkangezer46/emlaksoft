import { NextRequest, NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { recordHeartbeat } from "@/lib/cron-heartbeat";
import { computeLegalIncreaseIn } from "@/lib/tufe";
import { loadTufeTable } from "@/lib/tufe-server";
import { getDisabledModulesByTenant, isDisabledFor, skippedTenantsNote } from "@/lib/modules/state";
import { authorizeCron } from "@/lib/cron-auth";
import { runRentReminders, type RentalForReminder } from "@/lib/rent-reminders/run";
import { trDayKey } from "@/lib/clock";
import { findNotifiedKeys, insertNotifications } from "@/lib/notify-batch";

type PropRel = { property_code?: string; title?: string | null } | { property_code?: string; title?: string | null }[] | null;

type RentalRow = {
  id: string;
  tenant_id: string;
  monthly_rent: number;
  due_day: number;
  start_date: string;
  end_date: string | null;
  property: PropRel;
};

type ChargeRow = {
  id: string;
  tenant_id: string;
  rental_id: string;
  period: string;
  amount: number;
  rental:
    | { due_day: number; property: { property_code?: string; title?: string | null } | { property_code?: string; title?: string | null }[] | null }
    | { due_day: number; property: { property_code?: string; title?: string | null } | { property_code?: string; title?: string | null }[] | null }[]
    | null;
};

/** `YYYY-MM-01` + vade günü → `YYYY-MM-DD` (string karşılaştırması yeterli). */
function dueDateOf(period: string, dueDay: number) {
  return `${period.slice(0, 7)}-${String(Math.min(Math.max(dueDay, 1), 28)).padStart(2, "0")}`;
}

/** start_date'in bugünden sonraki ilk yıldönümü — /app/kiralama radarıyla aynı mantık (29 Şubat → 28). */
function nextAnniversaryOf(startDate: string, today: string): string | null {
  const mm = startDate.slice(5, 7);
  const dd = mm === "02" && startDate.slice(8, 10) === "29" ? "28" : startDate.slice(8, 10);
  const y = Number(today.slice(0, 4));
  let cand = `${y}-${mm}-${dd}`;
  if (cand < today) cand = `${y + 1}-${mm}-${dd}`;
  return cand > startDate ? cand : null;
}

/**
 * Aylık kira tahakkuk cron'u — günlük çalışacak şekilde idempotent:
 *  1. Aktif kiralarda bu ayın vade günü GEÇMİŞ ve o ay için tahakkuk YOKSA
 *     'pending' tahakkuk oluşturur (unique(rental_id, period) mükerreri keser).
 *  2. Vadesi 7+ gün geçmiş 'pending' tahakkukları 'overdue' yapar ve
 *     kiracı ofise (tenant) bildirim yazar.
 *  3. Yenileme radarı: yıldönümüne (ya da sözleşme bitişine) 60 gün kala
 *     TÜFE tavanlı önerilen yeni kirayla TEK SEFERLİK bildirim yazar —
 *     mükerrer koruması href'teki `?yenileme={yıl}` işaretiyle sağlanır.
 *  4. Kiracı hatırlatması (H3): ofis ayarı AÇIKSA (KAPALI doğar) vade yaklaşan/gelen/geciken kiralar için ofise wa.me
 *     bildirimi ve (ayrıca açıksa + ofisin kendi SMS entegrasyonu hazırsa) kiracıya SMS. Ayrıntı: src/lib/rent-reminders/run.ts.
 *
 * NOT: vercel.json'a bilerek DOKUNULMADI — cron path: /api/cron/kira-tahakkuk
 * (CRON_SECRET Bearer başlığıyla çağrılır).
 */
/** Uzun süren toplu işlem: varsayılan süre yetmeyebilir. */
export const maxDuration = 300;

export async function GET(req: NextRequest) {
  const denied = authorizeCron(req);
  if (denied) return denied;

  const admin = createAdminClient();
  const today = new Date().toISOString().slice(0, 10);
  const period = `${today.slice(0, 7)}-01`;

  // ---- 1) Bu ayın eksik tahakkuklarını oluştur ----
  // Modül kapısı: "Kiralama" kapalı ofislerde tahakkuk/gecikme/yenileme üretilmez (veri silinmez).
  const disabledModules = await getDisabledModulesByTenant(admin);
  const { data: allRentals, error: rentalsErr } = await admin
    .from("rentals")
    .select("id, tenant_id, monthly_rent, due_day, start_date, end_date, property:properties!rentals_property_id_fkey(property_code, title)")
    .eq("status", "active")
    .limit(2000);
  const rentals = (allRentals ?? []).filter((r) => !isDisabledFor(disabledModules, String(r.tenant_id), "rentals"));

  if (rentalsErr) {
    console.error("kira-tahakkuk cron rentals", rentalsErr);
    await recordHeartbeat("kira-tahakkuk", "error", "kira sorgusu başarısız");
    return NextResponse.json({ error: "query_failed" }, { status: 500 });
  }

  const { data: existing, error: existingErr } = await admin
    .from("rent_charges")
    .select("rental_id")
    .eq("period", period)
    .limit(5000);

  if (existingErr) {
    console.error("kira-tahakkuk cron charges", existingErr);
    await recordHeartbeat("kira-tahakkuk", "error", "tahakkuk sorgusu başarısız");
    return NextResponse.json({ error: "query_failed" }, { status: 500 });
  }

  const hasCharge = new Set((existing ?? []).map((c) => c.rental_id as string));

  const toInsert = ((rentals ?? []) as RentalRow[])
    .filter((r) => {
      if (hasCharge.has(r.id)) return false;
      const due = dueDateOf(period, r.due_day);
      if (today < due) return false; // vade günü henüz gelmedi
      if (r.start_date > due) return false; // sözleşme bu dönemden sonra başlıyor
      if (r.end_date && r.end_date < due) return false; // sözleşme vadeden önce bitmiş
      return true;
    })
    .map((r) => ({
      tenant_id: r.tenant_id,
      rental_id: r.id,
      period,
      amount: r.monthly_rent,
      status: "pending" as const,
    }));

  let created = 0;
  if (toInsert.length > 0) {
    // unique(rental_id, period) yarışı: upsert + ignoreDuplicates → çifte cron güvenli
    const { data: inserted, error: insErr } = await admin
      .from("rent_charges")
      .upsert(toInsert, { onConflict: "rental_id,period", ignoreDuplicates: true })
      .select("id");
    if (insErr) console.error("kira-tahakkuk cron insert", insErr);
    else created = (inserted ?? []).length;
  }

  // ---- 2) Vadesi 7+ gün geçmiş pending → overdue + bildirim ----
  const { data: pending, error: pendingErr } = await admin
    .from("rent_charges")
    .select("id, tenant_id, rental_id, period, amount, rental:rentals!rent_charges_rental_id_fkey(due_day, property:properties!rentals_property_id_fkey(property_code, title))")
    .eq("status", "pending")
    .lte("period", period)
    .limit(2000);

  if (pendingErr) console.error("kira-tahakkuk cron pending", pendingErr);

  const limitDate = new Date(Date.now() - 7 * 86_400_000).toISOString().slice(0, 10);
  let overdueCount = 0;

  for (const c of ((pending ?? []) as ChargeRow[])) {
    if (isDisabledFor(disabledModules, c.tenant_id, "rentals")) continue;
    const rentalRel = Array.isArray(c.rental) ? c.rental[0] : c.rental;
    const dueDay = rentalRel?.due_day ?? 1;
    const due = dueDateOf(String(c.period).slice(0, 10), dueDay);
    if (due > limitDate) continue; // 7 gün dolmamış

    const { error: updErr } = await admin.from("rent_charges").update({ status: "overdue" }).eq("id", c.id);
    if (updErr) {
      console.error("kira-tahakkuk cron overdue", updErr);
      continue;
    }

    const propRel = rentalRel?.property;
    const prop = Array.isArray(propRel) ? propRel[0] : propRel;
    const propName = prop?.title ?? prop?.property_code ?? "Portföy";
    const donem = new Intl.DateTimeFormat("tr-TR", { month: "long", year: "numeric" }).format(
      new Date(`${String(c.period).slice(0, 10)}T00:00:00`),
    );
    const tutar = new Intl.NumberFormat("tr-TR", { style: "currency", currency: "TRY", maximumFractionDigits: 0 }).format(
      Number(c.amount),
    );

    await admin.from("notifications").insert({
      tenant_id: c.tenant_id,
      title: "Geciken kira tahakkuku",
      body: `${propName} · ${donem} · ${tutar} — vade 7+ gün geçti`,
      href: `/app/kiralama/${c.rental_id}`,
      kind: "warning",
    });

    overdueCount += 1;
  }

  // ---- 3) Yenileme radarı: yıldönümüne 60 gün kala tek seferlik bildirim ----
  const in60 = new Date(Date.now() + 60 * 86_400_000).toISOString().slice(0, 10);
  const para = (n: number) =>
    new Intl.NumberFormat("tr-TR", { style: "currency", currency: "TRY", maximumFractionDigits: 0 }).format(n);

  const candidates = ((rentals ?? []) as RentalRow[]).flatMap((r) => {
    const anniversary = nextAnniversaryOf(r.start_date, today);
    const annDue = anniversary && anniversary <= in60 ? anniversary : null;
    const endDue = r.end_date && r.end_date >= today && r.end_date <= in60 ? r.end_date : null;
    const renewalDate = annDue && endDue ? (annDue < endDue ? annDue : endDue) : (annDue ?? endDue);
    if (!renewalDate) return [];
    // Mükerrer marker'ı: aynı kira + aynı yenileme yılı için tek bildirim
    return [{ r, renewalDate, href: `/app/kiralama/${r.id}?yenileme=${renewalDate.slice(0, 4)}` }];
  });

  let renewalNotified = 0;
  // TÜFE: yönetimin tablosu (yoksa gömülü); kiralama sayfası ve yasal artış işlemiyle aynı kaynak.
  const tufeTable = await loadTufeTable();
  if (candidates.length > 0) {
    const { data: existingNotifs, error: notifErr } = await admin
      .from("notifications")
      .select("href")
      .in("href", candidates.map((c) => c.href))
      .limit(candidates.length);
    if (notifErr) console.error("kira-tahakkuk cron yenileme sorgusu", notifErr);

    const already = new Set((existingNotifs ?? []).map((n) => n.href as string));
    for (const { r, renewalDate, href } of candidates) {
      if (notifErr || already.has(href)) continue;
      const prop = Array.isArray(r.property) ? r.property[0] : r.property;
      const propName = prop?.title ?? prop?.property_code ?? "Portföy";
      const increase = computeLegalIncreaseIn(tufeTable, Number(r.monthly_rent), renewalDate.slice(0, 7));
      const kalanGun = Math.max(0, Math.ceil((new Date(`${renewalDate}T00:00:00`).getTime() - new Date(`${today}T00:00:00`).getTime()) / 86_400_000));

      // Resmi TÜFE'si olmayan yenileme ayında (ör. 2026) uydurma bir tavan/tutar
      // ÖNERİLMEZ — kullanıcı yanıltılmasın; resmi oran açıklanınca hesaplanır.
      const oneri = increase.official
        ? `önerilen yeni kira ${para(increase.newRent)} (TÜFE %${increase.appliedRate.toFixed(2)})`
        : `resmi TÜFE açıklanınca yeni kira hesaplanmalı (mevcut ${para(Number(r.monthly_rent))})`;
      const { error: insNotifErr } = await admin.from("notifications").insert({
        tenant_id: r.tenant_id,
        title: "Kira yenileme yaklaşıyor",
        body: `'${propName}' kirasının yenilenmesine ${kalanGun} gün — ${oneri}`,
        href,
        kind: "info",
      });
      if (insNotifErr) console.error("kira-tahakkuk cron yenileme bildirimi", insNotifErr);
      else renewalNotified += 1;
    }
  }

  // ---- 4) Kiracı hatırlatması (kapalı doğar; hata cron'un asıl işini bozmaz) ----
  let reminderNote = "";
  let reminders: Awaited<ReturnType<typeof runRentReminders>> | null = null;
  try {
    reminders = await runRentReminders({
      admin,
      rentals: (rentals ?? []) as unknown as RentalForReminder[],
      today: trDayKey(Date.now()),
      nowMs: Date.now(),
    });
    if (reminders.enabledTenants > 0) {
      reminderNote = `, hatırlatma: ${reminders.office} ofis / ${reminders.sms} SMS${reminders.smsFailed ? ` (${reminders.smsFailed} SMS hatası)` : ""}`;
    }
  } catch (e) {
    console.error("kira-tahakkuk cron hatirlatma", e);
    reminderNote = ", hatırlatma atlandı (hata)";
  }

  // ---- 5) Mart: kira geliri beyanı hatırlatması (ofise yılda bir; tutar YAZILMAZ). Anahtar kolonu yoksa yazılmaz. ----
  let declarationNotified = 0;
  try {
    const today = trDayKey(Date.now());
    if (today.slice(5, 7) === "03") {
      const year = today.slice(0, 4);
      const tenantIds = [...new Set(((rentals ?? []) as { tenant_id: string }[]).map((r) => r.tenant_id))].filter(
        (id) => !isDisabledFor(disabledModules, id, "rentals"),
      );
      const keys = tenantIds.map((id) => `rent-decl:${id}:${year}`);
      const seen = tenantIds.length > 0 ? await findNotifiedKeys(admin, { tenantIds, keys }) : new Set<string>();
      if (seen !== null) {
        declarationNotified = await insertNotifications(
          admin,
          tenantIds
            .filter((id) => !seen.has(`rent-decl:${id}:${year}`))
            .map((id) => ({
              tenant_id: id,
              title: "Kira geliri beyanı dönemi",
              body:
                "Maliklerinize geçen yılın kira ekstresini (malik paneli > Kira ekstresi) hatırlatabilirsiniz. " +
                "Beyan yükümlülüğü ve tutarlar için mali müşavirlerine yönlendirin.",
              href: "/app/kiralama",
              kind: "info",
              dedupe_key: `rent-decl:${id}:${year}`,
            })),
        );
      }
    }
  } catch (e) {
    console.error("kira-tahakkuk cron beyan hatirlatma", e instanceof Error ? e.message : "hata");
  }

  await recordHeartbeat(
    "kira-tahakkuk",
    "ok",
    `${created} tahakkuk, ${overdueCount} gecikme, ${renewalNotified} yenileme bildirimi${reminderNote}${declarationNotified ? `, ${declarationNotified} beyan hatırlatması` : ""}${skippedTenantsNote(disabledModules, "rentals")}`,
  );

  return NextResponse.json({
    ok: true,
    created,
    overdue: overdueCount,
    renewals: renewalNotified,
    reminders: reminders ? { office: reminders.office, sms: reminders.sms, skippedOptOut: reminders.skippedOptOut } : null,
  });
}
