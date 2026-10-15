import { guardCron } from "@/lib/cron-run";
import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { recordHeartbeat } from "@/lib/cron-heartbeat";
import { authorizeCron } from "@/lib/cron-auth";
import { beginCronRun } from "@/lib/cron-pause";
import { now, trDayKey, trParts } from "@/lib/clock";
import { readAllPaged } from "@/lib/supabase/read-all-paged";
import { insertNotificationsDetailed, type NotificationRow } from "@/lib/notify-batch";
import { getDisabledModulesByTenant, isDisabledFor, skippedTenantsNote } from "@/lib/modules/state";

/** Toplu/uzun işlem: varsayılan süre yetmeyebilir. */
export const maxDuration = 300;

/** Özel gün hatırlatması bir otomatik hatırlatmadır: ofis "Otomasyon ve iş akışları" modülünü kapattıysa atlanır. */
const MODULE_KEY = "automation" as const;

/** "YYYY-MM-DD…" → "MM-DD" (takvim tarihi; saat dilimi dönüşümü YOK). Biçim bozuksa null. */
function monthDayOf(value: unknown): string | null {
  const m = /^\d{4}-(\d{2})-(\d{2})/.exec(String(value ?? ""));
  return m ? `${m[1]}-${m[2]}` : null;
}

function isLeapYear(year: number): boolean {
  return (year % 4 === 0 && year % 100 !== 0) || year % 400 === 0;
}

/**
 * Bugün (TR) eşleşen "AA-GG" anahtarları. Artık yıl olmayan yıllarda 28 Şubat günü 29 Şubat
 * doğumlular/yıldönümleri de dahil edilir (yoksa dört yılda bir hatırlanırlardı).
 */
function todayMonthDayKeys(nowMs: number): Set<string> {
  const { year, month, day } = trParts(nowMs);
  const key = `${String(month + 1).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
  const keys = new Set([key]);
  if (key === "02-28" && !isLeapYear(year)) keys.add("02-29");
  return keys;
}

type BirthdayRow = { id: string; full_name: string | null; tenant_id: string; assigned_to: string | null; birth_date: string | null };
type AnniversaryRow = {
  id: string;
  full_name: string | null;
  tenant_id: string;
  assigned_to: string | null;
  anniversary_date: string | null;
  anniversary_note: string | null;
};
type StaffRow = { id: string; tenant_id: string; role: string | null };

type SpecialDayCustomer = { id: string; tenant_id: string; assigned_to: string | null; full_name: string | null };

/**
 * Özel gün bildirimi KİŞİYE gider (B073): müşterinin danışmanına (aynı ofiste aktif profil); danışmanı yoksa ya da
 * pasifse ofis sahibine/sahiplerine. Ofis geneline (user_id NULL) isim listesi GİTMEZ: kapsamı dar kullanıcılar
 * görmemesi gereken müşteri adlarını görmüyordu. Her müşteri için tek kayıt, bağlantı müşterinin kendisini açar;
 * aynı gün ikinci koşu `dedupe_key` ile tekrar yazmaz. SAF (test edilebilir).
 */
function buildSpecialDayNotifications(input: {
  births: readonly SpecialDayCustomer[];
  annivs: readonly (SpecialDayCustomer & { anniversary_note: string | null })[];
  staff: readonly StaffRow[];
  dayKey: string;
}): { rows: NotificationRow[]; unrouted: number } {
  const active = new Map<string, string>();
  const owners = new Map<string, string[]>();
  for (const p of input.staff) {
    active.set(p.id, p.tenant_id);
    if (p.role === "owner") owners.set(p.tenant_id, [...(owners.get(p.tenant_id) ?? []), p.id]);
  }
  const recipients = (c: SpecialDayCustomer): string[] => {
    if (c.assigned_to && active.get(c.assigned_to) === c.tenant_id) return [c.assigned_to];
    return owners.get(c.tenant_id) ?? [];
  };
  const rows: NotificationRow[] = [];
  let unrouted = 0;
  const push = (c: SpecialDayCustomer, kind: "dogum" | "yildonumu", title: string, body: string) => {
    const to = recipients(c);
    if (to.length === 0) unrouted += 1;
    for (const userId of to) {
      rows.push({
        tenant_id: c.tenant_id,
        user_id: userId,
        title,
        body,
        href: `/app/musteriler/${c.id}`,
        kind: "info",
        dedupe_key: `ozel-gun:${kind}:${c.id}:${userId}:${input.dayKey}`,
      });
    }
  };
  for (const c of input.births) {
    const name = c.full_name?.trim() || "Müşteri";
    push(c, "dogum", `🎂 Doğum günü: ${name}`, "Bugün müşterinizin doğum günü. Kısa bir tebrik ilişkiyi tazeler.");
  }
  for (const c of input.annivs) {
    const name = c.full_name?.trim() || "Müşteri";
    const note = c.anniversary_note?.trim();
    push(c, "yildonumu", `🎉 Yıldönümü: ${name}`, note ? `Bugün: ${note}` : "Bugün müşterinizin yıldönümü.");
  }
  return { rows, unrouted };
}

/**
 * Cron: Bugün (Türkiye günü) doğum günü veya yıldönümü olan müşterileri tespit et,
 * müşterinin danışmanına (yoksa ofis sahibine) kişisel bildirim gönder.
 *
 * Tüm ofisleri tarar (kiracı süzgeci yok) ama SAYFALIDIR: PostgREST 1000 satır sınırında sessizce
 * kesilmez; sınıra ulaşılırsa ya da okuma hatası olursa heartbeat'e not düşülür.
 * Zamanlama: vercel.json (tek kaynak). Yetki: CRON_SECRET header kontrolü.
 */
async function run(req: Request) {
  const denied = authorizeCron(req);
  if (denied) return denied;
  const pausedRun = await beginCronRun("dogum-gunu", req);
  if (pausedRun) return pausedRun;

  const admin = createAdminClient();
  const nowMs = now();
  const { month, day } = trParts(nowMs);
  const todayKeys = todayMonthDayKeys(nowMs);

  const [birthRes, annivRes, disabledModules] = await Promise.all([
    readAllPaged<BirthdayRow>((from, to) =>
      admin
        .from("customers")
        .select("id, full_name, tenant_id, assigned_to, birth_date")
        .eq("is_sample", false)
        .is("deleted_at", null)
        .not("birth_date", "is", null)
        .order("id")
        .range(from, to),
    ),
    readAllPaged<AnniversaryRow>((from, to) =>
      admin
        .from("customers")
        .select("id, full_name, tenant_id, assigned_to, anniversary_date, anniversary_note")
        .eq("is_sample", false)
        .is("deleted_at", null)
        .not("anniversary_date", "is", null)
        .order("id")
        .range(from, to),
    ),
    getDisabledModulesByTenant(admin),
  ]);

  const notes: string[] = [];
  if (birthRes.error) notes.push(`doğum günü okuması kısmi: ${birthRes.error}`);
  if (birthRes.truncated) notes.push(`doğum günü listesi sınırda kesildi (${birthRes.rows.length})`);
  if (annivRes.error) notes.push(`yıldönümü okuması kısmi: ${annivRes.error}`);
  if (annivRes.truncated) notes.push(`yıldönümü listesi sınırda kesildi (${annivRes.rows.length})`);

  const isToday = (value: unknown) => {
    const md = monthDayOf(value);
    return md !== null && todayKeys.has(md);
  };
  const todayBirthdays = birthRes.rows.filter((c) => isToday(c.birth_date));
  const todayAnniversaries = annivRes.rows.filter((c) => isToday(c.anniversary_date));

  // Tenant bazlı grupla (modülü kapalı ofis atlanır)
  const byTenant = new Map<string, { births: BirthdayRow[]; annivs: AnniversaryRow[] }>();
  const bucket = (tid: string) => {
    let b = byTenant.get(tid);
    if (!b) byTenant.set(tid, (b = { births: [], annivs: [] }));
    return b;
  };
  for (const c of todayBirthdays) if (!isDisabledFor(disabledModules, c.tenant_id, MODULE_KEY)) bucket(c.tenant_id).births.push(c);
  for (const c of todayAnniversaries) if (!isDisabledFor(disabledModules, c.tenant_id, MODULE_KEY)) bucket(c.tenant_id).annivs.push(c);

  // Alıcılar: yalnız bugün özel günü olan ofislerin aktif profilleri (danışman eşlemesi + sahip yedeği).
  const tenantIds = [...byTenant.keys()];
  const staffRes =
    tenantIds.length > 0
      ? await readAllPaged<StaffRow>((from, to) =>
          admin
            .from("profiles")
            .select("id, tenant_id, role")
            .in("tenant_id", tenantIds)
            .eq("is_active", true)
            .order("id")
            .range(from, to),
        )
      : { rows: [] as StaffRow[], error: null, truncated: false };
  if (staffRes.error) notes.push(`ekip okuması kısmi: ${staffRes.error}`);

  const { rows, unrouted } = buildSpecialDayNotifications({
    births: [...byTenant.values()].flatMap((b) => b.births),
    annivs: [...byTenant.values()].flatMap((b) => b.annivs),
    staff: staffRes.rows,
    dayKey: trDayKey(nowMs),
  });
  // Alıcısız müşteri veri durumudur, hata değil: heartbeat "ok" kalır, ayrıntıda görünür.
  const unroutedNote = unrouted > 0 ? ` · ${unrouted} müşteri için alıcı yok (danışman pasif, ofis sahibi yok)` : "";

  const written = await insertNotificationsDetailed(admin, rows);
  if (written.failed > 0) notes.push(`${written.failed} bildirim yazılamadı`);
  const notifCount = written.written;

  await recordHeartbeat(
    "dogum-gunu",
    notes.length > 0 ? "error" : "ok",
    `${notifCount} kişisel özel gün bildirimi (${byTenant.size} ofis)${unroutedNote}${skippedTenantsNote(disabledModules, MODULE_KEY)}${notes.length > 0 ? ` · ${notes.join("; ")}` : ""}`,
  );

  return NextResponse.json({
    ok: notes.length === 0,
    birthdays: todayBirthdays.length,
    anniversaries: todayAnniversaries.length,
    tenants_notified: byTenant.size,
    notifications: notifCount,
    duplicates: written.duplicates,
    date: `${day}/${month + 1}`,
    notes,
  });
}

export const GET = guardCron("dogum-gunu", run);
