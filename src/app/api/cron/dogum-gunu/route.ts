import { guardCron } from "@/lib/cron-run";
import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { recordHeartbeat } from "@/lib/cron-heartbeat";
import { authorizeCron } from "@/lib/cron-auth";
import { now, trParts } from "@/lib/clock";
import { readAllPaged } from "@/lib/supabase/read-all-paged";
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

type BirthdayRow = { id: string; full_name: string | null; tenant_id: string; birth_date: string | null };
type AnniversaryRow = {
  id: string;
  full_name: string | null;
  tenant_id: string;
  anniversary_date: string | null;
  anniversary_note: string | null;
};

/**
 * Cron: Bugün (Türkiye günü) doğum günü veya yıldönümü olan müşterileri tespit et,
 * ofis kullanıcılarına bildirim gönder.
 *
 * Tüm ofisleri tarar (kiracı süzgeci yok) ama SAYFALIDIR: PostgREST 1000 satır sınırında sessizce
 * kesilmez; sınıra ulaşılırsa ya da okuma hatası olursa heartbeat'e not düşülür.
 * Zamanlama: vercel.json (tek kaynak). Yetki: CRON_SECRET header kontrolü.
 */
async function run(req: Request) {
  const denied = authorizeCron(req);
  if (denied) return denied;

  const admin = createAdminClient();
  const nowMs = now();
  const { month, day } = trParts(nowMs);
  const todayKeys = todayMonthDayKeys(nowMs);

  const [birthRes, annivRes, disabledModules] = await Promise.all([
    readAllPaged<BirthdayRow>((from, to) =>
      admin
        .from("customers")
        .select("id, full_name, tenant_id, birth_date")
        .eq("is_sample", false)
        .is("deleted_at", null)
        .not("birth_date", "is", null)
        .order("id")
        .range(from, to),
    ),
    readAllPaged<AnniversaryRow>((from, to) =>
      admin
        .from("customers")
        .select("id, full_name, tenant_id, anniversary_date, anniversary_note")
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

  const rows = [...byTenant].map(([tenantId, { births, annivs }]) => {
    const parts: string[] = [];
    if (births.length > 0) {
      parts.push(`🎂 Doğum günü: ${births.map((c) => c.full_name).join(", ")}`);
    }
    if (annivs.length > 0) {
      parts.push(`🎉 Yıldönümü: ${annivs.map((c) => c.full_name + (c.anniversary_note ? ` (${c.anniversary_note})` : "")).join(", ")}`);
    }
    return {
      tenant_id: tenantId,
      title: `Bugün ${births.length + annivs.length} özel gün`,
      body: parts.join(" · "),
      href: "/app/musteriler",
      kind: "info",
    };
  });

  let notifCount = 0;
  if (rows.length > 0) {
    const { error } = await admin.from("notifications").insert(rows);
    if (error) notes.push(`bildirim yazılamadı: ${error.message}`);
    else notifCount = rows.length;
  }

  await recordHeartbeat(
    "dogum-gunu",
    notes.length > 0 ? "error" : "ok",
    `${notifCount} ofise özel gün bildirimi${skippedTenantsNote(disabledModules, MODULE_KEY)}${notes.length > 0 ? ` · ${notes.join("; ")}` : ""}`,
  );

  return NextResponse.json({
    ok: notes.length === 0,
    birthdays: todayBirthdays.length,
    anniversaries: todayAnniversaries.length,
    tenants_notified: notifCount,
    date: `${day}/${month + 1}`,
    notes,
  });
}

export const GET = guardCron("dogum-gunu", run);
